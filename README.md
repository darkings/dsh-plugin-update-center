# dsh-plugin-updates

DSH Web 插件：检查 profile 里已安装插件的 npm 新版本，在侧边栏集中更新，并用进度条显示更新进度。

它只更新 **npm registry 来源的 profile 插件**。DSH 自带插件、`github:` / `git:` / `file:` / `link:` / `workspace:` 安装的插件、以及 DSH 本体更新都不在这里处理。

## 界面

- 入口：侧边栏底部**登录名右侧**，与 DSH 自己的更新提示并排（同一个 `triggerRow`，插件更新 chip 在账号按钮之后、DSH 更新 chip 之前）。
- 该位置没有官方 list 插槽，所以用 `shell.overlay` + React portal 把 chip 挂进账号行；chip 的高度、字号、品牌色 tint 与 DSH 的 `DesktopUpdateIndicator` 一致。
- **更新 chip**：下载图标；没有可更新插件时不显示；有更新时显示数量；排队时显示时钟图标；更新中显示旋转图标和 `n/total`。
- **残留 chip**：垃圾桶图标 + 警告色（与更新 chip 的下载图标和品牌色明确区分）；发现卸载残留时出现，点击打开残留窗口。
- 点击更新 chip 打开 DSH 原生风格的弹窗：勾选要更新的插件，点「更新 N 个插件」。
- 有任务在运行时，按钮变成「任务完成后自动更新」；点击进入队列，任务全部结束并静默后自动开始。
- 更新开始后弹窗切换为进度视图：总进度条、当前插件、每个插件的状态（等待 / 核对版本 / 移除旧版 / 安装新版 / 已更新 / 待重启 / 失败）。
- 全部完成后统一提示：需要重启就只提示重启；否则需要刷新页面就自动刷新（3 秒倒计时，可取消）。
- 不需要时可以关闭弹窗、让任务在后台继续；完成后再打开查看结果。

## 检查逻辑

1. 读取 `pluginManager.listBundles()`，只保留 `installed` 且 `availability === "profile"`、可移除、无错误的 bundle。
2. 解析依赖来源，只接受 `name@版本/范围` 形式的 npm registry 安装；其余来源跳过。
3. 查询 `registry.npmjs.org`（失败时回退 `registry.npmmirror.com`）：
   - `dist-tags.latest`
   - 对应版本的 manifest
4. 过滤：稳定版（非预发布）、未 deprecated、带 `dsh.bundle`、sha512 integrity 合法、`engines.dsh` / `engines.node` 兼容当前 DSH。
5. 最新版严格大于已装版本时才显示为可更新。

检查结果在 Host 内存中缓存 30 分钟；页面刷新不会重复请求，弹窗里的「重新检查」会强制刷新。

## 更新逻辑

当前 DSH 的 `pluginManager` 没有 `updateBundle`，所以单个插件按官方插件页同样的方式更新：

```
removeBundle(name)
installBundle(`${name}@${latest}`, { enabled: 原状态, saveExact: true, registry, requestId })
```

- 安装失败：自动装回旧版本，记录失败并停止后续插件。
- 更新前再次核对版本与 integrity，防止检查后发布变化。
- 保留插件原来的启用/停用状态。
- 有任务正在运行或已有更新任务时不会直接更新；可以选择「任务完成后自动更新」进入队列。
- 不自动重启 DSH，也不更新 DSH 本体。DSH 本体有更新（`available`/`downloading`/`installing`/`ready`）时禁止插件更新。

进度条口径：由于官方 API 不暴露 pnpm 的字节级下载进度，进度按「已完成插件数 + 当前阶段权重」推进（核对 5% → 移除 35% → 安装 65% → 完成 100%），而不是按下载百分比。

## 排队与生效

- 有任务（对话 turn 或后台 job）时，点击「更新」会返回 busy-session；弹窗显示「任务完成后自动更新」，点击后进入 Host 侧队列。
- 队列等待所有任务空闲，再静默 10 秒，然后 5 秒倒计时开始；倒计时内来新任务会退回等待。
- 每个插件开始前再查一次任务；运行中来新 conversation，当前插件安装完后暂停，任务结束再恢复。
- 队列在页面刷新/关闭后保留（Host 内存）；Host 重启后不自动续跑。
- 全部完成后聚合：任意 `restart-required` → 只提示重启；否则任意成功插件带 `dsh.client` → 自动刷新页面（3 秒倒计时可取消）；都没有 → 不提示。
- 启动层客户端插件更新按「需要重启」处理，避免只刷新后启动层失败。

## DSH 本体更新

- 客户端订阅 `dshDesktop.updates`（`protocolVersion === 1`），把阶段同步给 Host。
- `available` / `downloading` / `verifying` / `installing` / `ready` 阶段禁止开始插件更新，队列也会停住等待。
- DSH 更新后第一次启动，会按新运行版本重新检查插件兼容性；不兼容的插件不会被自动更新。

## 卸载残留

- 只做检测和提示，不接管官方卸载。
- 检测三类：`dsh.profile.bundles` 里悬空的插件选择；`cordis.patch.yml` 里引用不存在包的 `name:` 行；与悬空包同名的 `$DSH_HOME` 数据目录。
- 残留 chip 使用垃圾桶图标和警告色，与更新 chip 区分；点击打开窗口查看明细。
- 底部「清理」会删除悬空的 bundle 选择和失效的补丁条目（先自动快照、原子写回；补丁只移除引用失效包的整段条目，其余行原样保留）；数据目录只报告，不自动删除。
- 若卸载后 DSH 打不开：先用错误对话框的「禁用第三方插件」，再运行 `repair.cmd` 恢复卸载前快照。

## 防砖与恢复

DSH 对**缺失/损坏的 bundle** 是宽容的：Loader 会跳过并打印 warning，应用仍能启动。真正会让应用打不开的是另外三类问题，本插件针对它们做了防护：

1. **启动层插件互相依赖断裂**（例如 `dsh-thought-buddy` 等待 `dsh-loader` 提供的 `dshLoaderUi`）：web boot 要求 immediate 客户端插件全部激活，一个 pending 就会让窗口打不开。插件会读取已安装 manifest 的 `dsh.client.immediately` 和 `dsh.client.inject`，把「启动关键」和「被其他插件注入」的更新标记出来，**默认不勾选**，并在勾选时给出警告。
2. **安装成功但落盘不完整**：更新后逐一校验 `listBundles` 的 `installed/version/enabled/error`、Host 行的 `fiberPhase`、`node_modules/<pkg>` 的 `package.json`、入口文件和 bundle patch 文件；任何一项不通过就自动回滚旧版本。
3. **硬崩溃/断电导致 profile 文件残留**：每批更新开始前把 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`cordis.patch.yml`、`cordis.yml` 复制到 `$DSH_HOME/plugin-updates/snapshots/<timestamp>/`；快照失败则**拒绝开始更新**。更新前的旧版本 manifest 也会先确认可下载，否则拒绝更新（保证回滚目标存在）。

### DSH 打不开时

1. 先点错误对话框里的 **「禁用第三方插件、备份 profile patch 并重启」**（DSH 自带的安全模式）。
2. 仍不行就运行本仓库的 `repair.cmd`（双击即可）：
   ```powershell
   repair.cmd --list
   repair.cmd                     # 恢复最新快照并重装依赖
   repair.cmd --snapshot <目录名>  # 指定快照
   repair.cmd --no-install        # 只恢复文件
   ```
   它会把当前损坏文件另存到 `$DSH_HOME/plugin-updates/broken-<time>/`，再恢复快照并执行 `dsh plugin --profile desktop install`。
3. 没有任何快照时，可用 `dsh --profile rescue --from-default-profile web` 启动一个干净 profile 排查，或手动编辑 `profiles/desktop/package.json` 移除可疑依赖。

### 建议的使用方式

- 一次只更新一个「启动关键 / 被依赖」插件，更新完立即重启验证；普通插件可以批量。
- 更新后先重启一次确认能打开，再继续下一批。
- 出现 `fatal uncaught exception`（如共享依赖里的 `undici`/`openai`）时，先 `repair.cmd` 回到更新前，再单独排查该插件，不要连续重试。

## 安装

```powershell
# 在 DSH 中安装本目录（profile: desktop）
plugin_manager install_bundle C:\Users\Jie\Projects\dsh-plugins\dsh-plugin-updates
```

本地目录安装会链接当前 checkout；改完代码后刷新页面即可看到客户端改动，Host 半由 HMR 重载。

## 测试

```bash
npm test
```

覆盖：版本比较与 engines 范围、更新计划筛选、remove → install → 回滚顺序、发布变化中止、队列空闲等待/取消、重启优先于刷新、残留扫描与安全清理、HTTP 路由的鉴权头/请求体/错误码、registry 回退与范围检查。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 入口：注册 `POST /api/dsh-plugin-updates` |
| `lib/engine.js` | 检查、计划、串行更新、队列等待、快照前校验、安装后验证、回滚、进度状态 |
| `lib/backup.js` | profile 快照、保留策略、更新历史 |
| `lib/residue.js` | 卸载残留扫描（悬空选择/补丁引用/数据目录）与安全清理 |
| `lib/registry.js` | npm registry 读取与回退 |
| `lib/versions.js` | 无依赖的 semver 比较与范围判断 |
| `lib/http.js` | 同源 POST 路由与有界请求体 |
| `client.js` | 登录名右侧 chip、排队/生效提示、残留窗口、进度条 |
| `repair.mjs` / `repair.cmd` | DSH 打不开时的离线恢复脚本 |
| `locale/*.json` | 插件管理页显示标题与描述 |

## 已知限制

- 账号行没有官方 list 插槽，chip 依赖两个稳定锚点：账号按钮的 `data-signed-out` 与 `SettingsRoot` 的 `*_triggerRow` class 后缀。DSH 大版本改这两处 DOM 时 chip 会暂时不显示，需要同步调整 `useAccountRowHost`。
- 新装插件或更新插件后，Web 页面需要刷新一次才能加载新的 Client 模块；Host 半会由 HMR 重载。
- 更新是「先卸后装」，异常时依赖回滚；请避免在 DSH 正在执行任务时更新。
- 只处理顶层 profile 依赖；Suite 类组合包的子插件需要按组合包本身的更新方式处理。
- 队列只存在 Host 内存：页面刷新/关闭不影响，Host 重启后队列丢失，不会自动续跑。
- DSH 本体更新门控依赖桌面 preload 的 `dshDesktop.updates`；浏览器模式无法感知，只能按运行版本重查。
- 残留清理只删悬空的 bundle 选择；`cordis.patch.yml` 的失效引用与数据目录需要手动处理。
