/**
 * Update-plan engine shared by the Host route and the unit tests.
 *
 * The engine owns three steps: reading the profile's installed bundles, asking
 * the npm registry for their latest compatible stable release, and updating the
 * selected plugins through the official DSH plugin manager. The official
 * manager has no `updateBundle` in the current runtime, so one update is
 * `removeBundle` followed by an exact `installBundle`; a failed install restores
 * the previous exact version.
 */

import { randomUUID } from 'node:crypto'
import { compareVersions, isPrerelease, parseVersion, satisfies } from './versions.js'

export const CHECK_TTL = 30 * 60 * 1000
export const OWN_NAME = 'dsh-plugin-updates'
const CONCURRENCY = 4
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]{86}==$/
const PROTOCOL_SOURCE = /^(?:file:|link:|workspace:|portal:|git\+|git:|github:|https?:|ssh:)/i
const DRIVE_PATH = /^[A-Za-z]:[\\/]/
const RELATIVE_PATH = /^\.{0,2}[\\/]/

/** One expected failure expressed as a stable client-facing code. */
export function coded(code) {
  const error = new Error(code)
  error.code = code
  return error
}

/** Map any thrown value to its stable code. */
export function errorCode(error) {
  const code = error?.code ?? error?.message
  if (typeof code === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(code)) return code
  return 'operation-failed'
}

/**
 * Resolve the install spec of a bundle to an npm registry package.
 * Local, Git, workspace, alias and bare-path installs are not handled here.
 * @param {object} bundle row from `pluginManager.listBundles()`
 * @returns {{ name: string, selector: string } | null}
 */
export function parseBundleSource(bundle) {
  const source = bundle?.source
  if (typeof source !== 'string' || source.trim() === '') return null
  if (PROTOCOL_SOURCE.test(source) || DRIVE_PATH.test(source) || RELATIVE_PATH.test(source)) return null
  const separator = source.lastIndexOf('@')
  const name = separator > 0 ? source.slice(0, separator) : source
  if (name !== bundle.name) return null
  return { name, selector: separator > 0 ? source.slice(separator + 1) : 'latest' }
}

/**
 * Candidate rows the checker may update: installed profile-owned, removable,
 * readable bundles whose dependency source is the npm registry.
 * @param {unknown} bundles
 */
export function selectCandidates(bundles) {
  if (!Array.isArray(bundles)) return []
  const seen = new Set()
  const candidates = []
  for (const bundle of bundles) {
    if (!bundle || typeof bundle !== 'object') continue
    if (bundle.installed !== true) continue
    if (bundle.availability !== 'profile') continue
    if (bundle.removable === false) continue
    if (bundle.readOnlyReason !== undefined) continue
    if (bundle.error !== undefined) continue
    if (typeof bundle.name !== 'string' || typeof bundle.version !== 'string') continue
    if (bundle.name === OWN_NAME) continue
    if (parseVersion(bundle.version) === null) continue
    if (parseBundleSource(bundle) === null) continue
    if (seen.has(bundle.name)) continue
    seen.add(bundle.name)
    candidates.push({
      name: bundle.name,
      version: bundle.version,
      enabled: bundle.enabled !== false,
      source: bundle.source,
      description: typeof bundle.description === 'string' ? bundle.description : '',
    })
  }
  return candidates
}

/**
 * Judge whether one registry release may replace the installed version.
 * Unknown engine ranges are treated as compatible; the official plugin manager
 * performs the authoritative check during installation.
 * @param {string} version candidate version
 * @param {object} manifest registry version document
 * @param {{ runtimeVersion?: string, nodeVersion?: string }} environment
 */
export function evaluateManifest(version, manifest, environment = {}) {
  if (typeof version !== 'string' || parseVersion(version) === null) return { compatible: false, reason: 'invalid-version' }
  if (isPrerelease(version)) return { compatible: false, reason: 'prerelease' }
  if (!manifest || typeof manifest !== 'object') return { compatible: false, reason: 'invalid-release' }
  if (manifest.deprecated) return { compatible: false, reason: 'deprecated' }
  if (!manifest.dsh || typeof manifest.dsh.bundle !== 'object') return { compatible: false, reason: 'not-bundle' }
  const integrity = manifest.dist?.integrity
  if (typeof integrity !== 'string' || !INTEGRITY_PATTERN.test(integrity)) return { compatible: false, reason: 'invalid-integrity' }
  const checks = [
    [manifest.engines?.node, environment.nodeVersion, 'node-version'],
    [manifest.engines?.dsh, environment.runtimeVersion, 'dsh-version'],
  ]
  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (peer === '@deepseek-ai/dsh' || peer.startsWith('@deepseek-ai/dsh-')) checks.push([range, environment.runtimeVersion, 'dsh-version'])
  }
  for (const [range, actual, reason] of checks) {
    if (range === undefined) continue
    if (typeof actual !== 'string') continue
    const satisfied = satisfies(actual, range)
    if (satisfied === false) return { compatible: false, reason }
  }
  return {
    compatible: true,
    integrity,
    publishedAt: typeof manifest.dist?.publishedAt === 'string' ? manifest.dist.publishedAt : null,
  }
}

function successful(result) {
  return Boolean(result) && result.error == null && (result.application === 'applied' || result.application === 'restart-required')
}

/**
 * Build the update engine.
 * @param {object} options
 * @param {object} options.manager host `pluginManager`
 * @param {object} options.registry registry client (`latest`, `release`, `manifest`)
 * @param {(bundles: unknown[]) => string | undefined} [options.runtimeVersion]
 * @param {() => Promise<{ known: boolean, busy: boolean }>} [options.activity]
 * @param {() => number} [options.clock]
 * @param {{ info?: Function, warn?: Function, error?: Function }} [options.logger]
 */
export function createEngine({
  manager,
  registry,
  runtimeVersion = () => undefined,
  activity = async () => ({ known: false, busy: false }),
  clock = () => Date.now(),
  logger = {},
} = {}) {
  if (!manager || typeof manager.listBundles !== 'function') throw new TypeError('pluginManager.listBundles is required')
  if (!manager || typeof manager.installBundle !== 'function') throw new TypeError('pluginManager.installBundle is required')
  if (!manager || typeof manager.removeBundle !== 'function') throw new TypeError('pluginManager.removeBundle is required')
  if (!registry || typeof registry.release !== 'function') throw new TypeError('a registry client is required')

  const state = { checkedAt: 0, checking: false, rows: [], job: null }
  const abort = new AbortController()
  let checkPromise = null
  let checkNames = new Set()

  const now = () => clock()
  const log = (level, ...args) => {
    const write = logger?.[level]
    if (typeof write === 'function') write.call(logger, ...args)
  }

  function snapshot() {
    const updates = state.rows
      .filter((row) => row.available === true && row.compatible === true)
      .map((row) => ({
        name: row.name,
        version: row.version,
        latest: row.latest,
        enabled: row.enabled,
        description: row.description,
        publishedAt: row.publishedAt,
      }))
    return {
      checkedAt: state.checkedAt,
      checking: state.checking,
      checkingNames: [...checkNames],
      updates,
      checked: state.rows.length,
      job: state.job === null ? null : structuredClone(state.job),
    }
  }

  async function checkCandidate(candidate, environment) {
    try {
      const release = await registry.release(candidate.name, abort.signal)
      const evaluation = evaluateManifest(release.version, release.manifest, environment)
      const available = evaluation.compatible === true && compareVersions(release.version, candidate.version) === 1
      return {
        ...candidate,
        latest: release.version,
        registry: release.registry,
        integrity: evaluation.integrity ?? null,
        publishedAt: evaluation.publishedAt ?? null,
        available,
        compatible: evaluation.compatible === true,
        reason: evaluation.reason ?? null,
        error: null,
        checkedAt: now(),
      }
    } catch (error) {
      abort.signal.throwIfAborted()
      log('warn', 'registry check failed for %s:', candidate.name, errorCode(error))
      return {
        ...candidate,
        latest: null,
        registry: null,
        integrity: null,
        publishedAt: null,
        available: false,
        compatible: false,
        reason: null,
        error: errorCode(error),
        checkedAt: now(),
      }
    }
  }

  async function runCheck() {
    const bundles = await manager.listBundles()
    const environment = {
      runtimeVersion: runtimeVersion(bundles),
      nodeVersion: process.versions.node,
    }
    const candidates = selectCandidates(bundles)
    const rows = []
    for (let index = 0; index < candidates.length; index += CONCURRENCY) {
      const chunk = candidates.slice(index, index + CONCURRENCY)
      rows.push(...await Promise.all(chunk.map((candidate) => checkCandidate(candidate, environment))))
    }
    state.rows = rows.sort((left, right) => left.name.localeCompare(right.name))
    state.checkedAt = now()
    return snapshot()
  }

  async function check({ force = false } = {}) {
    abort.signal.throwIfAborted()
    if (state.job?.state === 'running') throw coded('busy')
    if (state.checking && checkPromise !== null) return checkPromise
    if (force !== true && state.checkedAt > 0 && now() - state.checkedAt < CHECK_TTL) return snapshot()
    state.checking = true
    checkNames = new Set()
    checkPromise = (async () => {
      try {
        return await runCheck()
      } finally {
        state.checking = false
        checkPromise = null
        checkNames = new Set()
      }
    })()
    return checkPromise
  }

  async function rollback(row) {
    try {
      const result = await manager.installBundle(`${row.name}@${row.version}`, {
        enabled: row.enabled,
        saveExact: true,
        ...row.registry === null || row.registry === undefined ? {} : { registry: row.registry },
      })
      return { ok: successful(result), error: result?.error?.code ?? null }
    } catch (error) {
      log('warn', 'rollback failed for %s:', row.name, errorCode(error))
      return { ok: false, error: errorCode(error) }
    }
  }

  async function updateOne(job, row) {
    job.current = { name: row.name, from: row.version, to: row.latest, phase: 'verifying' }
    let removed = false
    try {
      const fresh = await registry.release(row.name, abort.signal, { version: row.latest })
      if (fresh.version !== row.latest || fresh.manifest?.dist?.integrity !== row.integrity) throw coded('release-changed')
      job.current = { ...job.current, phase: 'removing' }
      const removal = await manager.removeBundle(row.name)
      if (removal?.error) throw coded(removal.error.code ?? 'remove-failed')
      removed = true
      job.current = { ...job.current, phase: 'installing' }
      const result = await manager.installBundle(`${row.name}@${row.latest}`, {
        enabled: row.enabled,
        saveExact: true,
        ...row.registry === null || row.registry === undefined ? {} : { registry: row.registry },
        requestId: `${job.id}:${row.name}`,
      })
      if (!successful(result)) {
        const rollbackResult = await rollback(row)
        job.results.push({
          name: row.name,
          from: row.version,
          to: row.latest,
          ok: false,
          error: result?.error?.code ?? 'install-failed',
          application: result?.application ?? null,
          rollback: rollbackResult,
        })
        throw coded('install-failed')
      }
      const restartRequired = result.application === 'restart-required'
      if (restartRequired) job.restartRequired = true
      job.results.push({ name: row.name, from: row.version, to: row.latest, ok: true, restartRequired, rollback: null })
      row.available = false
    } catch (error) {
      if (!job.results.some((entry) => entry.name === row.name)) {
        const rollbackResult = removed ? await rollback(row) : null
        job.results.push({
          name: row.name,
          from: row.version,
          to: row.latest,
          ok: false,
          error: errorCode(error),
          application: null,
          rollback: rollbackResult,
        })
      }
      throw error
    }
  }

  async function runJob(job, selected) {
    try {
      for (const row of selected) {
        await updateOne(job, row)
        job.done += 1
      }
      job.state = 'done'
    } catch (error) {
      job.state = 'failed'
      job.failure = errorCode(error)
      log('warn', 'plugin update stopped:', job.failure)
    } finally {
      job.finishedAt = now()
      if (job.current !== null) job.current = { ...job.current, phase: 'finished' }
      // The next open re-checks so the list reflects the new versions.
      state.checkedAt = 0
    }
  }

  async function start(names) {
    abort.signal.throwIfAborted()
    if (state.job?.state === 'running') throw coded('busy')
    if (state.checking) throw coded('busy')
    if (!Array.isArray(names) || names.length === 0 || names.length > 64) throw coded('invalid-request')
    const byName = new Map(state.rows.filter((row) => row.available === true).map((row) => [row.name, row]))
    const selected = []
    for (const name of names) {
      if (typeof name !== 'string') throw coded('invalid-request')
      const row = byName.get(name)
      if (row === undefined) throw coded('check-first')
      if (!selected.includes(row)) selected.push(row)
    }
    if (selected.length === 0) throw coded('invalid-request')
    const guard = await activity()
    if (guard?.known === true && guard.busy === true) throw coded('busy-session')
    const job = {
      id: randomUUID(),
      state: 'running',
      total: selected.length,
      done: 0,
      current: null,
      items: selected.map((row) => ({ name: row.name, from: row.version, to: row.latest, description: row.description, enabled: row.enabled })),
      results: [],
      failure: null,
      restartRequired: false,
      startedAt: now(),
      finishedAt: null,
    }
    state.job = job
    void runJob(job, selected)
    return snapshot()
  }

  function dismiss() {
    if (state.job?.state === 'running') throw coded('busy')
    state.job = null
    return snapshot()
  }

  async function dispose() {
    abort.abort()
    if (checkPromise !== null) await checkPromise.catch(() => {})
    if (state.job?.state === 'running') {
      state.job.state = 'failed'
      state.job.failure = 'disposed'
    }
  }

  return {
    check,
    start,
    dismiss,
    snapshot,
    dispose,
    get state() {
      return state
    },
  }
}
