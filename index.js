/**
 * Host half of the plugin update center.
 *
 * It exposes one same-origin POST route so any Web window can read the update
 * snapshot, start a batch, and poll progress. The actual package operations are
 * delegated to the official `pluginManager`; nothing here writes the profile.
 */

import { dirname } from 'node:path'
import { createBackup } from './lib/backup.js'
import { createEngine } from './lib/engine.js'
import { createHandler, ROUTE } from './lib/http.js'
import { createRegistry } from './lib/registry.js'
import { createResidueService } from './lib/residue.js'

export const name = 'dsh-plugin-updater'
export const inject = ['connection', 'pluginManager']

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
  const manager = ctx.pluginManager
  const connection = ctx.connection
  if (
    typeof manager?.listBundles !== 'function'
    || typeof manager?.installBundle !== 'function'
    || typeof manager?.removeBundle !== 'function'
  ) return
  if (typeof connection?.fetch?.register !== 'function') return

  const profile = ctx.get?.('profileContext')
  const profileDir = typeof profile?.dir === 'string' && profile.dir !== '' ? profile.dir : undefined
  const homeDir = process.env.DSH_HOME ?? (profileDir === undefined ? undefined : dirname(dirname(profileDir)))
  const backup = profileDir !== undefined && homeDir !== undefined
    ? createBackup({ profileDir, homeDir })
    : null
  const residue = profileDir !== undefined
    ? createResidueService({ profileDir, homeDir, manager, backup })
    : null

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
      fetch: createHandler(engine, residue),
    }),
    'dsh-plugin-updater: http route',
  )
  ctx.effect(() => () => { void engine.dispose() }, 'dsh-plugin-updater: engine')
}
