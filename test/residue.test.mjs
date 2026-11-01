import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanResidue, scanResidue } from '../lib/residue.js'

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-plugin-updater-residue-'))
  const profile = join(home, 'profiles', 'desktop')
  await mkdir(join(profile, 'node_modules', 'pkg-keep'), { recursive: true })
  await mkdir(join(home, 'pkg-gone'), { recursive: true })
  await writeFile(join(profile, 'node_modules', 'pkg-keep', 'package.json'), JSON.stringify({ name: 'pkg-keep', version: '1.0.0' }))
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    dependencies: { 'pkg-keep': '1.0.0' },
    dsh: { profile: { bundles: ['pkg-keep', 'pkg-gone', '@deepseek-ai/dsh-base'] } },
  }, null, 2))
  await writeFile(join(profile, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: keep',
    '      name: pkg-keep',
    '    - id: gone',
    '      name: pkg-gone-row',
    '- id: override-x',
    '  name: missing-plugin',
    '',
  ].join('\n'))
  const manager = {
    async listBundles() {
      return [
        { name: 'pkg-keep', installed: true, availability: 'profile' },
        { name: 'pkg-gone', installed: false, availability: 'missing', error: { code: 'not-bundle' } },
        { name: '@deepseek-ai/dsh-base', installed: false, availability: 'installation' },
      ]
    },
  }
  return { home, profile, manager }
}

test('finds dangling selections, patch references and data directories', async () => {
  const { home, profile, manager } = await fixture()
  try {
    const residue = await scanResidue({ profileDir: profile, homeDir: home, manager })
    const kinds = residue.items.map((item) => item.kind + ':' + item.name).sort()
    assert.deepEqual(kinds, [
      'data:pkg-gone',
      'patch:missing-plugin',
      'patch:pkg-gone-row',
      'selection:pkg-gone',
    ])
    assert.equal(residue.cleanable, 3)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('cleans dangling selections and patch rows while keeping the manifest valid', async () => {
  const { home, profile, manager } = await fixture()
  try {
    const created = []
    const backup = { create: async (meta) => { created.push(meta); return { dir: 'snapshot' } } }
    const result = await cleanResidue({ profileDir: profile, homeDir: home, manager, backup })
    assert.deepEqual(
      result.cleaned.map((item) => item.kind + ':' + item.name).sort(),
      ['patch:missing-plugin', 'patch:pkg-gone-row', 'selection:pkg-gone'],
    )
    assert.equal(created.length, 1)
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, ['pkg-keep', '@deepseek-ai/dsh-base'])
    const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /name: pkg-keep/)
    assert.doesNotMatch(patch, /pkg-gone-row/)
    assert.doesNotMatch(patch, /missing-plugin/)
    const after = await scanResidue({ profileDir: profile, homeDir: home, manager })
    assert.equal(after.cleanable, 0)
    assert.deepEqual(after.items, [])
    assert.equal(existsSync(join(home, 'pkg-gone')), true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
