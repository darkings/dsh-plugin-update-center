# dsh-plugin-updates

DSH Web 插件：检查 profile 里已安装插件的 npm 新版本，在侧边栏集中更新，并用进度条显示更新进度。

它只更新 **npm registry 来源的 profile 插件**。DSH 自带插件、`github:` / `git:` / `file:` / `link:` / `workspace:` 安装的插件、以及 DSH 本体更新都不在这里处理。

## 界面

- 入口：侧边栏底部、Settings / DSH 更新提示所在的脚注区（官方插槽 `sidebar.footer.action`）。
- 没有可更新插件时不显示按钮；有更新时显示「插件更新 + 数量」。
- 点击打开 DSH 原生风格的弹窗：勾选要更新的插件，点「更新 N 个插件」。
- 更新开始后弹窗切换为进度视图：总进度条、当前插件、每个插件的状态（等待 / 核对版本 / 移除旧版 / 安装新版 / 已更新 / 待重启 / 失败）。
- 不需要时可以关闭弹窗、让任务在后台继续；完成后再打开查看结果。
- 更新完成后提示重启 DSH 生效，不会自动重启。

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
- 有会话正在运行或已有更新任务时拒绝开始。
- 不自动重启 DSH，也不更新 DSH 本体。

进度条口径：由于官方 API 不暴露 pnpm 的字节级下载进度，进度按「已完成插件数 + 当前阶段权重」推进（核对 5% → 移除 35% → 安装 65% → 完成 100%），而不是按下载百分比。

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

覆盖：版本比较与 engines 范围、更新计划筛选、remove → install → 回滚顺序、发布变化中止、会话忙碌拒绝、HTTP 路由的鉴权头/请求体/错误码、registry 回退与范围检查。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 入口：注册 `POST /api/dsh-plugin-updates` |
| `lib/engine.js` | 检查、计划、串行更新、回滚、进度状态 |
| `lib/registry.js` | npm registry 读取与回退 |
| `lib/versions.js` | 无依赖的 semver 比较与范围判断 |
| `lib/http.js` | 同源 POST 路由与有界请求体 |
| `client.js` | 侧边栏按钮、弹窗、进度条 |
| `locale/*.json` | 插件管理页显示标题与描述 |

## 已知限制

- 新装插件或更新插件后，Web 页面需要刷新一次才能加载新的 Client 模块；Host 半会由 HMR 重载。
- 更新是「先卸后装」，异常时依赖回滚；请避免在 DSH 正在执行任务时更新。
- 只处理顶层 profile 依赖；Suite 类组合包的子插件需要按组合包本身的更新方式处理。
