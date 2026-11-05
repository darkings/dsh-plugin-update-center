/**
 * Full desktop restart for the restart button.
 *
 * A page reload only replaces the renderer; the DSH Host keeps running the old
 * plugin code, which is exactly how the client/Host mismatch crash happens.
 * The desktop app exposes no restart bridge to plugins, and a PowerShell child
 * of the Host can be killed together with its process tree. Instead the Host
 * writes a small batch file and opens its VBS launcher through Explorer: the
 * launcher lives outside the DSH process tree, waits, kills the whole app,
 * waits again, and starts the same executable.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const APP_EXE = /^DeepSeek Harness\.exe$/i

/** Quote a path for a cmd.exe line. */
function quoteCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

/** Quote a path as a VBScript string literal. */
function quoteVbs(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

/** Build the batch that stops and relaunches the desktop app. */
export function buildRestartBatch(execPath, logPath = null) {
  const log = logPath === null ? null : quoteCmd(logPath)
  const logLine = (message) => log === null
    ? `echo %DATE% %TIME% ${message}`
    : `echo %DATE% %TIME% ${message} >> ${log}`
  return [
    '@echo off',
    'ping -n 2 127.0.0.1 >nul',
    logLine('restart start'),
    `taskkill /IM "DeepSeek Harness.exe" /T /F >> ${log ?? 'nul'} 2>&1`,
    logLine('stopped'),
    'ping -n 3 127.0.0.1 >nul',
    `start "" ${quoteCmd(execPath)}`,
    logLine('relaunched'),
    '',
  ].join('\r\n')
}

/** Build a hidden VBS launcher for the batch. */
export function buildRestartLauncher(batchPath) {
  return [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run "cmd.exe /c " & Chr(34) & ${quoteVbs(batchPath)} & Chr(34), 0, False`,
    '',
  ].join('\r\n')
}

/**
 * @param {object} [options]
 * @param {string} [options.execPath] desktop executable
 * @param {NodeJS.Platform} [options.platform]
 * @param {Function} [options.spawn]
 * @param {Function} [options.exists]
 * @param {string | null} [options.logPath]
 * @param {object} [options.environment]
 */
export function createRestartService({
  execPath = process.execPath,
  platform = process.platform,
  spawn: spawnChild = spawn,
  exists = existsSync,
  logPath = null,
  environment = process.env,
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

  /**
   * Write the batch + launcher, then ask Explorer to run the launcher. Resolve
   * only after Explorer spawned so a failure reaches the client instead of
   * leaving the UI on "restarting" forever.
   */
  async function restart() {
    if (!canRestart()) return { ok: false, code: 'restart-unavailable' }
    const root = environment.SystemRoot ?? environment.windir ?? 'C:\\Windows'
    const explorer = join(root, 'explorer.exe')
    if (!exists(explorer)) return { ok: false, code: 'restart-unavailable' }
    const dir = join(environment.TEMP ?? environment.TMP ?? '.', 'dsh-plugin-update-center-restart')
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const batchPath = join(dir, `restart-${stamp}.cmd`)
    const launcherPath = join(dir, `restart-${stamp}.vbs`)
    const log = logPath === null ? join(dir, 'restart.log') : logPath
    try {
      mkdirSync(dir, { recursive: true })
      mkdirSync(dirname(log), { recursive: true })
      writeFileSync(batchPath, buildRestartBatch(execPath, log), 'utf8')
      writeFileSync(launcherPath, buildRestartLauncher(batchPath), 'utf8')
    } catch (error) {
      return { ok: false, code: 'restart-unavailable', error: String(error?.message ?? error) }
    }
    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      let child
      try {
        child = spawnChild(explorer, [launcherPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        })
      } catch (error) {
        finish({ ok: false, code: 'restart-unavailable', error: String(error?.message ?? error) })
        return
      }
      child.once?.('error', (error) => {
        finish({ ok: false, code: 'restart-unavailable', error: String(error?.message ?? error) })
      })
      child.once?.('spawn', () => {
        child.unref?.()
        finish({ ok: true })
      })
      if (typeof child.once !== 'function') {
        child.unref?.()
        finish({ ok: true })
      }
    })
  }

  return { canRestart, restart }
}
