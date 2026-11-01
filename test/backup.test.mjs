import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup } from '../lib/backup.js'

async function makeProfile() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-plugin-update-center-home-'))
  const profile = join(home, 'profiles', 'desktop')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    dependencies: { 'pkg-a': '1.0.0' },
    dsh: { profile: { bundles: ['pkg-a'] } },
  }, null, 2))
  await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(profile, 'cordis.yml'), '[]\n')
  return { home, profile }
}

test('snapshots profile files with metadata and history', async () => {
  const { home, profile } = await makeProfile()
  try {
    const backup = createBackup({ profileDir: profile, homeDir: home, clock: () => 1000 })
    const snapshot = await backup.create({ reason: 'test', plugins: [{ name: 'pkg-a', from: '1.0.0', to: '1.1.0' }] })
    assert.ok(snapshot.files.includes('package.json'))
    assert.ok(snapshot.files.includes('pnpm-lock.yaml'))
    assert.ok(snapshot.files.includes('cordis.patch.yml'))
    const meta = JSON.parse(await readFile(join(snapshot.dir, 'meta.json'), 'utf8'))
    assert.deepEqual(meta.bundles, ['pkg-a'])
    assert.equal(meta.plugins[0].to, '1.1.0')

    await backup.history({ plugin: 'pkg-a', ok: true })
    const lines = (await readFile(join(home, 'plugin-updates', 'history.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1)
    assert.equal(JSON.parse(lines[0]).plugin, 'pkg-a')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('keeps only the requested number of snapshots', async () => {
  const { home, profile } = await makeProfile()
  try {
    const first = createBackup({ profileDir: profile, homeDir: home, keep: 2, clock: () => 1000 })
    await first.create({})
    const second = createBackup({ profileDir: profile, homeDir: home, keep: 2, clock: () => 2000 })
    await second.create({})
    const third = createBackup({ profileDir: profile, homeDir: home, keep: 2, clock: () => 3000 })
    await third.create({})
    const dirs = (await readdir(join(home, 'plugin-updates', 'snapshots'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    assert.equal(dirs.length, 2)
    assert.equal(dirs.includes('1970-01-01T00-00-01-000Z'), false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
