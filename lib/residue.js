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
    cleanable: items.filter((item) => item.kind === 'selection' || item.kind === 'patch').length,
    error: null,
  }
}

/**
 * Remove the YAML blocks that carry dangling `name:` lines.
 *
 * A top-level override is removed whole. Inside an `- insert:` block only the
 * child item that owns the dangling line is removed. Other lines, comments and
 * formatting stay byte-for-byte untouched; the caller validates and writes
 * atomically.
 */
function stripPatchItems(text, danglingLines) {
  const lines = text.split(/\r?\n/)
  const remove = new Set()
  const removed = []
  const tops = []
  for (let index = 0; index < lines.length; index += 1) {
    if (/^-\s/.test(lines[index])) tops.push(index)
  }
  for (let position = 0; position < tops.length; position += 1) {
    const start = tops[position]
    const end = position + 1 < tops.length ? tops[position + 1] : lines.length
    const hits = danglingLines.filter((line) => line - 1 >= start && line - 1 < end)
    if (hits.length === 0) continue
    const isInsert = /^-\s+insert:/.test(lines[start])
    if (!isInsert) {
      for (let index = start; index < end; index += 1) remove.add(index)
      removed.push({ kind: 'patch', from: start + 1, to: end, count: hits.length })
      continue
    }
    let childIndent = null
    for (let index = start + 1; index < end; index += 1) {
      const match = /^(\s+)-\s/.exec(lines[index])
      if (match !== null) {
        childIndent = match[1].length
        break
      }
    }
    if (childIndent === null) continue
    const prefix = ' '.repeat(childIndent) + '- '
    const children = []
    for (let index = start + 1; index < end; index += 1) {
      if (lines[index].startsWith(prefix)) children.push(index)
    }
    for (let child = 0; child < children.length; child += 1) {
      const childStart = children[child]
      const childEnd = child + 1 < children.length ? children[child + 1] : end
      const childHits = danglingLines.filter((line) => line - 1 >= childStart && line - 1 < childEnd)
      if (childHits.length === 0) continue
      for (let index = childStart; index < childEnd; index += 1) remove.add(index)
      removed.push({ kind: 'patch', from: childStart + 1, to: childEnd, count: childHits.length })
    }
  }
  return { text: lines.filter((_, index) => !remove.has(index)).join('\n'), removed }
}

async function writeAtomic(path, text) {
  const temporary = path + '.residue-' + Date.now() + '.tmp'
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, path)
}

/**
 * Clean dangling selections and dangling patch rows. Data directories are
 * never touched. The profile files are snapshotted first and written
 * atomically; the patch text keeps every untouched line verbatim.
 */
export async function cleanResidue({ profileDir, homeDir, manager, backup }) {
  const before = await scanResidue({ profileDir, homeDir, manager })
  const selectionNames = before.items.filter((item) => item.kind === 'selection').map((item) => item.name)
  const patchLines = before.items.filter((item) => item.kind === 'patch').map((item) => item.line)
  if (selectionNames.length === 0 && patchLines.length === 0) {
    return { cleaned: [], residue: before }
  }
  await backup?.create?.({ reason: 'residue-cleanup', selections: selectionNames, patchLines })
  const cleaned = []

  if (selectionNames.length > 0) {
    const manifestPath = join(profileDir, MANIFEST_FILE)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const current = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    const removable = new Set(selectionNames.filter((name) => current.includes(name)))
    if (removable.size > 0) {
      manifest.dsh = {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh?.profile,
          bundles: current.filter((name) => !removable.has(name)),
        },
      }
      const next = JSON.stringify(manifest, null, 2) + '\n'
      JSON.parse(next)
      await writeAtomic(manifestPath, next)
      cleaned.push(...[...removable].map((name) => ({ kind: 'selection', name })))
    }
  }

  if (patchLines.length > 0) {
    const patchPath = join(profileDir, PATCH_FILE)
    const original = await readFile(patchPath, 'utf8')
    const stripped = stripPatchItems(original, patchLines)
    if (stripped.text !== original) {
      const removedPatchNames = before.items
        .filter((item) => item.kind === "patch" && stripped.removed.some((range) => item.line >= range.from && item.line <= range.to))
        .map((item) => item.name)
      await writeAtomic(patchPath, stripped.text)
      cleaned.push(...removedPatchNames.map((name) => ({ kind: "patch", name })))
    }
  }

  return { cleaned, residue: await scanResidue({ profileDir, homeDir, manager }) }
}

/** Service wrapper used by the HTTP route. */
export function createResidueService({ profileDir, homeDir, manager, backup }) {
  if (typeof profileDir !== 'string' || profileDir === '') throw new TypeError('profileDir is required')
  return {
    scan: () => scanResidue({ profileDir, homeDir, manager }),
    clean: () => cleanResidue({ profileDir, homeDir, manager, backup }),
  }
}
