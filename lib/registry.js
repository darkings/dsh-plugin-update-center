/**
 * npm registry access for the update checker.
 *
 * Only public registry metadata is read. The official DSH plugin manager owns
 * the actual installation; this module never writes packages or profile files.
 */

import { parseVersion } from './versions.js'

export const DEFAULT_REGISTRIES = Object.freeze([
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
])

const USER_AGENT = 'dsh-plugin-update-center/1.0.0'

/** One bounded registry failure expressed as a stable code. */
export class RegistryError extends Error {
  constructor(code) {
    super(code)
    this.name = 'RegistryError'
    this.code = code
  }
}

async function readBounded(stream, limit, signal) {
  const reader = stream.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw new RegistryError('registry-response-too-large')
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

/**
 * Create the registry client used by the engine.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] fetch implementation (tests inject one)
 * @param {number} [options.timeoutMs] per-request timeout
 * @param {readonly string[]} [options.registries] registries asked in order
 * @param {number} [options.maxBytes] response size cap
 */
export function createRegistry({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  registries = DEFAULT_REGISTRIES,
  maxBytes = 4 * 1024 * 1024,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const bases = registries.filter((base) => typeof base === 'string' && /^https?:\/\//.test(base))
  if (bases.length === 0) throw new TypeError('at least one registry is required')

  async function json(url, signal) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await fetchImpl(url, {
      redirect: 'error',
      signal: combined,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    })
    if (!response.ok || response.body === null) {
      await response.body?.cancel().catch(() => {})
      throw new RegistryError(`registry-http-${response.status}`)
    }
    const text = await readBounded(response.body, maxBytes, combined)
    try {
      return JSON.parse(text)
    } catch {
      throw new RegistryError('registry-invalid-json')
    }
  }

  function validVersion(value) {
    return typeof value === 'string' && parseVersion(value) !== null
  }

  async function distTag(base, name, signal) {
    const encoded = encodeURIComponent(name)
    try {
      const tags = await json(`${base}/-/package/${encoded}/dist-tags`, signal)
      if (validVersion(tags?.latest)) return tags.latest
    } catch (error) {
      signal?.throwIfAborted()
    }
    const packument = await json(`${base}/${encoded}`, signal)
    if (validVersion(packument?.['dist-tags']?.latest)) return packument['dist-tags'].latest
    throw new RegistryError('registry-no-latest')
  }

  async function latest(name, signal) {
    let lastError
    for (const base of bases) {
      try {
        return { version: await distTag(base, name, signal), registry: base }
      } catch (error) {
        signal?.throwIfAborted()
        lastError = error
      }
    }
    throw lastError ?? new RegistryError('registry-unavailable')
  }

  async function manifest(name, version, signal, preferred) {
    const encoded = encodeURIComponent(name)
    const order = preferred === undefined
      ? bases
      : [preferred, ...bases.filter((base) => base !== preferred)]
    let lastError
    for (const base of order) {
      try {
        const document = await json(`${base}/${encoded}/${version}`, signal)
        if (document?.name !== name || document?.version !== version) throw new RegistryError('registry-version-mismatch')
        return { manifest: document, registry: base }
      } catch (error) {
        signal?.throwIfAborted()
        lastError = error
      }
    }
    throw lastError ?? new RegistryError('registry-unavailable')
  }

  /**
   * Resolve one release. Without `version` the registry `latest` tag is used.
   * @param {string} name package name
   * @param {AbortSignal} [signal]
   * @param {{ version?: string }} [options]
   */
  async function release(name, signal, options = {}) {
    const resolved = options.version === undefined
      ? await latest(name, signal)
      : { version: options.version, registry: undefined }
    const found = await manifest(name, resolved.version, signal, resolved.registry)
    return { version: resolved.version, registry: found.registry, manifest: found.manifest }
  }

  return { latest, manifest, release }
}
