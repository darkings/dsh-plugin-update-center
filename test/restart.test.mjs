import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRestartBatch,
  buildRestartLauncher,
  createRestartService,
} from '../lib/restart.js'

const EXE = 'C:\\Users\\Jie\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'

test('builds a batch that stops and relaunches the desktop app', () => {
  const batch = buildRestartBatch(EXE, 'C:\\Temp\\restart.log')
  assert.match(batch, /taskkill \/IM "DeepSeek Harness\.exe" \/T \/F/)
  assert.match(batch, /start "" "C:\\Users\\Jie\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness\.exe"/)
  assert.match(batch, /restart\.log/)
})

test('builds a hidden VBS launcher for the batch', () => {
  const launcher = buildRestartLauncher('C:\\Temp\\restart.cmd')
  assert.match(launcher, /WScript\.Shell/)
  assert.match(launcher, /restart\.cmd/)
  assert.match(launcher, /, 0, False/)
})

test('starts the launcher through Explorer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-restart-'))
  try {
    const calls = []
    const service = createRestartService({
      execPath: EXE,
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows', TEMP: root },
      exists: () => true,
      logPath: join(root, 'restart.log'),
      spawn: (file, args) => {
        calls.push([file, ...args])
        return { unref() {} }
      },
    })
    assert.equal(service.canRestart(), true)
    assert.deepEqual(await service.restart(), { ok: true })
    assert.equal(calls.length, 1)
    assert.match(calls[0][0], /explorer\.exe$/i)
    const launcher = calls[0][1]
    assert.match(launcher, /\.vbs$/)
    const launcherText = await readFile(launcher, 'utf8')
    assert.match(launcherText, /WScript\.Shell/)
    const batchPath = launcher.replace(/\.vbs$/, '.cmd')
    const batch = await readFile(batchPath, 'utf8')
    assert.match(batch, /taskkill/)
    assert.match(batch, /DeepSeek Harness\.exe/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses automatic restart outside the desktop executable', async () => {
  let spawned = false
  const service = createRestartService({
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    platform: 'win32',
    exists: () => true,
    spawn: () => {
      spawned = true
      return { unref() {} }
    },
  })
  assert.equal(service.canRestart(), false)
  assert.deepEqual(await service.restart(), { ok: false, code: 'restart-unavailable' })
  assert.equal(spawned, false)
})
