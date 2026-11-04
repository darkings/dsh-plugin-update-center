/**
 * Client half of the plugin update center.
 *
 * Renders one entry in the sidebar foot (the official `sidebar.footer.action`
 * seat next to Settings / the DSH update indicator), a DSH `Modal` listing the
 * available plugin updates, and a progress bar while the Host applies them.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-update-center',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const UI = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const NS = 'dsh-plugin-update-center'
    const ROUTE = new URL('api/dsh-plugin-update-center', document.baseURI)

    const zh = {
      'action.label': '插件更新',
      'action.tooltip': '{count} 个插件可更新',
      'action.running': '正在更新 {done}/{total}',
      'panel.title': '插件更新',
      'panel.progressTitle': '正在更新插件',
      'panel.close': '关闭',
      'panel.cancel': '取消',
      'panel.update': '更新 {count} 个插件',
      'panel.background': '后台运行',
      'panel.done': '完成',
      'list.summary': '发现 {count} 个可更新插件',
      'list.lastChecked': '上次检查 {time}',
      'list.recheck': '重新检查',
      'list.checking': '正在检查…',
      'list.disabled': '已停用',
      'list.empty': '所有插件都是最新版本',
      'check.checking': '正在检查插件更新…',
      'check.failed': '检查失败：{code}',
      'check.retry': '重试',
      'progress.current': '正在更新 {name}（{done}/{total}）',
      'progress.waiting': '准备更新…',
      'phase.verifying': '核对版本',
      'phase.removing': '移除旧版',
      'phase.installing': '安装新版',
      'phase.finished': '完成',
      'status.waiting': '等待',
      'status.done': '已更新',
      'status.restart': '待重启',
      'status.failed': '失败',
      'status.failedRolledBack': '失败，已回滚',
      'status.failedUnreconciled': '失败，待处理',
      'status.skipped': '跳过（依赖失败项）',
      'done.partial': '已更新 {updated} 个，{failed} 个失败已回滚。',
      'done.retryHint': '失败项保持旧版本；可立即重试，或重启 DSH 后重新检查。',
      'done.retryFailed': '重试失败项',
      'done.retryBusy': '正在重试…',
      'done.unreconciled': '更新未完成，请勿重启；请先重试失败项或恢复快照。',
      'done.skipped': '{count} 个依赖项已跳过。',
      'done.restart': '新版本已安装。请完整重启 DSH 后再使用，不要只刷新页面。',
      'done.refresh': '更新已安装；如界面仍是旧版本，请刷新页面或重启 DSH。',
      'done.snapshot': '更新前快照：{path}',
      'risk.boot': '启动关键',
      'risk.provider': '被 {count} 个插件依赖',
      'risk.unselected': '{count} 个启动关键 / 被依赖插件未勾选。请单独更新它们，并在更新后立即重启验证。',
      'risk.warning': '选中的插件包含启动关键项。更新后请立即重启验证；若 DSH 无法打开，在错误对话框点「禁用第三方插件、备份 profile patch 并重启」，或运行 repair.cmd 恢复快照。',
      'done.summary': '已更新 {count} 个插件',
      'done.stopped': '更新在 {name} 处停止',
      'done.rollbackOk': '已自动回滚到旧版本。',
      'done.rollbackFailed': '回滚未完成，请到「插件」管理页手动检查。',
      'error.busy': '已有更新任务正在进行，请稍候。',
      'error.busy-session': '有会话正在运行，请等任务结束后再更新。',
      'error.check-first': '更新列表已过期，请重新检查。',
      'error.release-changed': '版本信息在检查后发生变化，已停止更新。',
      'error.invalid-request': '请求无效。',
      'error.registry-unavailable': '无法连接 npm registry。',
      'error.request-too-large': '请求内容过大。',
      'error.operation-failed': '操作未完成，请重试。',
      'error.service-unavailable': '更新服务不可用，请刷新页面。',
      'error.snapshot-failed': '无法创建 profile 快照，已取消本次更新。',
      'error.rollback-unavailable': '旧版本在 registry 中已不可用，无法安全回滚，已取消。',
      'error.verification-failed': '安装后校验失败，已自动回滚到旧版本。',
      'error.dsh-update': 'DSH 本体有更新，先完成 DSH 更新再更新插件。',
      'action.waiting': '等待任务完成',
      'queue.offer': '有任务正在运行。可以在任务完成后自动开始更新。',
      'queue.button': '任务完成后自动更新',
      'queue.title': '等待任务完成',
      'queue.waiting': '等待任务完成（{agents} 个对话 / {jobs} 个后台任务）',
      'queue.waitingDesktop': '等待 DSH 本体更新完成',
      'queue.starting': '任务已完成，{seconds} 秒后开始更新',
      'queue.cancel': '取消排队',
      'desktop.blocked': 'DSH 本体有更新（{phase}），先完成 DSH 更新再更新插件。',
      'refresh.countdown': '更新完成，{seconds} 秒后自动刷新页面',
      'refresh.cancel': '取消',
      'refresh.needed': '需要刷新页面才能加载新版本。',
      'refresh.now': '刷新页面',
      'refresh.done': '页面已刷新，新版本已加载。',
      'residue.title': '卸载残留',
      'residue.tooltip': '{count} 项卸载残留',
      'residue.summary': '发现 {count} 项可能由卸载遗留的引用',
      'residue.selection': 'profile 里多出的插件选择',
      'residue.patch': 'cordis.patch.yml 里的失效引用',
      'residue.data': '可能遗留的数据目录',
      'residue.cleanable': '可清理',
      'residue.manual': '需手动确认',
      'residue.note': '清理悬空的插件选择和失效的补丁条目（自动备份 profile）；数据目录不会自动删除。',
      'residue.clean': '清理',
      'residue.cleaned': '已清理 {count} 项',
      'residue.scan': '重新扫描',
      'residue.line': '第 {line} 行',
    }

    const en = {
      'action.label': 'Plugin updates',
      'action.tooltip': '{count} plugin updates available',
      'action.running': 'Updating {done}/{total}',
      'panel.title': 'Plugin updates',
      'panel.progressTitle': 'Updating plugins',
      'panel.close': 'Close',
      'panel.cancel': 'Cancel',
      'panel.update': 'Update {count} plugins',
      'panel.background': 'Run in background',
      'panel.done': 'Done',
      'list.summary': '{count} updates available',
      'list.lastChecked': 'Checked {time}',
      'list.recheck': 'Check again',
      'list.checking': 'Checking…',
      'list.disabled': 'Disabled',
      'list.empty': 'All plugins are up to date',
      'check.checking': 'Checking for plugin updates…',
      'check.failed': 'Check failed: {code}',
      'check.retry': 'Retry',
      'progress.current': 'Updating {name} ({done}/{total})',
      'progress.waiting': 'Preparing…',
      'phase.verifying': 'Verifying release',
      'phase.removing': 'Removing previous version',
      'phase.installing': 'Installing new version',
      'phase.finished': 'Finished',
      'status.waiting': 'Waiting',
      'status.done': 'Updated',
      'status.restart': 'Restart needed',
      'status.failed': 'Failed',
      'status.failedRolledBack': 'Failed, rolled back',
      'status.failedUnreconciled': 'Failed, needs attention',
      'status.skipped': 'Skipped (dependency failed)',
      'done.partial': '{updated} updated, {failed} failed and rolled back.',
      'done.retryHint': 'Failed plugins stay on their old version. Retry now or restart DSH and retry from the update list.',
      'done.retryFailed': 'Retry failed',
      'done.retryBusy': 'Retrying…',
      'done.unreconciled': 'The update did not finish. Do not restart yet; retry the failed plugins or restore the snapshot.',
      'done.skipped': '{count} dependent plugins skipped.',
      'done.restart': 'New versions are installed. Restart DSH completely; do not just refresh the page.',
      'done.refresh': 'Updates are installed. Refresh the page or restart DSH if the UI still shows the old version.',
      'done.snapshot': 'Pre-update snapshot: {path}',
      'risk.boot': 'Boot-critical',
      'risk.provider': 'Used by {count} plugins',
      'risk.unselected': '{count} boot-critical / depended-on plugins are not selected. Update them one at a time and restart to verify.',
      'risk.warning': 'The selection includes boot-critical plugins. Restart and verify right after updating; if DSH will not open, use “Disable third-party plugins” in the error dialog or run repair.cmd to restore the snapshot.',
      'done.summary': '{count} plugins updated',
      'done.stopped': 'Update stopped at {name}',
      'done.rollbackOk': 'The previous version was restored automatically.',
      'done.rollbackFailed': 'Restore did not finish. Check the Plugins page.',
      'error.busy': 'Another update is already running.',
      'error.busy-session': 'A session is running. Wait for it to finish before updating.',
      'error.check-first': 'This update list is stale. Check again.',
      'error.release-changed': 'Release metadata changed after the check. Nothing was installed.',
      'error.invalid-request': 'Invalid request.',
      'error.registry-unavailable': 'The npm registry is unreachable.',
      'error.request-too-large': 'The request was too large.',
      'error.operation-failed': 'The operation did not finish. Try again.',
      'error.service-unavailable': 'The update service is unavailable. Refresh the page.',
      'error.snapshot-failed': 'A profile snapshot could not be created, so the update was cancelled.',
      'error.rollback-unavailable': 'The previous release is no longer available on the registry, so a safe rollback is impossible. Cancelled.',
      'error.verification-failed': 'Post-install verification failed; the previous version was restored.',
      'error.dsh-update': 'DSH itself has an update. Finish the DSH update before updating plugins.',
      'action.waiting': 'Waiting for tasks',
      'queue.offer': 'A task is running. You can start the update automatically after it finishes.',
      'queue.button': 'Update after tasks finish',
      'queue.title': 'Waiting for tasks',
      'queue.waiting': 'Waiting for tasks ({agents} conversations / {jobs} background jobs)',
      'queue.waitingDesktop': 'Waiting for the DSH update to finish',
      'queue.starting': 'Tasks finished. Starting in {seconds}s',
      'queue.cancel': 'Cancel queue',
      'desktop.blocked': 'DSH has an update ({phase}). Finish the DSH update before updating plugins.',
      'refresh.countdown': 'Update complete. Refreshing the page in {seconds}s',
      'refresh.cancel': 'Cancel',
      'refresh.needed': 'Refresh the page to load the new version.',
      'refresh.now': 'Refresh page',
      'refresh.done': 'The page was refreshed and the new version is loaded.',
      'residue.title': 'Uninstall leftovers',
      'residue.tooltip': '{count} uninstall leftovers',
      'residue.summary': '{count} references may be left over from uninstalls',
      'residue.selection': 'Extra plugin selections in the profile',
      'residue.patch': 'Dangling cordis.patch.yml references',
      'residue.data': 'Possible leftover data directories',
      'residue.cleanable': 'Safe to clean',
      'residue.manual': 'Review manually',
      'residue.note': 'Dangling selections and broken patch rows are removed with a profile snapshot as backup; data directories are never deleted automatically.',
      'residue.clean': 'Clean',
      'residue.cleaned': 'Cleaned {count} items',
      'residue.scan': 'Scan again',
      'residue.line': 'line {line}',
    }

    const STYLE = [
      '.dshpu-rowHost{display:inline-flex;flex:none;align-items:center;gap:4px;min-width:0}',
      '.dshpu-chip{box-sizing:border-box;display:inline-grid;grid-template-columns:14px max-content;align-items:center;column-gap:4px;height:28px;padding:0 8px;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 20%, transparent);border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);background:color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 8%, transparent);font-family:inherit;font-size:12px;font-weight:500;line-height:18px;white-space:nowrap;cursor:pointer;flex:none}',
      '.dshpu-chip:hover{background:color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6) 14%, transparent)}',
      '.dshpu-chip.is-residue{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#b26a00) 25%, transparent);color:var(--dsw-alias-state-warn-primary,#b26a00);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#b26a00) 8%, transparent)}',
      '.dshpu-chip.is-residue:hover{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#b26a00) 14%, transparent)}',
      '.dshpu-chip:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:2px}',
      '.dshpu-chipIcon{display:grid;place-items:center;width:14px;height:14px}',
      '.dshpu-chipText{font-variant-numeric:tabular-nums}',
      '.dshpu-spin{animation:dshpu-rotate 1s linear infinite}',
      '@keyframes dshpu-rotate{to{transform:rotate(360deg)}}',
      '.dshpu-body{display:flex;flex-direction:column;gap:14px;min-height:160px}',
      '.dshpu-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#657080)}',
      '.dshpu-summaryText{min-width:0}',
      '.dshpu-link{display:inline-flex;align-items:center;gap:4px;border:0;background:none;color:var(--dsw-alias-label-secondary,#657080);font:inherit;font-size:12px;line-height:18px;cursor:pointer;border-radius:6px;padding:2px 6px;flex:none}',
      '.dshpu-link:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#f0f1f3);color:var(--dsw-alias-label-primary,#202124)}',
      '.dshpu-link:disabled{opacity:.5;cursor:default}',
      '.dshpu-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;max-height:min(46vh,360px);overflow:auto}',
      '.dshpu-row{display:flex;align-items:flex-start;gap:10px;padding:10px 8px;border-radius:8px}',
      '.dshpu-row:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f1f3)}',
      '.dshpu-row+.dshpu-row{border-top:1px solid var(--dsw-alias-border-l1,#eceef2)}',
      '.dshpu-row label>span:empty{display:none}',
      '.dshpu-rowMain{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}',
      '.dshpu-name{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary,#202124);overflow-wrap:anywhere}',
      '.dshpu-desc{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a94a6);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.dshpu-risk{margin-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#b26a00)}',
      '.dshpu-versions{display:flex;align-items:center;gap:4px;flex:none;font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#657080);white-space:nowrap;padding-top:1px}',
      '.dshpu-latest{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6)}',
      '.dshpu-status{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a94a6);white-space:nowrap;padding-top:1px}',
      '.dshpu-status[data-tone="success"]{color:var(--dsw-alias-state-success-primary,#1a8a4a)}',
      '.dshpu-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#d93025)}',
      '.dshpu-status[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary,#b26a00)}',
      '.dshpu-status[data-tone="busy"]{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6)}',
      '.dshpu-progress{display:flex;flex-direction:column;gap:8px}',
      '.dshpu-progressHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#657080)}',
      '.dshpu-progressName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshpu-percent{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#657080)}',
      '.dshpu-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#eceef2);overflow:hidden;position:relative}',
      '.dshpu-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);transition:width .35s ease}',
      '.dshpu-barFill.is-indeterminate{width:38%;animation:dshpu-slide 1.1s ease-in-out infinite}',
      '@keyframes dshpu-slide{0%{transform:translateX(-110%)}100%{transform:translateX(360%)}}',
      '.dshpu-note{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--dsw-alias-border-l1,#eceef2);border-radius:10px;padding:10px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#657080);background:var(--dsw-alias-bg-layer-2,#f7f8fa)}',
      '.dshpu-note svg{flex:none;margin-top:1px}',
      '.dshpu-note[data-tone="error"]{border-color:var(--dsw-alias-state-error-primary,#d93025);color:var(--dsw-alias-state-error-primary,#d93025)}',
      '.dshpu-note[data-tone="warn"]{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#b26a00) 45%, transparent);color:var(--dsw-alias-state-warn-primary,#b26a00)}',
      '.dshpu-note[data-tone="success"]{color:var(--dsw-alias-state-success-primary,#1a8a4a)}',
      '.dshpu-noteText{min-width:0;word-break:break-word}',
      '.dshpu-group{margin:2px 0 0;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary,#657080)}',
      '.dshpu-mono{font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.dshpu-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;width:100%}',
      '.dshpu-footerError{flex:1;min-width:0;margin-right:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#d93025);text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshpu-modal.dshpu-modal{width:560px;max-width:calc(100vw - 48px)}',
      '@media (prefers-reduced-motion: reduce){.dshpu-spin{animation:none}.dshpu-barFill{transition:none}}',
    ].join('')

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(next) {
          state = next
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    function errorCodeOf(error) {
      const message = typeof error?.message === 'string' ? error.message : ''
      return /^[a-z][a-z0-9-]{1,63}$/.test(message) ? message : 'service-unavailable'
    }

    function percentOf(job) {
      if (job === null || job === undefined) return 0
      if (job.total <= 0) return 0
      if (job.state === 'done') return 100
      const weight = job.current?.phase === 'verifying' ? 0.05
        : job.current?.phase === 'removing' ? 0.35
          : job.current?.phase === 'installing' ? 0.65
            : 0
      const value = Math.round(((job.done + weight) / job.total) * 100)
      return Math.max(0, Math.min(job.state === 'running' ? 99 : 100, value))
    }

    function apply(ctx) {
      const store = createStore({ snapshot: null, residue: null, loading: true, checking: false, error: null })
      let disposed = false
      let timer = null
      let lastCheckAttempt = 0
      let started = false

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-update-center: dictionaries')
      const t = ctx.locale.bind(NS)

      function useLocaleTick() {
        const [, force] = useState(0)
        useEffect(() => {
          const stop = ctx.locale.subscribe(() => force((value) => value + 1))
          return () => { if (typeof stop === 'function') stop() }
        }, [])
      }

      function message(code) {
        const known = /^(busy|busy-session|check-first|release-changed|invalid-request|registry-unavailable|request-too-large|operation-failed|service-unavailable|snapshot-failed|rollback-unavailable|verification-failed|dsh-update)$/
        return t(known.test(code) ? 'error.' + code : 'error.operation-failed')
      }

      async function api(body) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), body.action === 'check' ? 90000 : 30000)
        try {
          const response = await fetch(ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'content-type': 'application/json', 'x-dsh-plugin-update-center': '1' },
            body: JSON.stringify(body),
          })
          const data = await response.json().catch(() => null)
          if (!response.ok || data === null || data.ok !== true) throw new Error(data?.code ?? 'service-unavailable')
          return data.value
        } catch (error) {
          if (error?.name === 'AbortError') throw new Error('service-unavailable')
          throw error
        } finally {
          clearTimeout(timeout)
        }
      }

      function publish(patch) {
        if (disposed) return
        store.set({ ...store.get(), ...patch })
      }

      async function refresh() {
        try {
          const [snapshot, residue] = await Promise.all([
            api({ action: 'state' }),
            api({ action: 'residue' }).catch(() => null),
          ])
          publish({
            snapshot,
            ...residue === null ? {} : { residue },
            loading: false,
            error: null,
          })
          maybeCheck(snapshot)
        } catch (error) {
          publish({ loading: false, error: errorCodeOf(error) })
        }
      }

      function maybeCheck(snapshot) {
        if (disposed || snapshot === null || snapshot === undefined) return
        if (['queued', 'starting', 'running'].includes(snapshot.job?.state)) return
        if (snapshot.checking) return
        if (store.get().checking) return
        const stale = snapshot.checkedAt === 0 || Date.now() - snapshot.checkedAt > 30 * 60 * 1000
        if (!stale) return
        if (Date.now() - lastCheckAttempt < 60000) return
        lastCheckAttempt = Date.now()
        void checkUpdates(false)
      }

      async function checkUpdates(force) {
        if (disposed || store.get().checking) return
        publish({ checking: true, error: null })
        try {
          const snapshot = await api({ action: 'check', force: force === true })
          publish({ snapshot, checking: false, loading: false, error: null })
        } catch (error) {
          publish({ checking: false, loading: false, error: errorCodeOf(error) })
        }
        schedule()
      }

      async function startUpdates(names, waitForIdle) {
        const snapshot = await api({ action: 'start', names, waitForIdle: waitForIdle === true })
        publish({ snapshot, error: null })
        schedule()
      }

      async function cancelQueued() {
        try {
          const snapshot = await api({ action: 'cancel' })
          publish({ snapshot })
        } catch {
          // The next state read reconciles a stale cancel.
        }
      }

      async function cleanResidue() {
        const value = await api({ action: 'clean-residue' })
        publish({ residue: value.residue })
        return value
      }

      async function refreshResidue() {
        try {
          const residue = await api({ action: 'residue' })
          publish({ residue })
        } catch {
          // The next periodic refresh retries.
        }
      }

      const RELOAD_MARKER_PREFIX = 'dsh-plugin-update-center:reloaded:'

      function hasReloadMarker(jobId) {
        if (typeof jobId !== 'string') return false
        try {
          return globalThis.sessionStorage?.getItem(RELOAD_MARKER_PREFIX + jobId) === '1'
        } catch {
          return false
        }
      }

      function writeReloadMarker(jobId) {
        if (typeof jobId !== 'string') return
        try {
          globalThis.sessionStorage?.setItem(RELOAD_MARKER_PREFIX + jobId, '1')
        } catch {
          // Storage can be unavailable; the Host ack is the durable guard.
        }
      }

      async function acknowledgeReload(jobId) {
        try {
          const snapshot = await api({ action: 'reload-ack', jobId })
          publish({ snapshot })
        } catch {
          // Retried on the next state refresh.
        }
      }

      function acknowledgeReloadSoon(jobId) {
        if (typeof jobId !== 'string') return
        try {
          fetch(ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            keepalive: true,
            headers: { 'content-type': 'application/json', 'x-dsh-plugin-update-center': '1' },
            body: JSON.stringify({ action: 'reload-ack', jobId }),
          }).catch(() => {})
        } catch {
          // The session marker still prevents a loop.
        }
      }

      async function dismissJob() {
        try {
          const snapshot = await api({ action: 'dismiss' })
          publish({ snapshot })
        } catch {
          // A stale dismiss is harmless; the next state read reconciles it.
        }
      }

      function schedule() {
        if (disposed) return
        if (timer !== null) clearTimeout(timer)
        const fast = ['queued', 'starting', 'running'].includes(store.get().snapshot?.job?.state)
        timer = setTimeout(async () => {
          timer = null
          await refresh()
          schedule()
        }, fast ? 700 : 30000)
      }

      function useStoreValue() {
        const [value, setValue] = useState(store.get())
        useEffect(() => store.subscribe(() => setValue(store.get())), [])
        return value
      }

      function phaseLabel(phase) {
        return t('phase.' + (phase === 'verifying' || phase === 'removing' || phase === 'installing' || phase === 'finished' ? phase : 'finished'))
      }

      function StatusNote({ tone = 'info', icon, children }) {
        return h('div', { className: 'dshpu-note', 'data-tone': tone },
          icon,
          h('div', { className: 'dshpu-noteText' }, children),
        )
      }

      function UpdateRow({ name, description, from, to, disabled, status, tone, showCheckbox, checked, onToggle, bootCritical, dependents }) {
        const risks = []
        if (bootCritical === true) risks.push(t('risk.boot'))
        if ((dependents?.length ?? 0) > 0) risks.push(t('risk.provider', { count: dependents.length }))
        return h('li', { className: 'dshpu-row' },
          showCheckbox
            ? h(UI.Checkbox, {
              checked,
              disabled,
              onChange: onToggle,
            })
            : null,
          h('div', { className: 'dshpu-rowMain' },
            h('div', { className: 'dshpu-name' }, name),
            description ? h('div', { className: 'dshpu-desc' }, description) : null,
            risks.length > 0 ? h('div', { className: 'dshpu-risk' }, risks.join(' · ')) : null,
          ),
          h('div', { className: 'dshpu-versions' },
            h('span', null, from),
            h(UI.IconChevronRightOutlineRegular, { size: 12 }),
            h('span', { className: 'dshpu-latest' }, to),
          ),
          status !== undefined
            ? h('div', { className: 'dshpu-status', 'data-tone': tone ?? 'idle' }, status)
            : null,
        )
      }

      function ProgressView({ job, refresh, retryFailed, retryBusy }) {
        const [, setTick] = useState(0)
        const waiting = job.state === 'queued' || job.state === 'starting'
        const needsReload = refresh?.needsReload === true
        const refreshCancelled = refresh?.cancelled === true
        const refreshSeconds = refresh?.seconds ?? 0
        const results = job.results ?? []
        const successes = results.filter((entry) => entry.ok === true)
        const failures = results.filter((entry) => entry.ok !== true && entry.skipped !== true)
        const skipped = results.filter((entry) => entry.skipped === true)
        const unreconciled = failures.find((entry) => entry.reconciled !== true)

        useEffect(() => {
          if (job.state !== 'starting') return
          const ticker = setInterval(() => setTick((value) => value + 1), 250)
          return () => clearInterval(ticker)
        }, [job.state])

        const phaseText = job.waitingFor?.desktop === true
          ? t('queue.waitingDesktop')
          : t('queue.waiting', { agents: job.waitingFor?.agents ?? 0, jobs: job.waitingFor?.jobs ?? 0 })
        const countdown = job.countdownEndsAt === null || job.countdownEndsAt === undefined
          ? 0
          : Math.max(0, Math.ceil((job.countdownEndsAt - Date.now()) / 1000))
        const current = job.current
        const label = waiting
          ? phaseText
          : job.state === 'running'
            ? current === null
              ? t('progress.waiting')
              : t('progress.current', { name: current.name, done: job.done, total: job.total })
            : job.state === 'done'
              ? failures.length > 0
                ? t('done.partial', { updated: successes.length, failed: failures.length })
                : t('done.summary', { count: job.done })
              : t('done.stopped', { name: current?.name ?? '' })
        const percent = percentOf(job)
        const failureText = unreconciled === undefined
          ? null
          : t('done.stopped', { name: unreconciled.name }) + '：' + message(unreconciled.error ?? 'operation-failed')
        const rollbackText = unreconciled?.rollback == null
          ? ''
          : ' ' + (unreconciled.rollback.ok === true ? t('done.rollbackOk') : t('done.rollbackFailed'))
        const retryButton = failures.length > 0
          ? h('button', {
            type: 'button',
            className: 'dshpu-link',
            disabled: retryBusy === true,
            onClick: () => { void retryFailed?.() },
          }, retryBusy === true ? t('done.retryBusy') : t('done.retryFailed'))
          : null

        return h(React.Fragment, null,
          waiting
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconClockOutlineRegular, { size: 16 }) }, phaseText)
            : h('div', { className: 'dshpu-progress' },
              h('div', { className: 'dshpu-progressHead' },
                h('div', { className: 'dshpu-progressName' }, label),
                job.state === 'done' ? h('div', { className: 'dshpu-percent' }, '100%') : null,
              ),
              h('div', {
                className: 'dshpu-bar',
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': Math.round(percent),
                'aria-label': label,
              }, h('div', { className: 'dshpu-barFill', style: { width: percent + '%' } })),
              job.state === 'running' && current !== null
                ? h('div', { className: 'dshpu-summary' }, h('span', { className: 'dshpu-summaryText' }, phaseLabel(current.phase)))
                : null,
            ),
          job.state === 'starting'
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconClockOutlineRegular, { size: 16 }) },
              t('queue.starting', { seconds: countdown }))
            : null,
          h('ul', { className: 'dshpu-list' },
            (job.items ?? []).map((item) => {
              const result = results.find((entry) => entry.name === item.name)
              const isCurrent = job.state === 'running' && current?.name === item.name
              const status = result !== undefined
                ? result.ok === true
                  ? result.restartRequired === true ? t('status.restart') : t('status.done')
                  : result.skipped === true
                    ? t('status.skipped')
                    : result.reconciled === true
                      ? t('status.failedRolledBack')
                      : t('status.failedUnreconciled')
                : isCurrent
                  ? phaseLabel(current.phase)
                  : t('status.waiting')
              const tone = result !== undefined
                ? result.ok === true ? 'success' : result.skipped === true ? 'idle' : result.reconciled === true ? 'warn' : 'error'
                : isCurrent ? 'busy' : 'idle'
              return h(UpdateRow, {
                key: item.name,
                name: item.name,
                description: item.description,
                from: item.from,
                to: item.to,
                status,
                tone,
                showCheckbox: false,
              })
            }),
          ),
          job.state === 'failed' && failureText !== null
            ? h(StatusNote, { tone: 'error', icon: h(UI.IconWarningOutlineMedium, { size: 16 }) },
              failureText + rollbackText + ' ' + t('done.unreconciled'),
              retryButton)
            : null,
          job.state === 'done' && failures.length === 0
            ? h(StatusNote, { tone: 'success', icon: h(UI.IconCheckCircleOutlineRegular, { size: 16 }) },
              t('done.summary', { count: job.done }))
            : null,
          job.state === 'done' && failures.length > 0
            ? h(StatusNote, { tone: 'warn', icon: h(UI.IconWarningOutlineMedium, { size: 16 }) },
              t('done.partial', { updated: successes.length, failed: failures.length }) + ' ' + t('done.retryHint'),
              retryButton)
            : null,
          skipped.length > 0
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconInfoOutlineRegular, { size: 16 }) },
              t('done.skipped', { count: skipped.length }))
            : null,
          // Restart wins over reload: a full restart reloads the page too.
          job.state === 'done' && failures.length === 0 && job.restartRequired === true
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconInfoOutlineRegular, { size: 16 }) }, t('done.restart'))
            : null,
          job.state === 'done' && refresh?.reloaded === true
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconRefreshOutlineRegular, { size: 16 }) }, t('refresh.done'))
            : null,
          needsReload && refreshCancelled !== true
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconRefreshOutlineRegular, { size: 16 }) },
              t('refresh.countdown', { seconds: refreshSeconds }),
              h('button', {
                type: 'button',
                className: 'dshpu-link',
                onClick: () => refresh?.cancel?.(),
              }, t('refresh.cancel')))
            : null,
          needsReload && refreshCancelled === true
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconRefreshOutlineRegular, { size: 16 }) },
              t('refresh.needed'),
              h('button', {
                type: 'button',
                className: 'dshpu-link',
                onClick: () => { window.location.reload() },
              }, t('refresh.now')))
            : null,
          (job.state === 'done' || job.state === 'failed' || job.state === 'cancelled') && typeof job.snapshotDir === 'string'
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconInfoOutlineRegular, { size: 16 }) },
              t('done.snapshot', { path: job.snapshotDir }))
            : null,
        )
      }

      function ListView({ state, updates, selected, toggle, busy, queueOffer, desktopBlocked, desktopPhase }) {
        const snapshot = state.snapshot
        const checking = state.checking || snapshot?.checking === true
        const checkedAt = snapshot?.checkedAt
        const risky = (item) => item.bootCritical === true || (item.dependents?.length ?? 0) > 0
        const riskySelected = updates.filter((item) => selected.has(item.name) && risky(item))
        const riskyUnselected = updates.filter((item) => !selected.has(item.name) && risky(item))
        return h('div', { className: 'dshpu-body' },
          h('div', { className: 'dshpu-summary' },
            h('div', { className: 'dshpu-summaryText' },
              updates.length > 0 ? t('list.summary', { count: updates.length }) : t('list.empty'),
              checkedAt ? h('span', null, ' · ', t('list.lastChecked', { time: new Date(checkedAt).toLocaleTimeString() })) : null,
            ),
            h('button', {
              type: 'button',
              className: 'dshpu-link',
              disabled: checking,
              onClick: () => { void checkUpdates(true) },
            },
              h(UI.IconRefreshOutlineRegular, { size: 14 }),
              checking ? t('list.checking') : t('list.recheck'),
            ),
          ),
          desktopBlocked === true
            ? h(StatusNote, { tone: 'warn', icon: h(UI.IconWarningOutlineMedium, { size: 16 }) },
              t('desktop.blocked', { phase: desktopPhase }))
            : null,
          queueOffer === true
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconClockOutlineRegular, { size: 16 }) },
              t('queue.offer'))
            : null,
          riskyUnselected.length > 0
            ? h(StatusNote, { tone: 'warn', icon: h(UI.IconWarningOutlineMedium, { size: 16 }) },
              t('risk.unselected', { count: riskyUnselected.length }))
            : null,
          riskySelected.length > 0
            ? h(StatusNote, { tone: 'warn', icon: h(UI.IconWarningOutlineMedium, { size: 16 }) },
              t('risk.warning'))
            : null,
          updates.length > 0
            ? h('ul', { className: 'dshpu-list' },
              updates.map((item) => h(UpdateRow, {
                key: item.name,
                name: item.name,
                description: item.description,
                from: item.version,
                to: item.latest,
                disabled: busy,
                showCheckbox: true,
                checked: selected.has(item.name),
                onToggle: (checked) => toggle(item.name, checked),
                status: item.enabled === false ? t('list.disabled') : undefined,
                tone: 'idle',
                bootCritical: item.bootCritical,
                dependents: item.dependents,
              })),
            )
            : null,
          state.error !== null && state.error !== undefined
            ? h(StatusNote, { tone: 'error', icon: h(UI.IconWarningOutlineMedium, { size: 16 }) },
              t('check.failed', { code: state.error }))
            : null,
        )
      }

      function EmptyOrLoading({ state }) {
        if (state.error !== null) {
          return h('div', { className: 'dshpu-body' },
            h(StatusNote, { tone: 'error', icon: h(UI.IconWarningOutlineMedium, { size: 16 }) },
              t('check.failed', { code: state.error })),
            h('div', { className: 'dshpu-actions' },
              h(UI.Button, { variant: 'outline', onClick: () => { void checkUpdates(true) } }, t('check.retry')),
            ),
          )
        }
        return h('div', { className: 'dshpu-body' },
          h('div', { className: 'dshpu-summary' },
            h('div', { className: 'dshpu-summaryText' }, t('check.checking')),
          ),
          h('div', { className: 'dshpu-progress' },
            h('div', { className: 'dshpu-bar' },
              h('div', { className: 'dshpu-barFill is-indeterminate' }),
            ),
          ),
        )
      }

      function UpdatePanel({ open, onClose, refresh, retryFailed, retryBusy }) {
        const state = useStoreValue()
        const snapshot = state.snapshot
        const job = snapshot?.job ?? null
        const jobState = job?.state
        const showJob = job !== null && (['queued', 'starting', 'running'].includes(jobState) || (job.results?.length ?? 0) > 0)
        const checking = state.checking || snapshot?.checking === true
        const updates = snapshot?.updates ?? []
        const namesKey = updates.map((item) => item.name).join('|')
        const desktopPhase = snapshot?.desktopUpdate?.phase
        const desktopBlocked = typeof desktopPhase === 'string'
          && ['available', 'downloading', 'verifying', 'installing', 'ready'].includes(desktopPhase)
        const [selected, setSelected] = useState(() => new Set())
        const [busy, setBusy] = useState(false)
        const [actionError, setActionError] = useState(null)
        const [queueOffer, setQueueOffer] = useState(false)

        useLocaleTick()

        useEffect(() => {
          if (showJob) return
          // Boot-critical plugins and providers other plugins inject are left
          // unchecked: updating them alone can strand dependents on a missing
          // client service and make the next DSH window fail to boot.
          setSelected(new Set(updates
            .filter((item) => item.bootCritical !== true && (item.dependents?.length ?? 0) === 0)
            .map((item) => item.name)))
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [namesKey, showJob, open])

        useEffect(() => {
          if (open !== true) setQueueOffer(false)
        }, [open])

        function toggle(name, checked) {
          setSelected((current) => {
            const next = new Set(current)
            if (checked) next.add(name)
            else next.delete(name)
            return next
          })
        }

        async function submit(waitForIdle) {
          const names = [...selected]
          if (names.length === 0) return
          setBusy(true)
          setActionError(null)
          try {
            await startUpdates(names, waitForIdle === true)
            setQueueOffer(false)
          } catch (error) {
            const code = errorCodeOf(error)
            if (code === 'busy-session' && waitForIdle !== true) {
              setQueueOffer(true)
              setActionError(null)
            } else {
              setActionError(code)
            }
          } finally {
            setBusy(false)
          }
        }

        const handleClose = () => {
          if (job !== null && !['running', 'queued', 'starting'].includes(job.state)) void dismissJob()
          onClose()
        }

        const loading = snapshot === null || snapshot === undefined || (checking && updates.length === 0)
        let body
        if (showJob) body = h(ProgressView, { job, refresh, retryFailed, retryBusy })
        else if (loading) body = h(EmptyOrLoading, { state })
        else body = h(ListView, { state, updates, selected, toggle, busy, queueOffer, desktopBlocked, desktopPhase })

        const queueWaiting = showJob && (job.state === 'queued' || job.state === 'starting')
        const footer = h('div', { className: 'dshpu-actions' },
          actionError !== null
            ? h('div', { className: 'dshpu-footerError' }, message(actionError))
            : null,
          showJob && job.state === 'running'
            ? h(UI.Button, { variant: 'outline', onClick: handleClose }, t('panel.background'))
            : null,
          queueWaiting
            ? h(UI.Button, { variant: 'outline', onClick: () => { void cancelQueued() } }, t('queue.cancel'))
            : null,
          showJob && !queueWaiting && job.state !== 'running'
            ? h(UI.Button, { variant: 'primary', onClick: handleClose }, t('panel.done'))
            : null,
          !showJob
            ? h(UI.Button, { variant: 'outline', onClick: handleClose }, t('panel.cancel'))
            : null,
          !showJob && updates.length > 0
            ? h(UI.Button, {
              variant: 'primary',
              disabled: busy || checking || selected.size === 0 || desktopBlocked,
              onClick: () => { void submit(queueOffer) },
            }, queueOffer ? t('queue.button') : t('panel.update', { count: selected.size }))
            : null,
        )

        const title = showJob
          ? queueWaiting ? t('queue.title') : t('panel.progressTitle')
          : t('panel.title')

        return h(UI.Modal, {
          open,
          onClose: handleClose,
          title,
          closeLabel: t('panel.close'),
          footer,
          className: 'dshpu-modal',
          contentClassName: 'dshpu-modalContent',
        },
          h('style', null, STYLE),
          body,
        )
      }

      function ResiduePanel({ open, onClose }) {
        const state = useStoreValue()
        const residue = state.residue
        const items = residue?.items ?? []
        const cleanable = residue?.cleanable ?? 0
        const [busy, setBusy] = useState(false)
        const [cleaned, setCleaned] = useState(null)
        const [error, setError] = useState(null)
        useLocaleTick()

        const groups = [
          ['selection', t('residue.selection')],
          ['patch', t('residue.patch')],
          ['data', t('residue.data')],
        ]

        async function run() {
          if (busy) return
          setBusy(true)
          setError(null)
          try {
            const value = await cleanResidue()
            setCleaned(value.cleaned?.length ?? 0)
          } catch (cause) {
            setError(errorCodeOf(cause))
          } finally {
            setBusy(false)
          }
        }

        const footer = h('div', { className: 'dshpu-actions' },
          error !== null ? h('div', { className: 'dshpu-footerError' }, message(error)) : null,
          h(UI.Button, { variant: 'outline', onClick: () => { void refreshResidue() } }, t('residue.scan')),
          h(UI.Button, { variant: 'outline', onClick: onClose }, t('panel.close')),
          h(UI.Button, {
            variant: 'primary',
            disabled: busy || cleanable === 0,
            onClick: () => { void run() },
          }, t('residue.clean')),
        )

        return h(UI.Modal, {
          open,
          onClose,
          title: t('residue.title'),
          closeLabel: t('panel.close'),
          footer,
          className: 'dshpu-modal',
          contentClassName: 'dshpu-modalContent',
        },
          h('style', null, STYLE),
          h('div', { className: 'dshpu-body' },
            h('div', { className: 'dshpu-summary' },
              h('div', { className: 'dshpu-summaryText' }, t('residue.summary', { count: items.length }))),
            cleaned !== null
              ? h(StatusNote, { tone: 'success', icon: h(UI.IconCheckCircleOutlineRegular, { size: 16 }) },
                t('residue.cleaned', { count: cleaned }))
              : null,
            groups.map(([kind, title]) => {
              const list = items.filter((item) => item.kind === kind)
              if (list.length === 0) return null
              return h('div', { key: kind },
                h('div', { className: 'dshpu-group' }, title),
                h('ul', { className: 'dshpu-list' },
                  list.map((item, index) => h('li', { className: 'dshpu-row', key: kind + ':' + index },
                    h('div', { className: 'dshpu-rowMain' },
                      h('div', { className: 'dshpu-name' }, item.name),
                      kind === 'patch'
                        ? h('div', { className: 'dshpu-desc' },
                          t('residue.line', { line: item.line }) + (typeof item.text === 'string' ? ' · ' + item.text : ''))
                        : null,
                      kind === 'data'
                        ? h('div', { className: 'dshpu-desc' }, item.path)
                        : null,
                    ),
                    h('div', { className: 'dshpu-status' },
                      kind === 'data' ? t('residue.manual') : t('residue.cleanable')),
                  )),
                ),
              )
            }),
            h(StatusNote, { tone: 'info', icon: h(UI.IconInfoOutlineRegular, { size: 16 }) }, t('residue.note')),
          ),
        )
      }

      /**
       * Keep one host span as a child of the sidebar account row, immediately
       * after the account button. The row has no list slot, so the chip is
       * portaled into the row the same way the shipped Desktop update chip
       * lives there. The row is found by the module-stable `triggerRow` class
       * suffix and the account button's stable `data-signed-out` attribute.
       */
      function useAccountRowHost() {
        const [host, setHost] = useState(null)
        useEffect(() => {
          const node = document.createElement('span')
          node.className = 'dshpu-rowHost'
          let button = null
          let rowObserver = null
          let attributeObserver = null
          let findTimer = null

          const syncCollapsed = () => {
            node.style.display = button?.getAttribute('data-collapsed') === 'true' ? 'none' : ''
          }

          const attach = () => {
            const found = document.querySelector('button[data-signed-out]')
            if (found === null) return false
            const row = found.closest('[class*="_triggerRow"]')
            if (row === null) return false
            if (button !== found) {
              attributeObserver?.disconnect()
              button = found
              attributeObserver = new MutationObserver(syncCollapsed)
              attributeObserver.observe(button, { attributes: true, attributeFilter: ['data-collapsed'] })
              syncCollapsed()
            }
            rowObserver?.disconnect()
            rowObserver = new MutationObserver(() => {
              if (!node.isConnected) attach()
            })
            rowObserver.observe(row, { childList: true })
            if (node.parentElement !== row) row.insertBefore(node, row.children[1] ?? null)
            setHost(node)
            return true
          }

          if (!attach()) {
            findTimer = setInterval(() => {
              if (attach()) {
                clearInterval(findTimer)
                findTimer = null
              }
            }, 500)
          }
          const keepAlive = setInterval(() => {
            if (!node.isConnected) attach()
          }, 1500)

          return () => {
            clearInterval(findTimer)
            clearInterval(keepAlive)
            rowObserver?.disconnect()
            attributeObserver?.disconnect()
            node.remove()
            setHost(null)
          }
        }, [])
        return host
      }

      function AccountRowUpdate() {
        useLocaleTick()
        const state = useStoreValue()
        const [open, setOpen] = useState(false)
        const [openResidue, setOpenResidue] = useState(false)
        const host = useAccountRowHost()
        const snapshot = state.snapshot
        const updates = snapshot?.updates ?? []
        const job = snapshot?.job ?? null
        const phase = job?.state
        const running = phase === 'running'
        const waiting = phase === 'queued' || phase === 'starting'
        const count = updates.length
        const updateVisible = open || running || waiting || count > 0
        const residue = state.residue
        const residueCount = residue?.items?.length ?? 0
        const residueVisible = openResidue || residueCount > 0
        const reloadPending = job !== null && job.state === 'done' && job.reloadRequired === true && job.restartRequired !== true
        // A reload already happened for this job in this tab. Without this
        // guard the same completed job would trigger another reload forever.
        const alreadyReloaded = reloadPending && hasReloadMarker(job.id)
        const needsReload = reloadPending && alreadyReloaded !== true
        const [retryBusy, setRetryBusy] = useState(false)

        const retryFailed = async () => {
          if (retryBusy === true || job === null) return
          const names = (job.results ?? [])
            .filter((entry) => entry.ok !== true && entry.skipped !== true)
            .map((entry) => entry.name)
          if (names.length === 0) return
          setRetryBusy(true)
          try {
            const snapshot = await api({ action: 'check', force: true })
            publish({ snapshot })
            await startUpdates(names, true)
          } catch (error) {
            publish({ error: errorCodeOf(error) })
          } finally {
            setRetryBusy(false)
          }
        }

        const [refreshCancelled, setRefreshCancelled] = useState(false)
        const [refreshSeconds, setRefreshSeconds] = useState(3)

        useEffect(() => {
          setRefreshCancelled(false)
          setRefreshSeconds(3)
        }, [job?.id])

        useEffect(() => {
          if (job === null || job.id === undefined) return
          if (reloadPending !== true || alreadyReloaded !== true) return
          // The page that performed the reload reports back once, clearing the
          // pending flag for every other window.
          void acknowledgeReload(job.id)
        }, [job?.id, reloadPending, alreadyReloaded])

        useEffect(() => {
          if (needsReload !== true || refreshCancelled === true || job === null) return
          setRefreshSeconds(3)
          const ticker = setInterval(() => setRefreshSeconds((value) => Math.max(0, value - 1)), 1000)
          const reload = setTimeout(() => {
            writeReloadMarker(job.id)
            acknowledgeReloadSoon(job.id)
            window.location.reload()
          }, 3000)
          return () => {
            clearInterval(ticker)
            clearTimeout(reload)
          }
        }, [needsReload, refreshCancelled, job?.id])

        const cancelRefresh = () => {
          setRefreshCancelled(true)
          if (job !== null && job.id !== undefined) {
            writeReloadMarker(job.id)
            void acknowledgeReload(job.id)
          }
        }

        const refresh = {
          needsReload,
          cancelled: refreshCancelled,
          seconds: refreshSeconds,
          reloaded: reloadPending && alreadyReloaded,
          cancel: cancelRefresh,
        }
        const updateLabel = running
          ? t('action.running', { done: job.done, total: job.total })
          : waiting
            ? t('action.waiting')
            : count > 0
              ? t('action.tooltip', { count })
              : t('action.label')
        const residueLabel = t('residue.tooltip', { count: residueCount })

        const chips = host !== null && (updateVisible || residueVisible)
          ? createPortal(
            h(React.Fragment, null,
              updateVisible
                ? h(UI.Tooltip, { label: updateLabel, side: 'top', align: 'end' },
                  h('button', {
                    type: 'button',
                    className: 'dshpu-chip',
                    'aria-label': updateLabel,
                    onClick: () => {
                      setOpen(true)
                      void refresh()
                    },
                  },
                    h('span', { className: 'dshpu-chipIcon' },
                      running
                        ? h(UI.IconLoadingOutlineRegular, { size: 14, className: 'dshpu-spin' })
                        : waiting
                          ? h(UI.IconClockOutlineRegular, { size: 14 })
                          : h(UI.IconDownloadOutlineRegular, { size: 14 }),
                    ),
                    h('span', { className: 'dshpu-chipText' },
                      running ? job.done + '/' + job.total : String(waiting ? job.total : count)),
                  ),
                )
                : null,
              residueVisible
                ? h(UI.Tooltip, { label: residueLabel, side: 'top', align: 'end' },
                  h('button', {
                    type: 'button',
                    className: 'dshpu-chip is-residue',
                    'aria-label': residueLabel,
                    onClick: () => {
                      setOpenResidue(true)
                      void refreshResidue()
                    },
                  },
                    h('span', { className: 'dshpu-chipIcon' }, h(UI.IconTrashOutlineRegular, { size: 14 })),
                    h('span', { className: 'dshpu-chipText' }, String(residueCount)),
                  ),
                )
                : null,
            ),
            host,
          )
          : null

        return h(React.Fragment, null,
          h('style', null, STYLE),
          chips,
          h(UpdatePanel, { open, onClose: () => setOpen(false), refresh, retryFailed, retryBusy }),
          h(ResiduePanel, { open: openResidue, onClose: () => setOpenResidue(false) }),
        )
      }

      function bootstrap() {
        if (started || disposed) return
        started = true
        void refresh().then(() => {
          const snapshot = store.get().snapshot
          if (snapshot !== null && snapshot !== undefined) maybeCheck(snapshot)
          schedule()
        })
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-plugin-update-center',
      }, AccountRowUpdate))

      ctx.effect(() => {
        bootstrap()
        return () => {
          disposed = true
          if (timer !== null) clearTimeout(timer)
        }
      }, 'dsh-plugin-update-center: client lifecycle')

      ctx.effect(() => {
        const carrier = globalThis.dshDesktop
        const bridge = carrier?.protocolVersion === 1 ? carrier.updates : undefined
        if (bridge === undefined) return () => {}
        let alive = true
        const report = (presentation) => {
          if (!alive) return
          void api({
            action: 'desktop-update',
            phase: presentation?.phase ?? 'unknown',
            version: presentation?.version ?? null,
          }).then((snapshot) => {
            if (alive) publish({ snapshot })
          }).catch(() => {})
        }
        const unsubscribe = typeof bridge.subscribe === 'function' ? bridge.subscribe(report) : null
        if (typeof bridge.status === 'function') bridge.status().then(report, () => {})
        return () => {
          alive = false
          if (typeof unsubscribe === 'function') unsubscribe()
        }
      }, 'dsh-plugin-update-center: desktop update gate')
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
