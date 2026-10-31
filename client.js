/**
 * Client half of the plugin update center.
 *
 * Renders one entry in the sidebar foot (the official `sidebar.footer.action`
 * seat next to Settings / the DSH update indicator), a DSH `Modal` listing the
 * available plugin updates, and a progress bar while the Host applies them.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-updates',
  factory(require) {
    const React = require('react')
    const UI = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const NS = 'dsh-plugin-updates'
    const ROUTE = new URL('api/dsh-plugin-updates', document.baseURI)

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
      'done.restart': '新版本已安装，重启 DSH 后生效。',
      'done.refresh': '更新已安装；如界面仍是旧版本，请刷新页面或重启 DSH。',
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
      'done.restart': 'New versions are installed. Restart DSH to load them.',
      'done.refresh': 'Updates are installed. Refresh the page or restart DSH if the UI still shows the old version.',
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
    }

    const STYLE = [
      '.dshpu-action{width:100%;display:flex;margin:0;min-width:0}',
      '.dshpu-action.is-rail{width:36px}',
      '.dshpu-button{width:calc(100% + 4px);height:42px;margin:0 -2px;padding:0 10px 0 8px;display:inline-flex;align-items:center;gap:8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,#202124);font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden;box-sizing:border-box}',
      '.dshpu-button:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f1f3)}',
      '.dshpu-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:-2px}',
      '.dshpu-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#657080)}',
      '.dshpu-label{min-width:0;flex:1;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshpu-count{flex:none;margin-left:auto;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a94a6);font-variant-numeric:tabular-nums}',
      '.dshpu-rail{width:36px;height:36px;padding:0;margin:0;border-radius:50%;justify-content:center;gap:0}',
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
      '.dshpu-versions{display:flex;align-items:center;gap:4px;flex:none;font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#657080);white-space:nowrap;padding-top:1px}',
      '.dshpu-latest{color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dshpu-status{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a94a6);white-space:nowrap;padding-top:1px}',
      '.dshpu-status[data-tone="success"]{color:var(--dsw-alias-state-success-primary,#1a8a4a)}',
      '.dshpu-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#d93025)}',
      '.dshpu-status[data-tone="busy"]{color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.dshpu-progress{display:flex;flex-direction:column;gap:8px}',
      '.dshpu-progressHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#657080)}',
      '.dshpu-progressName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshpu-percent{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#657080)}',
      '.dshpu-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#eceef2);overflow:hidden;position:relative}',
      '.dshpu-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d6bfe);transition:width .35s ease}',
      '.dshpu-barFill.is-indeterminate{width:38%;animation:dshpu-slide 1.1s ease-in-out infinite}',
      '@keyframes dshpu-slide{0%{transform:translateX(-110%)}100%{transform:translateX(360%)}}',
      '.dshpu-note{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--dsw-alias-border-l1,#eceef2);border-radius:10px;padding:10px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#657080);background:var(--dsw-alias-bg-layer-2,#f7f8fa)}',
      '.dshpu-note svg{flex:none;margin-top:1px}',
      '.dshpu-note[data-tone="error"]{border-color:var(--dsw-alias-state-error-primary,#d93025);color:var(--dsw-alias-state-error-primary,#d93025)}',
      '.dshpu-note[data-tone="success"]{color:var(--dsw-alias-state-success-primary,#1a8a4a)}',
      '.dshpu-noteText{min-width:0;word-break:break-word}',
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
      const store = createStore({ snapshot: null, loading: true, checking: false, error: null })
      let disposed = false
      let timer = null
      let lastCheckAttempt = 0
      let started = false

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-updates: dictionaries')
      const t = ctx.locale.bind(NS)

      function useLocaleTick() {
        const [, force] = useState(0)
        useEffect(() => {
          const stop = ctx.locale.subscribe(() => force((value) => value + 1))
          return () => { if (typeof stop === 'function') stop() }
        }, [])
      }

      function message(code) {
        const known = /^(busy|busy-session|check-first|release-changed|invalid-request|registry-unavailable|request-too-large|operation-failed|service-unavailable)$/
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
            headers: { 'content-type': 'application/json', 'x-dsh-plugin-updates': '1' },
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
          const snapshot = await api({ action: 'state' })
          publish({ snapshot, loading: false, error: null })
          maybeCheck(snapshot)
        } catch (error) {
          publish({ loading: false, error: errorCodeOf(error) })
        }
      }

      function maybeCheck(snapshot) {
        if (disposed || snapshot === null || snapshot === undefined) return
        if (snapshot.job?.state === 'running') return
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

      async function startUpdates(names) {
        const snapshot = await api({ action: 'start', names })
        publish({ snapshot, error: null })
        schedule()
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
        const fast = store.get().snapshot?.job?.state === 'running'
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

      function UpdateRow({ name, description, from, to, disabled, status, tone, showCheckbox, checked, onToggle }) {
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

      function ProgressView({ job }) {
        const percent = percentOf(job)
        const current = job.current
        const label = job.state === 'running'
          ? current === null
            ? t('progress.waiting')
            : t('progress.current', { name: current.name, done: job.done, total: job.total })
          : job.state === 'done'
            ? t('done.summary', { count: job.done })
            : t('done.stopped', { name: current?.name ?? '' })
        const failed = job.results.find((entry) => entry.ok !== true)
        const failureText = failed === undefined
          ? null
          : t('done.stopped', { name: failed.name }) + '：' + message(failed.error ?? 'operation-failed')
        const rollbackText = failed?.rollback == null
          ? ''
          : ' ' + (failed.rollback.ok === true ? t('done.rollbackOk') : t('done.rollbackFailed'))
        return h(React.Fragment, null,
          h('div', { className: 'dshpu-progress' },
            h('div', { className: 'dshpu-progressHead' },
              h('div', { className: 'dshpu-progressName' }, label),
              h('div', { className: 'dshpu-percent' }, Math.round(percent) + '%'),
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
          h('ul', { className: 'dshpu-list' },
            (job.items ?? []).map((item) => {
              const result = job.results.find((entry) => entry.name === item.name)
              const isCurrent = job.state === 'running' && current?.name === item.name
              const status = result !== undefined
                ? result.ok === true
                  ? result.restartRequired === true ? t('status.restart') : t('status.done')
                  : t('status.failed')
                : isCurrent
                  ? phaseLabel(current.phase)
                  : t('status.waiting')
              const tone = result !== undefined
                ? result.ok === true ? 'success' : 'error'
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
              failureText + rollbackText)
            : null,
          job.state === 'done'
            ? h(StatusNote, { tone: 'success', icon: h(UI.IconCheckCircleOutlineRegular, { size: 16 }) },
              t('done.summary', { count: job.done }))
            : null,
          job.state === 'done'
            ? h(StatusNote, { tone: 'info', icon: h(UI.IconInfoOutlineRegular, { size: 16 }) },
              job.restartRequired === true ? t('done.restart') : t('done.refresh'))
            : null,
        )
      }

      function ListView({ state, updates, selected, toggle, busy }) {
        const snapshot = state.snapshot
        const checking = state.checking || snapshot?.checking === true
        const checkedAt = snapshot?.checkedAt
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

      function UpdatePanel({ open, onClose }) {
        const state = useStoreValue()
        const snapshot = state.snapshot
        const job = snapshot?.job ?? null
        const showJob = job !== null && (job.state === 'running' || (job.results?.length ?? 0) > 0)
        const checking = state.checking || snapshot?.checking === true
        const updates = snapshot?.updates ?? []
        const namesKey = updates.map((item) => item.name).join('|')
        const [selected, setSelected] = useState(() => new Set())
        const [busy, setBusy] = useState(false)
        const [actionError, setActionError] = useState(null)

        useLocaleTick()

        useEffect(() => {
          if (showJob) return
          setSelected(new Set(updates.map((item) => item.name)))
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [namesKey, showJob, open])

        function toggle(name, checked) {
          setSelected((current) => {
            const next = new Set(current)
            if (checked) next.add(name)
            else next.delete(name)
            return next
          })
        }

        async function submit() {
          const names = [...selected]
          if (names.length === 0) return
          setBusy(true)
          setActionError(null)
          try {
            await startUpdates(names)
          } catch (error) {
            setActionError(errorCodeOf(error))
          } finally {
            setBusy(false)
          }
        }

        const handleClose = () => {
          if (job !== null && job.state !== 'running') void dismissJob()
          onClose()
        }

        const loading = snapshot === null || snapshot === undefined || (checking && updates.length === 0)
        let body
        if (showJob) body = h(ProgressView, { job })
        else if (loading) body = h(EmptyOrLoading, { state })
        else body = h(ListView, { state, updates, selected, toggle, busy })

        const footer = h('div', { className: 'dshpu-actions' },
          actionError !== null
            ? h('div', { className: 'dshpu-footerError' }, message(actionError))
            : null,
          showJob && job.state === 'running'
            ? h(UI.Button, { variant: 'outline', onClick: handleClose }, t('panel.background'))
            : null,
          showJob && job.state !== 'running'
            ? h(UI.Button, { variant: 'primary', onClick: handleClose }, t('panel.done'))
            : null,
          !showJob
            ? h(UI.Button, { variant: 'outline', onClick: handleClose }, t('panel.cancel'))
            : null,
          !showJob && updates.length > 0
            ? h(UI.Button, {
              variant: 'primary',
              disabled: busy || checking || selected.size === 0,
              onClick: () => { void submit() },
            }, t('panel.update', { count: selected.size }))
            : null,
        )

        return h(UI.Modal, {
          open,
          onClose: handleClose,
          title: showJob ? t('panel.progressTitle') : t('panel.title'),
          closeLabel: t('panel.close'),
          footer,
          className: 'dshpu-modal',
          contentClassName: 'dshpu-modalContent',
        },
          h('style', null, STYLE),
          body,
        )
      }

      function UpdateAction({ wide }) {
        useLocaleTick()
        const state = useStoreValue()
        const [open, setOpen] = useState(false)
        const snapshot = state.snapshot
        const updates = snapshot?.updates ?? []
        const job = snapshot?.job ?? null
        const running = job?.state === 'running'
        const count = updates.length
        const visible = open || running || count > 0
        const label = running
          ? t('action.running', { done: job.done, total: job.total })
          : count > 0
            ? t('action.tooltip', { count })
            : t('action.label')

        if (!visible) return null

        return h(React.Fragment, null,
          h('style', null, STYLE),
          h('div', { className: 'dshpu-action' + (wide ? '' : ' is-rail') },
            h(UI.Tooltip, { label, side: 'right' },
              h('button', {
                type: 'button',
                className: 'dshpu-button' + (wide ? '' : ' dshpu-rail'),
                'aria-label': label,
                onClick: () => {
                  setOpen(true)
                  void refresh()
                },
              },
                h('span', { className: 'dshpu-icon' },
                  running
                    ? h(UI.IconLoadingOutlineRegular, { size: 16, className: 'dshpu-spin' })
                    : h(UI.IconDownloadOutlineRegular, { size: 16 }),
                ),
                wide ? h('span', { className: 'dshpu-label' }, running ? label : t('action.label')) : null,
                !running && count > 0 ? h('span', { className: 'dshpu-count' }, String(count)) : null,
              ),
            ),
          ),
          h(UpdatePanel, { open, onClose: () => setOpen(false) }),
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

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-plugin-updates',
        order: 10,
      }, UpdateAction))

      ctx.effect(() => {
        bootstrap()
        return () => {
          disposed = true
          if (timer !== null) clearTimeout(timer)
        }
      }, 'dsh-plugin-updates: client lifecycle')
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
