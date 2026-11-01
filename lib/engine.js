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
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareVersions, isPrerelease, parseVersion, satisfies } from './versions.js'

export const CHECK_TTL = 30 * 60 * 1000
export const OWN_NAME = 'dsh-plugin-updater'
export const QUEUE_DEFAULTS = Object.freeze({ pollMs: 2000, quietMs: 10000, countdownMs: 5000 })
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

/** `pkg/client` and `pkg` name the same client module row. */
function stripClientSuffix(name) {
  return name.endsWith('/client') ? name.slice(0, -'/client'.length) : name
}

/** The JavaScript entry a package declares, relative to its directory. */
function entryFileOf(manifest) {
  const pick = (value) => {
    if (typeof value === 'string') return value
    if (value === null || typeof value !== 'object') return undefined
    return value.default ?? value.import ?? value.node ?? value.require
  }
  const exported = manifest?.exports
  const fromExports = exported !== null && typeof exported === 'object' ? pick(exported['.']) : undefined
  const raw = fromExports ?? manifest?.main
  if (typeof raw !== 'string' || raw === '') return null
  return raw.replace(/^\.\//, '')
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
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
 * @param {string} [options.profileDir] profile directory for rollback snapshots and verification
 * @param {{ create: Function, history?: Function } | null} [options.backup] snapshot writer
 * @param {{ pollMs?: number, quietMs?: number, countdownMs?: number }} [options.queue] queue timing
 * @param {{ info?: Function, warn?: Function, error?: Function }} [options.logger]
 */
export function createEngine({
  manager,
  registry,
  runtimeVersion = () => undefined,
  activity = async () => ({ known: false, busy: false }),
  clock = () => Date.now(),
  profileDir = undefined,
  backup = null,
  queue = {},
  logger = {},
} = {}) {
  if (!manager || typeof manager.listBundles !== 'function') throw new TypeError('pluginManager.listBundles is required')
  if (!manager || typeof manager.installBundle !== 'function') throw new TypeError('pluginManager.installBundle is required')
  if (!manager || typeof manager.removeBundle !== 'function') throw new TypeError('pluginManager.removeBundle is required')
  if (!registry || typeof registry.release !== 'function') throw new TypeError('a registry client is required')

  const state = { checkedAt: 0, checking: false, rows: [], job: null, desktopUpdate: null }
  const abort = new AbortController()
  const queueSettings = { ...QUEUE_DEFAULTS, ...queue }
  let checkPromise = null
  let checkNames = new Set()

  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })

  const DESKTOP_UPDATE_BLOCKING = new Set(['available', 'downloading', 'verifying', 'installing', 'ready'])
  function desktopBlocked() {
    const phase = state.desktopUpdate?.phase
    return typeof phase === 'string' && DESKTOP_UPDATE_BLOCKING.has(phase)
  }
  function setDesktopUpdate(info) {
    state.desktopUpdate = {
      phase: typeof info?.phase === 'string' ? info.phase : 'unknown',
      version: typeof info?.version === 'string' ? info.version : null,
    }
    return snapshot()
  }

  const now = () => clock()
  const log = (level, ...args) => {
    const write = logger?.[level]
    if (typeof write === 'function') write.call(logger, ...args)
  }

  /**
   * Read every installed profile bundle's manifest once and invert client
   * injections: a plugin another plugin injects is a provider whose update can
   * strand its dependents on a missing client service.
   */
  async function analyzeRisks(bundles) {
    const manifests = new Map()
    if (typeof profileDir === 'string' && profileDir !== '') {
      for (const bundle of bundles) {
        if (!bundle || bundle.installed !== true || bundle.availability !== 'profile') continue
        if (typeof bundle.name !== 'string') continue
        manifests.set(bundle.name, await readJson(join(profileDir, 'node_modules', bundle.name, 'package.json')))
      }
    }
    const dependents = new Map()
    for (const [name, manifest] of manifests) {
      const inject = manifest?.dsh?.client?.inject
      if (!Array.isArray(inject)) continue
      for (const dependency of inject) {
        if (typeof dependency !== 'string') continue
        const provider = stripClientSuffix(dependency)
        if (provider === name || !manifests.has(provider)) continue
        if (!dependents.has(provider)) dependents.set(provider, new Set())
        dependents.get(provider).add(name)
      }
    }
    return { manifests, dependents }
  }

  async function verifyOnce(row) {
    const bundles = await manager.listBundles()
    const bundle = Array.isArray(bundles) ? bundles.find((entry) => entry?.name === row.name) : undefined
    if (!bundle || bundle.installed !== true) return { ok: false, reason: 'bundle-missing' }
    if (bundle.version !== row.latest) return { ok: false, reason: 'version-mismatch' }
    if (bundle.enabled !== row.enabled) return { ok: false, reason: 'enabled-mismatch' }
    if (bundle.error !== undefined) return { ok: false, reason: bundle.error?.code ?? 'bundle-error' }
    if (row.enabled === true && typeof manager.listPlugins === 'function') {
      const plugins = await manager.listPlugins()
      if (Array.isArray(plugins)) {
        for (const entry of bundle.rows ?? []) {
          const found = plugins.find((plugin) => plugin?.entryId === entry.entryId)
          if (found && found.enabled === true && found.fiberPhase !== 'active') {
            return { ok: false, reason: 'row-inactive', entryId: entry.entryId, phase: found.fiberPhase }
          }
        }
      }
    }
    if (typeof profileDir !== 'string' || profileDir === '') return { ok: true }
    const dir = join(profileDir, 'node_modules', row.name)
    const manifest = await readJson(join(dir, 'package.json'))
    if (manifest === null) return { ok: false, reason: 'manifest-unreadable' }
    if (manifest.version !== row.latest) return { ok: false, reason: 'manifest-version-mismatch' }
    const entry = entryFileOf(manifest)
    if (entry !== null && !existsSync(join(dir, entry))) return { ok: false, reason: 'entry-missing' }
    const patch = manifest.dsh?.bundle?.patch
    if (typeof patch === 'string' && !existsSync(join(dir, patch))) return { ok: false, reason: 'patch-missing' }
    return { ok: true }
  }

  /** Give the fresh rows a short moment to settle before judging activation. */
  async function verifyInstall(row) {
    let result = { ok: false, reason: 'unknown' }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      result = await verifyOnce(row)
      if (result.ok) return result
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400))
    }
    return result
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
        bootCritical: row.bootCritical === true,
        dependents: row.dependents ?? [],
        clientDeps: row.clientDeps ?? [],
        hasClient: row.hasClient === true,
      }))
    return {
      checkedAt: state.checkedAt,
      checking: state.checking,
      checkingNames: [...checkNames],
      updates,
      checked: state.rows.length,
      desktopUpdate: state.desktopUpdate === null ? null : { ...state.desktopUpdate },
      job: state.job === null ? null : structuredClone(state.job),
    }
  }

  async function checkCandidate(candidate, environment, analysis) {
    const manifest = analysis?.manifests.get(candidate.name)
    const client = manifest?.dsh?.client
    const clientDeps = Array.isArray(client?.inject) ? client.inject : []
    const dependents = [...(analysis?.dependents.get(candidate.name) ?? [])]
    const bootCritical = client?.immediately === true || candidate.name === '@dsh-plugin/dsh-loader'
    const hasClient = client !== undefined && client !== null
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
        bootCritical,
        clientDeps,
        dependents,
        hasClient,
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
        bootCritical,
        clientDeps,
        dependents,
        hasClient,
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
    const analysis = await analyzeRisks(bundles)
    const candidates = selectCandidates(bundles)
    const rows = []
    for (let index = 0; index < candidates.length; index += CONCURRENCY) {
      const chunk = candidates.slice(index, index + CONCURRENCY)
      rows.push(...await Promise.all(chunk.map((candidate) => checkCandidate(candidate, environment, analysis))))
    }
    state.rows = rows.sort((left, right) => left.name.localeCompare(right.name))
    state.checkedAt = now()
    return snapshot()
  }

  async function check({ force = false } = {}) {
    abort.signal.throwIfAborted()
    if (state.job !== null && ['queued', 'starting', 'running'].includes(state.job.state)) throw coded('busy')
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

  async function record(job, entry) {
    job.results.push(entry)
    try {
      await backup?.history?.({ jobId: job.id, ...entry, at: now() })
    } catch {
      // History is diagnostic only.
    }
  }

  async function updateOne(job, row) {
    job.current = { name: row.name, from: row.version, to: row.latest, phase: 'verifying' }
    let removed = false
    try {
      const fresh = await registry.release(row.name, abort.signal, { version: row.latest })
      if (fresh.version !== row.latest || fresh.manifest?.dist?.integrity !== row.integrity) throw coded('release-changed')
      // The previous version must still be obtainable, otherwise a failed
      // install has no safe rollback target and the update must not start.
      if (typeof registry.manifest === 'function') {
        const previous = await registry.manifest(row.name, row.version, abort.signal, row.registry ?? undefined).catch(() => null)
        if (previous === null || previous.manifest?.dsh?.bundle === undefined) throw coded('rollback-unavailable')
      }
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
        await record(job, {
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
      // A package can install "successfully" yet leave a broken row, a
      // truncated node_modules entry, or a missing bundle patch. Verify the
      // observable state before telling the user the update is ready.
      job.current = { ...job.current, phase: 'verifying-install' }
      const verification = await verifyInstall(row)
      if (verification.ok !== true) {
        const rollbackResult = await rollback(row)
        await record(job, {
          name: row.name,
          from: row.version,
          to: row.latest,
          ok: false,
          error: 'verification-failed',
          verification,
          rollback: rollbackResult,
        })
        throw coded('verification-failed')
      }
      const restartRequired = result.application === 'restart-required'
      if (restartRequired) job.restartRequired = true
      await record(job, {
        name: row.name,
        from: row.version,
        to: row.latest,
        ok: true,
        restartRequired,
        hasClient: row.hasClient === true,
        bootCritical: row.bootCritical === true,
        verification,
        rollback: null,
      })
      row.available = false
    } catch (error) {
      if (!job.results.some((entry) => entry.name === row.name)) {
        const rollbackResult = removed ? await rollback(row) : null
        await record(job, {
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

  function createJob(selected, jobState) {
    return {
      id: randomUUID(),
      state: jobState,
      total: selected.length,
      done: 0,
      current: null,
      items: selected.map((row) => ({
        name: row.name,
        from: row.version,
        to: row.latest,
        description: row.description,
        enabled: row.enabled,
        bootCritical: row.bootCritical === true,
        dependents: row.dependents ?? [],
        hasClient: row.hasClient === true,
      })),
      results: [],
      failure: null,
      restartRequired: false,
      reloadRequired: false,
      snapshotDir: null,
      waitingFor: null,
      countdownEndsAt: null,
      startedAt: now(),
      finishedAt: null,
    }
  }

  async function prepareSnapshot(job, selected) {
    if (backup === null || backup === undefined) return
    try {
      const snapshot = await backup.create({
        jobId: job.id,
        runtimeVersion: runtimeVersion(await manager.listBundles()),
        plugins: selected.map((row) => ({ name: row.name, from: row.version, to: row.latest, enabled: row.enabled })),
      })
      if (!snapshot || typeof snapshot.dir !== 'string') throw new Error('snapshot-missing')
      job.snapshotDir = snapshot.dir
    } catch (error) {
      log('error', 'profile snapshot failed:', errorCode(error))
      throw coded('snapshot-failed')
    }
  }

  /**
   * Restart wins over reload: a full restart reloads the page too, so the UI
   * never asks for both. A boot-tier client plugin is treated as restart-only
   * because a failed reload of that tier leaves a dead window.
   */
  function summarize(job) {
    const successes = job.results.filter((entry) => entry.ok === true)
    const bootClient = successes.some((entry) => entry.bootCritical === true && entry.hasClient === true)
    job.restartRequired = job.restartRequired === true || bootClient
    job.reloadRequired = job.restartRequired !== true && successes.some((entry) => entry.hasClient === true)
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
      summarize(job)
      // The next open re-checks so the list reflects the new versions.
      state.checkedAt = 0
    }
  }

  async function launch(job, selected) {
    try {
      await prepareSnapshot(job, selected)
    } catch (error) {
      job.state = 'failed'
      job.failure = errorCode(error)
      job.finishedAt = now()
      state.checkedAt = 0
      return
    }
    job.state = 'running'
    job.startedAt = now()
    await runJob(job, selected)
  }

  /**
   * Wait until every conversation and background job is idle for the quiet
   * window, then run. A new task during the countdown sends the job back to
   * queued instead of starting under a live session.
   */
  async function runQueue(job, selected) {
    const { pollMs, quietMs, countdownMs } = queueSettings
    let idleSince = null
    for (;;) {
      await sleep(pollMs)
      if (job.cancelled === true || state.job !== job) return
      let guard
      try { guard = await activity() } catch { guard = { known: false, busy: true } }
      job.waitingFor = {
        known: guard?.known === true,
        busy: guard?.busy === true,
        desktop: desktopBlocked(),
        agents: Number.isSafeInteger(guard?.agents) ? guard.agents : 0,
        jobs: Number.isSafeInteger(guard?.jobs) ? guard.jobs : 0,
      }
      if (guard?.known !== true || guard?.busy === true || desktopBlocked()) {
        idleSince = null
        continue
      }
      if (idleSince === null) {
        idleSince = now()
        continue
      }
      if (now() - idleSince < quietMs) continue
      job.state = 'starting'
      job.countdownEndsAt = now() + countdownMs
      await sleep(countdownMs)
      if (job.cancelled === true || state.job !== job) return
      let recheck
      try { recheck = await activity() } catch { recheck = { known: false, busy: true } }
      if (recheck?.known !== true || recheck?.busy === true) {
        job.state = 'queued'
        job.countdownEndsAt = null
        idleSince = null
        continue
      }
      job.countdownEndsAt = null
      await launch(job, selected)
      return
    }
  }

  async function start(names, options = {}) {
    abort.signal.throwIfAborted()
    if (state.job !== null && ['queued', 'starting', 'running'].includes(state.job.state)) throw coded('busy')
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
    if (desktopBlocked()) throw coded('dsh-update')
    let guard
    try {
      guard = await activity()
    } catch {
      guard = { known: false, busy: true }
    }
    const busy = guard?.known === true && guard.busy === true
    if (busy && options.waitForIdle !== true) throw coded('busy-session')
    const job = createJob(selected, busy ? 'queued' : 'running')
    if (busy) {
      job.waitingFor = { known: true, busy: true, agents: guard.agents ?? 0, jobs: guard.jobs ?? 0 }
      state.job = job
      void runQueue(job, selected)
      return snapshot()
    }
    await prepareSnapshot(job, selected)
    state.job = job
    void runJob(job, selected)
    return snapshot()
  }

  function cancel() {
    const job = state.job
    if (job === null || job === undefined) return snapshot()
    if (job.state === 'running') throw coded('busy')
    job.cancelled = true
    job.state = 'cancelled'
    job.countdownEndsAt = null
    job.finishedAt = now()
    return snapshot()
  }

  /**
   * Mark the page reload for one finished job as performed. Without this the
   * client would see the same completed job after every reload and refresh
   * again forever.
   */
  function acknowledgeReload(jobId) {
    const job = state.job
    if (job === null || job === undefined) return snapshot()
    if (typeof jobId === 'string' && job.id !== jobId) return snapshot()
    job.reloadRequired = false
    job.reloadedAt = now()
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
    if (state.job !== null && state.job !== undefined) {
      state.job.cancelled = true
      if (state.job.state === 'running') {
        state.job.state = 'failed'
        state.job.failure = 'disposed'
      }
    }
  }

  return {
    check,
    start,
    cancel,
    dismiss,
    acknowledgeReload,
    setDesktopUpdate,
    snapshot,
    dispose,
    get state() {
      return state
    },
  }
}
