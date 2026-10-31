import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createEngine,
  evaluateManifest,
  parseBundleSource,
  selectCandidates,
} from '../lib/engine.js'

const INTEGRITY_A = 'sha512-' + 'A'.repeat(86) + '=='
const INTEGRITY_B = 'sha512-' + 'B'.repeat(86) + '=='

function manifest(version, { integrity = INTEGRITY_A, engines = {}, peerDependencies = {}, deprecated = false } = {}) {
  return {
    name: 'pkg-a',
    version,
    deprecated,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dist: { integrity },
    engines,
    peerDependencies,
  }
}

function bundles() {
  return [
    {
      name: 'pkg-a',
      version: '1.0.0',
      source: 'pkg-a@1.0.0',
      installed: true,
      availability: 'profile',
      removable: true,
      enabled: true,
      description: 'Alpha plugin',
    },
    {
      name: 'pkg-git',
      version: '0.1.0',
      source: 'github:owner/repo#abcdef',
      installed: true,
      availability: 'profile',
      removable: true,
      enabled: true,
    },
    {
      name: 'pkg-local',
      version: '0.1.0',
      source: 'file:../pkg-local',
      installed: true,
      availability: 'profile',
      removable: true,
      enabled: true,
    },
    {
      name: 'shipped',
      version: '9.9.9',
      availability: 'installation',
      installed: false,
    },
    {
      name: '@deepseek-ai/dsh-base',
      version: '0.2.1-rc.5',
      availability: 'installation',
      installed: false,
    },
  ]
}

function makeManager(overrides = {}) {
  const calls = []
  const rows = overrides.bundles ?? bundles()
  const install = overrides.install ?? (async () => ({ changed: true, application: 'applied' }))
  const remove = overrides.remove ?? (async () => ({ changed: true, application: 'applied' }))
  return {
    calls,
    rows,
    async listBundles() {
      return rows
    },
    async removeBundle(name) {
      calls.push(['remove', name])
      return remove(name)
    },
    async installBundle(spec, options) {
      calls.push(['install', spec, options])
      const result = await install(spec, options)
      if (overrides.persist !== false && result && result.error == null && (result.application === 'applied' || result.application === 'restart-required')) {
        const separator = spec.lastIndexOf('@')
        const name = separator > 0 ? spec.slice(0, separator) : spec
        const version = separator > 0 ? spec.slice(separator + 1) : undefined
        const row = rows.find((entry) => entry.name === name)
        if (row !== undefined && version !== undefined) {
          row.version = version
          row.installed = true
          row.enabled = options?.enabled !== false
          row.availability = 'profile'
        }
      }
      return result
    },
  }
}

function makeRegistry(entry, options = {}) {
  const calls = []
  return {
    calls,
    async release(name, signal, requestOptions = {}) {
      calls.push({ name, version: requestOptions.version })
      if (name !== 'pkg-a' || entry === undefined) throw Object.assign(new Error('registry-unavailable'), { code: 'registry-unavailable' })
      const version = requestOptions.version ?? entry.version
      const document = entry.manifests?.[version] ?? (version === entry.version ? entry.manifest : undefined)
      if (document === undefined) throw Object.assign(new Error('registry-unavailable'), { code: 'registry-unavailable' })
      return { version, registry: 'https://registry.npmjs.org', manifest: document }
    },
    ...options.manifest === undefined ? {} : {
      async manifest(name, version) {
        return options.manifest(name, version)
      },
    },
  }
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now()
  while (predicate() !== true) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for engine state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function makeEngine(overrides = {}) {
  const manager = overrides.manager ?? makeManager()
  const registry = overrides.registry ?? makeRegistry({
    version: '1.2.0',
    manifests: { '1.0.0': manifest('1.0.0'), '1.2.0': manifest('1.2.0') },
  })
  const engine = createEngine({
    manager,
    registry,
    runtimeVersion: () => '0.2.1-rc.5',
    activity: overrides.activity ?? (async () => ({ known: true, busy: false })),
    ...overrides.profileDir === undefined ? {} : { profileDir: overrides.profileDir },
    ...overrides.backup === undefined ? {} : { backup: overrides.backup },
    ...overrides.queue === undefined ? {} : { queue: overrides.queue },
  })
  return { engine, manager, registry }
}

test('selects only registry-sourced profile bundles', () => {
  const candidates = selectCandidates(bundles())
  assert.deepEqual(candidates.map((entry) => entry.name), ['pkg-a'])
  assert.equal(candidates[0].enabled, true)
})

test('parses registry sources and rejects external installs', () => {
  assert.deepEqual(parseBundleSource({ name: 'pkg-a', source: 'pkg-a@1.0.0' }), { name: 'pkg-a', selector: '1.0.0' })
  assert.deepEqual(parseBundleSource({ name: '@scope/pkg', source: '@scope/pkg@^2.0.0' }), { name: '@scope/pkg', selector: '^2.0.0' })
  assert.deepEqual(parseBundleSource({ name: 'pkg-a', source: 'pkg-a' }), { name: 'pkg-a', selector: 'latest' })
  assert.equal(parseBundleSource({ name: 'pkg', source: 'github:owner/repo' }), null)
  assert.equal(parseBundleSource({ name: 'pkg', source: 'link:../pkg' }), null)
  assert.equal(parseBundleSource({ name: 'pkg', source: 'C:\\tmp\\pkg' }), null)
  assert.equal(parseBundleSource({ name: 'pkg', source: 'other@1.0.0' }), null)
})

test('judges release compatibility', () => {
  assert.equal(evaluateManifest('1.0.0', manifest('1.0.0'), { runtimeVersion: '0.2.1-rc.5', nodeVersion: '24.22.0' }).compatible, true)
  assert.equal(evaluateManifest('1.0.0-rc.1', manifest('1.0.0-rc.1'), {}).reason, 'prerelease')
  assert.equal(evaluateManifest('1.0.0', manifest('1.0.0', { deprecated: true }), {}).reason, 'deprecated')
  assert.equal(evaluateManifest('1.0.0', { name: 'pkg-a', version: '1.0.0' }, {}).reason, 'not-bundle')
  assert.equal(evaluateManifest('1.0.0', manifest('1.0.0', { integrity: 'sha1-abc' }), {}).reason, 'invalid-integrity')
  assert.equal(evaluateManifest('1.0.0', manifest('1.0.0', { engines: { dsh: '>=0.3.0' } }), { runtimeVersion: '0.2.1-rc.5' }).reason, 'dsh-version')
  assert.equal(evaluateManifest('1.0.0', manifest('1.0.0', { engines: { node: '>=99' } }), { nodeVersion: '24.22.0' }).reason, 'node-version')
  assert.equal(evaluateManifest('1.0.0', manifest('1.0.0', { engines: { dsh: '>=0.3.0' } }), {}).compatible, true)
})

test('checks installed bundles and reports updates', async () => {
  const { engine, registry } = makeEngine()
  const snapshot = await engine.check({ force: true })
  assert.equal(snapshot.updates.length, 1)
  assert.deepEqual(snapshot.updates[0], {
    name: 'pkg-a',
    version: '1.0.0',
    latest: '1.2.0',
    enabled: true,
    description: 'Alpha plugin',
    publishedAt: null,
    bootCritical: false,
    clientDeps: [],
    dependents: [],
    hasClient: false,
  })
  assert.equal(snapshot.checked, 1)
  assert.equal(registry.calls.length, 1)
})

test('skips incompatible releases', async () => {
  const { engine } = makeEngine({
    registry: makeRegistry({
      version: '1.2.0',
      manifests: { '1.0.0': manifest('1.0.0'), '1.2.0': manifest('1.2.0', { engines: { dsh: '>=0.3.0' } }) },
    }),
  })
  const snapshot = await engine.check({ force: true })
  assert.equal(snapshot.updates.length, 0)
})

test('reuses the cached check unless forced', async () => {
  const { engine, registry } = makeEngine()
  await engine.check({ force: true })
  await engine.check()
  assert.equal(registry.calls.length, 1)
  await engine.check({ force: true })
  assert.equal(registry.calls.length, 2)
})

test('removes and reinstalls the exact release', async () => {
  const { engine, manager } = makeEngine()
  await engine.check({ force: true })
  const started = await engine.start(['pkg-a'])
  assert.equal(started.job.state, 'running')
  await waitFor(() => engine.state.job.state !== 'running')
  const job = engine.snapshot().job
  assert.equal(job.state, 'done')
  assert.equal(job.done, 1)
  assert.equal(job.results[0].ok, true)
  assert.deepEqual(manager.calls.map((call) => call[0]), ['remove', 'install'])
  assert.equal(manager.calls[1][1], 'pkg-a@1.2.0')
  assert.equal(manager.calls[1][2].saveExact, true)
  assert.equal(manager.calls[1][2].enabled, true)
  assert.equal(manager.calls[1][2].registry, 'https://registry.npmjs.org')
})

test('restores the previous version when installation fails', async () => {
  const { engine, manager } = makeEngine({
    manager: makeManager({
      install: async (spec) => spec === 'pkg-a@1.2.0'
        ? { changed: false, application: 'failed', error: { code: 'incompatible-version' } }
        : { changed: true, application: 'applied' },
    }),
  })
  await engine.check({ force: true })
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running')
  const job = engine.snapshot().job
  assert.equal(job.state, 'failed')
  assert.deepEqual(manager.calls.map((call) => call[1]), ['pkg-a', 'pkg-a@1.2.0', 'pkg-a@1.0.0'])
  assert.equal(job.results[0].error, 'incompatible-version')
  assert.equal(job.results[0].rollback.ok, true)
})

test('stops before removal when the release changed after the check', async () => {
  let lookups = 0
  const registry = {
    async release(name, signal, options = {}) {
      lookups += 1
      const integrity = options.version === undefined ? INTEGRITY_A : INTEGRITY_B
      return { version: '1.2.0', registry: 'https://registry.npmjs.org', manifest: manifest('1.2.0', { integrity }) }
    },
  }
  const { engine, manager } = makeEngine({ registry })
  await engine.check({ force: true })
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running')
  const job = engine.snapshot().job
  assert.equal(job.state, 'failed')
  assert.equal(job.results[0].error, 'release-changed')
  assert.equal(manager.calls.length, 0)
  assert.equal(lookups, 2)
})

test('refuses to start while a session is running', async () => {
  const { engine } = makeEngine({ activity: async () => ({ known: true, busy: true }) })
  await engine.check({ force: true })
  await assert.rejects(engine.start(['pkg-a']), (error) => error.code === 'busy-session')
})

test('refuses names that are not in the current plan', async () => {
  const { engine } = makeEngine()
  await engine.check({ force: true })
  await assert.rejects(engine.start(['pkg-git']), (error) => error.code === 'check-first')
})

test('dismisses a finished job', async () => {
  const { engine } = makeEngine()
  await engine.check({ force: true })
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running')
  const after = engine.dismiss()
  assert.equal(after.job, null)
})

test('refuses to start when the profile snapshot cannot be created', async () => {
  const { engine } = makeEngine({ backup: { create: async () => { throw new Error('disk-full') } } })
  await engine.check({ force: true })
  await assert.rejects(engine.start(['pkg-a']), (error) => error.code === 'snapshot-failed')
  assert.equal(engine.state.job, null)
})

test('records the snapshot directory on the job', async () => {
  const { engine } = makeEngine({ backup: { create: async () => ({ dir: 'C:/snapshots/one' }), history: async () => {} } })
  await engine.check({ force: true })
  const started = await engine.start(['pkg-a'])
  assert.equal(started.job.snapshotDir, 'C:/snapshots/one')
  await waitFor(() => engine.state.job.state !== 'running')
  assert.equal(engine.state.job.state, 'done')
})

test('refuses to start when the previous release cannot be restored', async () => {
  const { engine, manager, registry } = makeEngine({
    registry: makeRegistry(
      { version: '1.2.0', manifests: { '1.0.0': manifest('1.0.0'), '1.2.0': manifest('1.2.0') } },
      { manifest: async () => null },
    ),
  })
  await engine.check({ force: true })
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running')
  assert.equal(engine.state.job.state, 'failed')
  assert.equal(engine.state.job.results[0].error, 'rollback-unavailable')
  assert.equal(manager.calls.length, 0)
  assert.equal(registry.calls.length, 2)
})

test('rolls back when the installed package fails post-install verification', async () => {
  const { engine, manager } = makeEngine({ manager: makeManager({ persist: false }) })
  await engine.check({ force: true })
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running', 5000)
  const job = engine.state.job
  assert.equal(job.state, 'failed')
  assert.equal(job.failure, 'verification-failed')
  assert.equal(job.results[0].error, 'verification-failed')
  assert.deepEqual(manager.calls.map((call) => call[1]), ['pkg-a', 'pkg-a@1.2.0', 'pkg-a@1.0.0'])
})

test('flags boot-critical plugins and their dependents', async () => {  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-updates-'))
  try {
    await mkdir(join(root, 'node_modules', 'pkg-a'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg-a', 'package.json'), JSON.stringify({
      name: 'pkg-a',
      version: '1.0.0',
      dsh: { client: { platform: 'web', immediately: true } },
    }))
    await mkdir(join(root, 'node_modules', 'pkg-b'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg-b', 'package.json'), JSON.stringify({
      name: 'pkg-b',
      version: '1.0.0',
      dsh: { client: { platform: 'web', inject: ['pkg-a'] } },
    }))
    const testBundles = [
      { name: 'pkg-a', version: '1.0.0', source: 'pkg-a@1.0.0', installed: true, availability: 'profile', removable: true, enabled: true },
      { name: 'pkg-b', version: '1.0.0', source: 'pkg-b@1.0.0', installed: true, availability: 'profile', removable: true, enabled: true },
      { name: '@deepseek-ai/dsh-base', version: '0.2.1-rc.5', availability: 'installation', installed: false },
    ]
    const registry = {
      async release(name) {
        return {
          version: '1.2.0',
          registry: 'https://registry.npmjs.org',
          manifest: { name, version: '1.2.0', dsh: { bundle: { patch: './cordis.patch.yml' } }, dist: { integrity: INTEGRITY_A } },
        }
      },
    }
    const { engine } = makeEngine({ registry, manager: makeManager({ bundles: testBundles }), profileDir: root })
    const snapshot = await engine.check({ force: true })
    const first = snapshot.updates.find((row) => row.name === 'pkg-a')
    const second = snapshot.updates.find((row) => row.name === 'pkg-b')
    assert.equal(first.bootCritical, true)
    assert.deepEqual(first.dependents, ['pkg-b'])
    assert.equal(second.bootCritical, false)
    assert.deepEqual(second.dependents, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('queues until every task is idle and then updates', async () => {
  let busy = true
  const { engine, manager } = makeEngine({
    activity: async () => ({ known: true, busy, agents: busy ? 1 : 0, jobs: 0 }),
    queue: { pollMs: 10, quietMs: 20, countdownMs: 10 },
  })
  await engine.check({ force: true })
  const started = await engine.start(['pkg-a'], { waitForIdle: true })
  assert.equal(started.job.state, 'queued')
  await new Promise((resolve) => setTimeout(resolve, 40))
  busy = false
  await waitFor(() => {
    const state = engine.state.job?.state
    return state === 'done' || state === 'failed'
  }, 4000)
  assert.equal(engine.state.job.state, 'done')
  assert.ok(manager.calls.some((call) => call[0] === 'remove'))
})

test('cancels a queued job before it starts', async () => {
  const { engine, manager } = makeEngine({
    activity: async () => ({ known: true, busy: true, agents: 1, jobs: 0 }),
    queue: { pollMs: 10, quietMs: 20, countdownMs: 10 },
  })
  await engine.check({ force: true })
  await engine.start(['pkg-a'], { waitForIdle: true })
  const cancelled = engine.cancel()
  assert.equal(cancelled.job.state, 'cancelled')
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(manager.calls.length, 0)
})

test('requests a reload for a client plugin update', async () => {
  const { engine } = makeEngine()
  await engine.check({ force: true })
  engine.state.rows[0].hasClient = true
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running')
  const job = engine.state.job
  assert.equal(job.reloadRequired, true)
  assert.equal(job.restartRequired, false)
})

test('restart wins over reload for a boot-tier client plugin', async () => {
  const { engine } = makeEngine()
  await engine.check({ force: true })
  engine.state.rows[0].hasClient = true
  engine.state.rows[0].bootCritical = true
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running')
  const job = engine.state.job
  assert.equal(job.restartRequired, true)
  assert.equal(job.reloadRequired, false)
})

test('refuses to start while DSH itself has a pending update', async () => {
  const { engine } = makeEngine()
  await engine.check({ force: true })
  engine.setDesktopUpdate({ phase: 'available', version: '0.3.0' })
  await assert.rejects(engine.start(['pkg-a']), (error) => error.code === 'dsh-update')
  engine.setDesktopUpdate({ phase: 'idle' })
  const started = await engine.start(['pkg-a'])
  assert.equal(started.job.state, 'running')
  await waitFor(() => engine.state.job.state !== 'running')
})

test('acknowledging a reload clears the pending reload flag', async () => {
  const { engine } = makeEngine()
  await engine.check({ force: true })
  engine.state.rows[0].hasClient = true
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running')
  assert.equal(engine.state.job.reloadRequired, true)
  const snapshot = engine.acknowledgeReload(engine.state.job.id)
  assert.equal(snapshot.job.reloadRequired, false)
  assert.equal(typeof snapshot.job.reloadedAt, 'number')
})

test('restart-required installation suppresses the reload prompt', async () => {
  const { engine } = makeEngine({
    manager: makeManager({ install: async () => ({ changed: true, application: 'restart-required' }) }),
  })
  await engine.check({ force: true })
  engine.state.rows[0].hasClient = true
  await engine.start(['pkg-a'])
  await waitFor(() => engine.state.job.state !== 'running')
  const job = engine.state.job
  assert.equal(job.restartRequired, true)
  assert.equal(job.reloadRequired, false)
})
