/**
 * Leftover-reference scanner for the active profile.
 *
 * The official uninstall removes the dependency, the bundle selection and the
 * package files. What remains is profile configuration that still names a
 * package: a dangling `dsh.profile.bundles` entry, a user patch row, or a
 * plugin data directory. Only the dangling selection is safe to remove
 * automatically; the rest is reported for a manual decision.
 */

import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PATCH_FILE = 'cordis.patch.yml'
const MANIFEST_FILE = 'package.json'
const OFFICIAL_PREFIX = '@deepseek-ai/'
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)?$/i

function packageRootOf(value) {
  if (/[:\\/]/.test(value) && !value.startsWith('@')) return null
  if (value.startsWith('@')) {
    const parts = value.split('/')
    return parts.length >= 2 ? parts[0] + '/' + parts[1] : null
  }
  return value.split('/')[0]
}

function isModuleName(value) {
  if (!PACKAGE_NAME.test(value)) return false
  if (value.startsWith('@')) return true
  return value.includes('-') || value.includes('/') || value.startsWith('dsh-')
}

function scanPatchReferences(text, profileDir) {
  const items = []
  const lines = text.split(/\r?\n/)
  let inInsert = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^-\s+insert:/.test(line)) {
      inInsert = true
      continue
    }
    if (/^-\s+/.test(line)) inInsert = false
    const match = /^(\s*)name:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/.exec(line)
    if (match === null) continue
    const indent = match[1].length
    const value = match[2]
    if (!isModuleName(value)) continue
    if (value.startsWith(OFFICIAL_PREFIX)) continue
    if (inInsert === false && indent > 2) continue
    const root = packageRootOf(value)
    if (root === null) continue
    if (existsSync(join(profileDir, 'node_modules', root, MANIFEST_FILE))) continue
    items.push({ kind: 'patch', name: value, line: index + 1, text: line.trim() })
  }
  return items
}

function scanDataDirectories(danglingNames, homeDir) {
  const items = []
  for (const name of danglingNames) {
    if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) continue
    const path = join(homeDir, name)
    if (!existsSync(path)) continue
    items.push({ kind: 'data', name, path })
  }
  return items
}

/**
 * Scan one profile for leftover references.
 * @param {object} options
 * @param {string} options.profileDir
 * @param {string} options.homeDir
 * @param {object} options.manager pluginManager (listBundles)
 */
export async function scanResidue({ profileDir, homeDir, manager }) {
  const checkedAt = Date.now()
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(profileDir, MANIFEST_FILE), 'utf8'))
  } catch {
    return { checkedAt, items: [], cleanable: 0, error: 'manifest-unreadable' }
  }
  const dependencies = manifest?.dependencies ?? {}
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  let rows = []
  try {
    if (typeof manager?.listBundles === 'function') rows = await manager.listBundles()
  } catch {
    rows = []
  }
  const installed = new Set(Object.keys(dependencies))
  const shipped = new Set()
  const catalog = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.name !== 'string') continue
    if (row.availability === 'installation') shipped.add(row.name)
    if (row.installTarget !== undefined) catalog.add(row.name)
  }
  const items = []
  const dangling = []
  for (const name of bundles) {
    if (typeof name !== 'string') continue
    if (installed.has(name) || shipped.has(name) || catalog.has(name)) continue
    const row = rows.find((entry) => entry?.name === name)
    if (row?.installed === true) continue
    dangling.push(name)
    items.push({ kind: 'selection', name, detail: row?.error?.code ?? 'missing' })
  }
  let patchText
  try {
    patchText = await readFile(join(profileDir, PATCH_FILE), 'utf8')
  } catch {
    patchText = null
  }
  if (typeof patchText === 'string') items.push(...scanPatchReferences(patchText, profileDir))
  if (typeof homeDir === 'string' && homeDir !== '') items.push(...scanDataDirectories(dangling, homeDir))
  return {
    checkedAt,
    items,
    cleanable: items.filter((item) => item.kind === 'selection').length,
    error: null,
  }
}

/**
 * Remove only dangling bundle selections. Patch rows and data directories stay
 * untouched. Returns the refreshed scan.
 */
export async function cleanResidue({ profileDir, homeDir, manager, backup, names }) {
  const manifestPath = join(profileDir, MANIFEST_FILE)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const current = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const removable = new Set(Array.isArray(names) && names.length > 0
    ? names.filter((name) => current.includes(name))
    : (await scanResidue({ profileDir, homeDir, manager })).items.filter((item) => item.kind === 'selection').map((item) => item.name))
  if (removable.size === 0) return { cleaned: [], residue: await scanResidue({ profileDir, homeDir, manager }) }
  await backup?.create?.({ reason: 'residue-cleanup', removed: [...removable] })
  manifest.dsh = {
    ...manifest.dsh,
    profile: {
      ...manifest.dsh?.profile,
      bundles: current.filter((name) => !removable.has(name)),
    },
  }
  const next = JSON.stringify(manifest, null, 2) + '\n'
  JSON.parse(next)
  const temporary = manifestPath + '.residue-' + Date.now() + '.tmp'
  await writeFile(temporary, next, 'utf8')
  await rename(temporary, manifestPath)
  return { cleaned: [...removable], residue: await scanResidue({ profileDir, homeDir, manager }) }
}

/** Service wrapper used by the HTTP route. */
export function createResidueService({ profileDir, homeDir, manager, backup }) {
  if (typeof profileDir !== 'string' || profileDir === '') throw new TypeError('profileDir is required')
  return {
    scan: () => scanResidue({ profileDir, homeDir, manager }),
    clean: (names) => cleanResidue({ profileDir, homeDir, manager, backup, names }),
  }
}
