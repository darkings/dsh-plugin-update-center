/**
 * Host half of the plugin update center.
 *
 * It exposes one same-origin POST route so any Web window can read the update
 * snapshot, start a batch, and poll progress. The actual package operations are
 * delegated to the official `pluginManager`; nothing here writes the profile.
 */

import { dirname, join } from 'node:path'
import { createBackup } from './lib/backup.js'
import { createEngine } from './lib/engine.js'
import { createHandler, ROUTE } from './lib/http.js'
import { createRegistry } from './lib/registry.js'
import { createResidueService } from './lib/residue.js'
import { createRestartService } from './lib/restart.js'

export const name = 'dsh-plugin-update-center'
export const inject = ['connection']

function readActivity(ctx) {
  try {
    const agents = ctx.get?.('agents')
    const jobs = ctx.get?.('jobs')
    const agentList = typeof agents?.list === 'function' ? agents.list() : []
    const jobList = typeof jobs?.list === 'function' ? jobs.list() : []
    const statesKnown = Array.isArray(agentList)
      && Array.isArray(jobList)
      && agentList.every((agent) => agent?.status === 'idle' || agent?.status === 'running')
      && jobList.every((job) => typeof job?.status === 'string')
    if (!statesKnown) return { known: false, busy: false }
    const runningAgents = agentList.filter((agent) => agent.status === 'running').length
    const runningJobs = jobList.filter((job) => job.status === 'running' || job.status === 'stopping').length
    return { known: true, busy: runningAgents + runningJobs > 0 }
  } catch {
    return { known: false, busy: false }
  }
}

export function apply(ctx) {
  let manager
  try {
    manager = ctx.get?.('pluginManager')
  } catch {
    // A profile without the service still loads the plugin in fallback mode.
  }
  const connection = ctx.connection
  if (typeof connection?.fetch?.register !== 'function') return
  const hasManager = Boolean(manager)
    && typeof manager.listBundles === 'function'
    && typeof manager.installBundle === 'function'
    && typeof manager.removeBundle === 'function'
  if (!hasManager) {
    // Minimal/headless profiles (for example dsh.so's L5 profile) do not mount
    // the profile plugin manager. Still load the plugin and answer its route so
    // the web boot and the endpoint check pass; the UI reports that updates are
    // unavailable in this profile.
    ctx.effect(
      () => connection.fetch.register({
        path: ROUTE,
        methods: ['POST'],
        requestBody: 'streaming',
        fetch: async () => new Response(JSON.stringify({ ok: false, code: 'service-unavailable' }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        }),
      }),
      'dsh-plugin-update-center: unavailable route',
    )
    return
  }

  const profile = ctx.get?.('profileContext')
  const profileDir = typeof profile?.dir === 'string' && profile.dir !== '' ? profile.dir : undefined
  const homeDir = process.env.DSH_HOME ?? (profileDir === undefined ? undefined : dirname(dirname(profileDir)))
  const backup = profileDir !== undefined && homeDir !== undefined
    ? createBackup({ profileDir, homeDir })
    : null
  const residue = profileDir !== undefined
    ? createResidueService({ profileDir, homeDir, manager, backup })
    : null
  const restart = createRestartService({
    logPath: homeDir === undefined
      ? join(process.env.TEMP ?? '.', 'dsh-plugin-update-center-restart.log')
      : join(homeDir, 'plugin-updates', 'restart.log'),
  })

  const engine = createEngine({
    manager,
    registry: createRegistry(),
    profileDir,
    backup,
    runtimeVersion: (bundles) => {
      if (!Array.isArray(bundles)) return undefined
      const base = bundles.find((bundle) => bundle?.name === '@deepseek-ai/dsh-base' && typeof bundle.version === 'string')
      return base?.version
    },
    activity: async () => readActivity(ctx),
    logger: ctx.logger,
  })

  ctx.effect(
    () => connection.fetch.register({
      path: ROUTE,
      methods: ['POST'],
      requestBody: 'streaming',
      fetch: createHandler(engine, residue, restart),
    }),
    'dsh-plugin-update-center: http route',
  )
  ctx.effect(() => () => { void engine.dispose() }, 'dsh-plugin-update-center: engine')
}
