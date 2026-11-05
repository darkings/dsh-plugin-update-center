/**
 * Full desktop restart for the restart button.
 *
 * A page reload only replaces the renderer; the DSH Host keeps running the old
 * plugin code, which is exactly how the client/Host mismatch crash happens.
 * The desktop app exposes no restart bridge to plugins, so the Host launches a
 * detached PowerShell script, waits for the HTTP response to flush, closes the
 * app (and the Host itself), then starts the same executable again.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

const APP_EXE = /^DeepSeek Harness\.exe$/i

/** Quote one PowerShell single-quoted string. */
function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

/** Build the script that closes and relaunches the desktop app. */
export function buildRestartScript(execPath) {
  return [
    'Start-Sleep -Milliseconds 900',
    `$exe = ${quotePowerShell(execPath)}`,
    "Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
    'Start-Sleep -Milliseconds 1200',
    'Start-Process -FilePath $exe',
  ].join('\r\n')
}

/**
 * @param {object} [options]
 * @param {string} [options.execPath] desktop executable (the Host runs inside it)
 * @param {NodeJS.Platform} [options.platform]
 * @param {Function} [options.spawn]
 * @param {Function} [options.exists]
 */
export function createRestartService({
  execPath = process.execPath,
  platform = process.platform,
  spawn: spawnChild = spawn,
  exists = existsSync,
} = {}) {
  function canRestart() {
    if (platform !== 'win32') return false
    if (typeof execPath !== 'string' || !APP_EXE.test(basename(execPath))) return false
    try {
      return exists(execPath)
    } catch {
      return false
    }
  }

  function restart() {
    if (!canRestart()) return { ok: false, code: 'restart-unavailable' }
    const script = buildRestartScript(execPath)
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawnChild('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-EncodedCommand',
      encoded,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref?.()
    return { ok: true }
  }

  return { canRestart, restart }
}
