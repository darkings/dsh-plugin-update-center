/**
 * Profile snapshots and an update history kept outside the profile.
 *
 * A snapshot is the only rollback point that survives a hard crash or a DSH
 * that no longer boots, so the engine refuses to update when it cannot create
 * one. `repair.mjs` restores the same directory from a terminal.
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const SNAPSHOT_FILES = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cordis.patch.yml',
  'cordis.yml',
])

function stampOf(ms) {
  return new Date(ms).toISOString().replace(/[:.]/g, '-')
}

/**
 * @param {object} options
 * @param {string} options.profileDir absolute profile directory
 * @param {string} options.homeDir absolute DSH home directory
 * @param {() => number} [options.clock]
 * @param {number} [options.keep] retained snapshots
 */
export function createBackup({ profileDir, homeDir, clock = () => Date.now(), keep = 10 } = {}) {
  if (typeof profileDir !== 'string' || profileDir === '') throw new TypeError('profileDir is required')
  if (typeof homeDir !== 'string' || homeDir === '') throw new TypeError('homeDir is required')
  const root = join(homeDir, 'plugin-updates')
  const snapshots = join(root, 'snapshots')

  /**
   * Copy the profile's authoritative files into a new timestamped snapshot.
   * @param {Record<string, unknown>} meta extra facts stored beside the files
   * @returns {Promise<{ dir: string, files: string[] }>}
   */
  async function create(meta = {}) {
    const dir = join(snapshots, stampOf(clock()))
    await mkdir(dir, { recursive: true })
    const copied = []
    for (const name of SNAPSHOT_FILES) {
      const source = join(profileDir, name)
      if (!existsSync(source)) continue
      await cp(source, join(dir, name), { force: true })
      copied.push(name)
    }
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    await writeFile(join(dir, 'meta.json'), JSON.stringify({
      schema: 1,
      createdAt: clock(),
      profileDir,
      files: copied,
      dependencies: manifest?.dependencies ?? {},
      bundles: manifest?.dsh?.profile?.bundles ?? [],
      ...meta,
    }, null, 2) + '\n')
    await prune()
    return { dir, files: copied }
  }

  async function prune() {
    const entries = (await readdir(snapshots, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    for (const old of entries.slice(0, Math.max(0, entries.length - keep))) {
      await rm(join(snapshots, old), { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Append one human-readable line per plugin attempt. */
  async function history(entry) {
    try {
      await mkdir(root, { recursive: true })
      await writeFile(join(root, 'history.jsonl'), JSON.stringify({ at: clock(), ...entry }) + '\n', { flag: 'a' })
    } catch {
      // History is diagnostic only; never fail an update over it.
    }
  }

  return { create, history, root, snapshots }
}
