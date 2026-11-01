import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'repair.mjs')

test('lists and restores the latest snapshot without installing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-plugin-updater-repair-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    const snapshot = join(home, 'plugin-updates', 'snapshots', '2026-01-01T00-00-00-000Z')
    await mkdir(profile, { recursive: true })
    await mkdir(snapshot, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{"name":"broken",')
    await writeFile(join(profile, 'cordis.patch.yml'), 'broken: [')
    await writeFile(join(snapshot, 'package.json'), JSON.stringify({ name: 'restored', dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2))
    await writeFile(join(snapshot, 'cordis.patch.yml'), '[]\n')
    await writeFile(join(snapshot, 'meta.json'), JSON.stringify({ createdAt: 1, files: ['package.json', 'cordis.patch.yml'] }))

    const env = { ...process.env, DSH_HOME: home }
    const listed = spawnSync(process.execPath, [script, '--list'], { env, encoding: 'utf8' })
    assert.equal(listed.status, 0, listed.stderr)
    assert.match(listed.stdout, /2026-01-01T00-00-00-000Z/)

    const restored = spawnSync(process.execPath, [script, '--profile', 'desktop', '--no-install'], { env, encoding: 'utf8' })
    assert.equal(restored.status, 0, restored.stderr)
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    assert.equal(manifest.name, 'restored')
    assert.equal((await readFile(join(profile, 'cordis.patch.yml'), 'utf8')).trim(), '[]')

    const backups = (await readdir(join(home, 'plugin-updates')))
      .filter((name) => name.startsWith('broken-'))
    assert.equal(backups.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
