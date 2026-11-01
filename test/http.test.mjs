import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../lib/http.js'

const URL_BASE = 'http://localhost/api/dsh-plugin-updater'

function makeEngine() {
  return {
    snapshot: () => ({ checkedAt: 7, updates: [{ name: 'pkg-a' }] }),
    check: async ({ force }) => ({ forced: force === true }),
    start: async (names) => ({ started: names }),
    cancel: () => ({ cancelled: true }),
    acknowledgeReload: (jobId) => ({ ack: jobId }),
    setDesktopUpdate: (info) => ({ desktop: info }),
    dismiss: () => ({ dismissed: true }),
  }
}

function post(body, { header = true, contentType = 'application/json', method = 'POST' } = {}) {
  const headers = {}
  if (contentType !== null) headers['content-type'] = contentType
  if (header) headers['x-dsh-plugin-updater'] = '1'
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

test('maps expected engine failures to stable status codes', async () => {  const handler = createHandler({
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

test('dispatches cancel, desktop-update and residue actions', async () => {
  const residue = {
    scan: async () => ({ checkedAt: 1, items: [{ kind: 'selection', name: 'pkg-gone' }], cleanable: 1 }),
    clean: async () => ({ cleaned: [{ kind: 'selection', name: 'pkg-gone' }], residue: { checkedAt: 2, items: [], cleanable: 0 } }),
  }
  const handler = createHandler(makeEngine(), residue)

  const cancel = await handler(post(JSON.stringify({ action: 'cancel' })))
  assert.deepEqual(await cancel.json(), { ok: true, value: { cancelled: true } })

  const ack = await handler(post(JSON.stringify({ action: 'reload-ack', jobId: 'job-1' })))
  assert.deepEqual(await ack.json(), { ok: true, value: { ack: 'job-1' } })

  const desktop = await handler(post(JSON.stringify({ action: 'desktop-update', phase: 'available', version: '0.3.0' })))
  assert.deepEqual(await desktop.json(), { ok: true, value: { desktop: { phase: 'available', version: '0.3.0' } } })

  const scan = await handler(post(JSON.stringify({ action: 'residue' })))
  assert.equal((await scan.json()).value.cleanable, 1)

  const clean = await handler(post(JSON.stringify({ action: 'clean-residue' })))
  assert.deepEqual((await clean.json()).value.cleaned, [{ kind: 'selection', name: 'pkg-gone' }])
})

test('maps a pending DSH update to 409', async () => {
  const handler = createHandler({
    snapshot: () => null,
    check: async () => null,
    start: async () => { throw Object.assign(new Error('dsh-update'), { code: 'dsh-update' }) },
    dismiss: () => null,
  })
  const response = await handler(post(JSON.stringify({ action: 'start', names: ['pkg-a'] })))
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { ok: false, code: 'dsh-update' })
})
