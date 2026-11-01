/**
 * Same-origin HTTP face of the update engine.
 *
 * DSH's connection layer authenticates the browser peer; this route only
 * accepts POST requests that carry the plugin's header and a bounded JSON body.
 */

import { errorCode } from './engine.js'

export const ROUTE = '/api/dsh-plugin-update-center'
const MAX_BODY_BYTES = 8 * 1024
const EXPECTED = new Set([
  'busy',
  'busy-session',
  'check-first',
  'release-changed',
  'invalid-request',
  'request-too-large',
  'method-not-allowed',
  'registry-unavailable',
  'snapshot-failed',
  'rollback-unavailable',
  'verification-failed',
  'dsh-update',
])

function respond(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function readBody(request, limit) {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > limit) throw Object.assign(new Error('request-too-large'), { code: 'request-too-large' })
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw Object.assign(new Error('request-too-large'), { code: 'request-too-large' })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

function statusFor(code) {
  if (code === 'request-too-large') return 413
  if (code === 'method-not-allowed') return 405
  if (code === 'registry-unavailable') return 502
  if (code === 'snapshot-failed' || code === 'verification-failed') return 500
  if (code === 'busy' || code === 'busy-session' || code === 'check-first' || code === 'rollback-unavailable' || code === 'dsh-update') return 409
  return EXPECTED.has(code) ? 400 : 500
}

/**
 * Create the route handler for one engine.
 * @param {ReturnType<import('./engine.js').createEngine>} engine
 * @param {{ scan: Function, clean: Function } | null} [residue]
 */
export function createHandler(engine, residue = null) {
  if (!engine || typeof engine.snapshot !== 'function') throw new TypeError('an update engine is required')
  return async function handle(request) {
    let action = 'unknown'
    try {
      if (request.method !== 'POST') return respond({ ok: false, code: 'method-not-allowed' }, 405)
      if (request.headers.get('x-dsh-plugin-update-center') !== '1') return respond({ ok: false, code: 'invalid-request' }, 400)
      const contentType = request.headers.get('content-type') ?? ''
      if (!/^application\/json(?:;|$)/i.test(contentType)) return respond({ ok: false, code: 'invalid-request' }, 400)
      const text = await readBody(request, MAX_BODY_BYTES)
      let input
      try {
        input = text === '' ? {} : JSON.parse(text)
      } catch {
        return respond({ ok: false, code: 'invalid-request' }, 400)
      }
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return respond({ ok: false, code: 'invalid-request' }, 400)
      action = typeof input.action === 'string' ? input.action : 'unknown'
      switch (action) {
        case 'state':
          return respond({ ok: true, value: engine.snapshot() })
        case 'check':
          return respond({ ok: true, value: await engine.check({ force: input.force === true }) })
        case 'start':
          return respond({ ok: true, value: await engine.start(input.names, { waitForIdle: input.waitForIdle === true }) })
        case 'cancel':
          return respond({ ok: true, value: engine.cancel() })
        case 'reload-ack':
          return respond({
            ok: true,
            value: engine.acknowledgeReload(typeof input.jobId === 'string' ? input.jobId : undefined),
          })
        case 'desktop-update':
          return respond({ ok: true, value: engine.setDesktopUpdate({ phase: input.phase, version: input.version }) })
        case 'residue':
          return respond({
            ok: true,
            value: residue === null
              ? { checkedAt: Date.now(), items: [], cleanable: 0, error: null }
              : await residue.scan(),
          })
        case 'clean-residue':
          return respond({
            ok: true,
            value: residue === null
              ? { cleaned: [], residue: { checkedAt: Date.now(), items: [], cleanable: 0, error: null } }
              : await residue.clean(),
          })
        case 'dismiss':
          return respond({ ok: true, value: engine.dismiss() })
        default:
          return respond({ ok: false, code: 'invalid-request' }, 400)
      }
    } catch (error) {
      const code = errorCode(error)
      if (!EXPECTED.has(code)) console.warn('[dsh-plugin-update-center] %s failed:', action, code)
      return respond({ ok: false, code }, statusFor(code))
    }
  }
}
