import test from 'node:test'
import assert from 'node:assert/strict'
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
  const install = overrides.install ?? (async () => ({ changed: true, application: 'applied' }))
  const remove = overrides.remove ?? (async () => ({ changed: true, application: 'applied' }))
  return {
    calls,
    async listBundles() {
      return overrides.bundles ?? bundles()
    },
    async removeBundle(name) {
      calls.push(['remove', name])
      return remove(name)
    },
    async installBundle(spec, options) {
      calls.push(['install', spec, options])
      return install(spec, options)
    },
  }
}

function makeRegistry(entry) {
  const calls = []
  return {
    calls,
    async release(name, signal, options = {}) {
      calls.push({ name, version: options.version })
      if (name !== 'pkg-a' || entry === undefined) throw Object.assign(new Error('registry-unavailable'), { code: 'registry-unavailable' })
      const version = options.version ?? entry.version
      const document = entry.manifests?.[version] ?? (version === entry.version ? entry.manifest : undefined)
      if (document === undefined) throw Object.assign(new Error('registry-unavailable'), { code: 'registry-unavailable' })
      return { version, registry: 'https://registry.npmjs.org', manifest: document }
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
