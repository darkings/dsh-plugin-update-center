import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../lib/http.js'

const URL_BASE = 'http://localhost/api/dsh-plugin-updates'

function makeEngine() {
  return {
    snapshot: () => ({ checkedAt: 7, updates: [{ name: 'pkg-a' }] }),
    check: async ({ force }) => ({ forced: force === true }),
    start: async (names) => ({ started: names }),
    dismiss: () => ({ dismissed: true }),
  }
}

function post(body, { header = true, contentType = 'application/json', method = 'POST' } = {}) {
  const headers = {}
  if (contentType !== null) headers['content-type'] = contentType
  if (header) headers['x-dsh-plugin-updates'] = '1'
  return new Request(URL_BASE, {
    method,
    headers,
    body: method === 'GET' ? undefined : body,
  })
}

test('serves the update snapshot over POST', async () => {
  const handler = createHandler(makeEngine())
  const response = await handler(post(JSON.stringify({ action: 'state' })))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, value: { checkedAt: 7, updates: [{ name: 'pkg-a' }] } })
})

test('rejects other methods, missing headers and bad content types', async () => {
  const handler = createHandler(makeEngine())
  assert.equal((await handler(post('', { method: 'GET' }))).status, 405)
  assert.equal((await handler(post(JSON.stringify({ action: 'state' }), { header: false }))).status, 400)
  assert.equal((await handler(post(JSON.stringify({ action: 'state' }), { contentType: 'text/plain' }))).status, 400)
})

test('rejects malformed JSON and unknown actions', async () => {
  const handler = createHandler(makeEngine())
  assert.equal((await handler(post('{'))).status, 400)
  assert.equal((await handler(post(JSON.stringify({ action: 'nope' })))).status, 400)
  assert.equal((await handler(post(JSON.stringify([])))).status, 400)
})

test('dispatches check, start and dismiss', async () => {
  const handler = createHandler(makeEngine())
  const check = await handler(post(JSON.stringify({ action: 'check', force: true })))
  assert.deepEqual(await check.json(), { ok: true, value: { forced: true } })
  const start = await handler(post(JSON.stringify({ action: 'start', names: ['pkg-a'] })))
  assert.deepEqual(await start.json(), { ok: true, value: { started: ['pkg-a'] } })
  const dismiss = await handler(post(JSON.stringify({ action: 'dismiss' })))
  assert.deepEqual(await dismiss.json(), { ok: true, value: { dismissed: true } })
})

test('maps expected engine failures to stable status codes', async () => {
  const handler = createHandler({
    snapshot: () => null,
    check: async () => { throw Object.assign(new Error('registry-unavailable'), { code: 'registry-unavailable' }) },
    start: async () => { throw Object.assign(new Error('busy-session'), { code: 'busy-session' }) },
    dismiss: () => null,
  })
  const check = await handler(post(JSON.stringify({ action: 'check' })))
  assert.equal(check.status, 502)
  assert.deepEqual(await check.json(), { ok: false, code: 'registry-unavailable' })
  const start = await handler(post(JSON.stringify({ action: 'start', names: ['pkg-a'] })))
  assert.equal(start.status, 409)
  assert.deepEqual(await start.json(), { ok: false, code: 'busy-session' })
})

test('bounds the request body', async () => {
  const handler = createHandler(makeEngine())
  const response = await handler(post(JSON.stringify({ action: 'state', pad: 'x'.repeat(9000) })))
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { ok: false, code: 'request-too-large' })
})
