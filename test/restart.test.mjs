import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRestartScript, createRestartService } from '../lib/restart.js'

const EXE = 'C:\\Users\\Jie\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'

test('builds a detached stop and relaunch script', () => {
  const script = buildRestartScript(EXE)
  assert.match(script, /Start-Sleep/)
  assert.match(script, /Stop-Process -Force/)
  assert.match(script, /Start-Process -FilePath \$exe/)
  assert.match(script, /DeepSeek Harness\.exe/)
})

test('relaunches through powershell with the encoded script', () => {
  const calls = []
  const service = createRestartService({
    execPath: EXE,
    platform: 'win32',
    exists: () => true,
    spawn: (file, args) => {
      calls.push([file, ...args])
      return { unref() {} }
    },
  })
  assert.equal(service.canRestart(), true)
  assert.deepEqual(service.restart(), { ok: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'powershell.exe')
  const index = calls[0].indexOf('-EncodedCommand')
  assert.ok(index > 0)
  const script = Buffer.from(calls[0][index + 1], 'base64').toString('utf16le')
  assert.match(script, /Stop-Process/)
  assert.match(script, /Start-Process/)
})

test('refuses automatic restart outside the desktop executable', () => {
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
  assert.deepEqual(service.restart(), { ok: false, code: 'restart-unavailable' })
  assert.equal(spawned, false)
})
