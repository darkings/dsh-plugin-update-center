#!/usr/bin/env node
/**
 * Emergency repair for a profile that no longer boots.
 *
 * Every update batch writes a snapshot of package.json, pnpm-lock.yaml,
 * pnpm-workspace.yaml, cordis.patch.yml and cordis.yml under
 * `$DSH_HOME/plugin-updates/snapshots/<timestamp>/`. When DSH cannot open,
 * run this script from a terminal (or double-click repair.cmd). It copies the
 * current broken files aside, restores the chosen snapshot, and asks the
 * bundled dsh CLI to reinstall the profile dependencies.
 *
 * Usage:
 *   node repair.mjs --list
 *   node repair.mjs [--profile desktop] [--snapshot <dir-name>] [--no-install]
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'cordis.yml']

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? fallback : value
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function fail(message) {
  console.error('repair: ' + message)
  process.exit(1)
}

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profile = arg('--profile', 'desktop')
const profileDir = join(home, 'profiles', profile)
const snapshotsRoot = join(home, 'plugin-updates', 'snapshots')

if (!existsSync(join(profileDir, 'package.json'))) fail('profile not found: ' + profileDir)

async function listSnapshots() {
  const entries = await readdir(snapshotsRoot, { withFileTypes: true }).catch(() => [])
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  if (names.length === 0) {
    console.log('repair: no snapshots under ' + snapshotsRoot)
    return []
  }
  for (const name of names) {
    let meta = {}
    try {
      meta = JSON.parse(await readFile(join(snapshotsRoot, name, 'meta.json'), 'utf8'))
    } catch {}
    const when = meta.createdAt ? new Date(meta.createdAt).toLocaleString() : 'unknown time'
    const plugins = Array.isArray(meta.plugins) ? meta.plugins.map((item) => item.name).join(', ') : ''
    console.log(`  ${name}  ${when}${plugins === '' ? '' : '  -> ' + plugins}`)
  }
  return names
}

if (process.argv.includes('--list')) {
  console.log('snapshots under ' + snapshotsRoot + ':')
  await listSnapshots()
  process.exit(0)
}

const names = await listSnapshots()
const requested = arg('--snapshot')
if (requested !== undefined && !names.includes(requested)) fail('snapshot not found: ' + requested)
const chosen = requested ?? names[names.length - 1]
if (chosen === undefined) fail('no snapshot available; nothing to restore')
const snapshotDir = join(snapshotsRoot, chosen)

const brokenDir = join(home, 'plugin-updates', 'broken-' + stamp())
await mkdir(brokenDir, { recursive: true })
let saved = 0
for (const name of FILES) {
  const source = join(profileDir, name)
  if (!existsSync(source)) continue
  await cp(source, join(brokenDir, name), { force: true })
  saved += 1
}
console.log(`repair: current profile files saved to ${brokenDir} (${saved})`)

let restored = 0
for (const name of FILES) {
  const source = join(snapshotDir, name)
  if (!existsSync(source)) continue
  await cp(source, join(profileDir, name), { force: true })
  restored += 1
  console.log('repair: restored ' + name)
}
if (restored === 0) fail('snapshot contains no restorable file: ' + snapshotDir)

if (process.argv.includes('--no-install')) {
  console.log('repair: skipped dependency install (--no-install)')
  process.exit(0)
}

function findDshCommand() {
  const candidates = []
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  if (process.execPath.toLowerCase().endsWith('deepseek harness.exe')) {
    candidates.push(join(dirname(process.execPath), 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  }
  return candidates.find((candidate) => existsSync(candidate))
}

const dsh = findDshCommand()
if (dsh === undefined) {
  console.log('repair: restored the profile files, but the dsh CLI was not found.')
  console.log('repair: install plugins manually: dsh plugin --profile ' + profile + ' install')
  process.exit(0)
}

console.log('repair: reinstalling profile dependencies…')
const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${dsh}" plugin --profile ${profile} install`], {
  stdio: 'inherit',
  env: process.env,
})
if (result.status !== 0) {
  fail('dependency install failed; restore the files manually from ' + snapshotDir)
}
console.log('repair: done. Start DSH again.')
