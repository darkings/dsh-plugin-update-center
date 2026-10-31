import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry } from '../lib/registry.js'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

test('reads the latest dist-tag and its version document', async () => {
  const urls = []
  const registry = createRegistry({
    fetchImpl: async (url) => {
      urls.push(String(url))
      if (String(url).endsWith('/-/package/pkg-a/dist-tags')) return jsonResponse({ latest: '2.0.0' })
      if (String(url).endsWith('/pkg-a/2.0.0')) return jsonResponse({ name: 'pkg-a', version: '2.0.0' })
      return jsonResponse({}, 404)
    },
  })
  const release = await registry.release('pkg-a')
  assert.equal(release.version, '2.0.0')
  assert.equal(release.registry, 'https://registry.npmjs.org')
  assert.equal(release.manifest.version, '2.0.0')
  assert.equal(urls.length, 2)
})

test('falls back to the mirror when the primary registry fails', async () => {
  const registry = createRegistry({
    fetchImpl: async (url) => {
      const target = String(url)
      if (target.startsWith('https://registry.npmjs.org')) throw new Error('offline')
      if (target.endsWith('/-/package/pkg-a/dist-tags')) return jsonResponse({ latest: '3.1.0' })
      if (target.endsWith('/pkg-a/3.1.0')) return jsonResponse({ name: 'pkg-a', version: '3.1.0' })
      return jsonResponse({}, 404)
    },
  })
  const release = await registry.release('pkg-a')
  assert.equal(release.version, '3.1.0')
  assert.equal(release.registry, 'https://registry.npmmirror.com')
})

test('encodes scoped package names', async () => {
  const urls = []
  const registry = createRegistry({
    fetchImpl: async (url) => {
      urls.push(String(url))
      if (String(url).endsWith('/-/package/%40scope%2Fpkg/dist-tags')) return jsonResponse({ latest: '1.0.1' })
      if (String(url).endsWith('/%40scope%2Fpkg/1.0.1')) return jsonResponse({ name: '@scope/pkg', version: '1.0.1' })
      return jsonResponse({}, 404)
    },
  })
  const release = await registry.release('@scope/pkg')
  assert.equal(release.version, '1.0.1')
  assert.equal(urls[0], 'https://registry.npmjs.org/-/package/%40scope%2Fpkg/dist-tags')
})

test('rejects version documents for another name or version', async () => {
  const registry = createRegistry({
    fetchImpl: async (url) => {
      const target = String(url)
      if (target.endsWith('/dist-tags')) return jsonResponse({ latest: '1.2.0' })
      return jsonResponse({ name: 'other', version: '9.9.9' })
    },
  })
  await assert.rejects(registry.release('pkg-a'), (error) => error.code === 'registry-version-mismatch')
})

test('bounds oversized registry responses', async () => {
  const registry = createRegistry({
    maxBytes: 64,
    fetchImpl: async () => jsonResponse({ latest: '1.0.0', padding: 'x'.repeat(1024) }),
  })
  await assert.rejects(registry.release('pkg-a'), (error) => error.code === 'registry-response-too-large')
})
