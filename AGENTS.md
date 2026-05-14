# bikbok — B站 TikTok 模式 Chrome 插件

**Generated:** 2026-05-14
**Commit:** 643a17a
**Branch:** master

## OVERVIEW

Chrome MV3 扩展，将 B 站首页变为类似抖音的全屏视频播放器。纯 vanilla JS，iframe 嵌入 B 站播放器。无构建步骤，无后台脚本，无弹出窗。

## STRUCTURE

```
/
├── manifest.json      # MV3 清单 — content_script 在 www.bilibili.com，6 个 JS 按序加载
├── content.js         # 入口 (212 行) — init/cleanup/nav/按钮
├── content.css        # 深色全屏覆盖层 + 切换按钮样式 (268 行)
├── modules/           # 5 个模块，通过 window.__bikbok 命名空间共享状态
│   ├── state.js       #   共享常量 + 状态 + 槽位辅助 (97 行)
│   ├── extract.js     #   视频提取管道 (103 行)
│   ├── player.js      #   播放器管理 — 加载/预加载/交换/倍速 (433 行，三槽位)
│   ├── ui.js          #   覆盖层创建 + UI 更新 + 进度/倍速指示器 (132 行)
│   └── input.js       #   键盘/消息/全屏事件处理 (92 行)
├── icons/             # 扩展图标 (16/48/128px)
├── docs/              # 设计文档 + 测试用例
└── .sisyphus/         # AI 工作流工具目录 (与扩展运行时无关)
```

### 模块加载顺序（关键——不可变更）

manifest.json 的 `js` 数组按依赖序排列：
```
state.js → extract.js → player.js → ui.js → input.js → content.js
```
每个文件都是 IIFE，通过 `window.__bikbok`（别名 `api` 或 `$`）读写共享状态。

## WHERE TO LOOK

| 需求 | 位置 | 说明 |
|------|------|------|
| 视频提取逻辑 | `modules/extract.js` → `extractVideoCards()` | 从 DOM `a[href*="/video/BV"]` 提取 BV ID |
| 标题推断 | `modules/extract.js` → `inferTitle()` | 5 级回退链: img[alt] → title → textContent → 卡片标题 → 父文本 → BV ID |
| 视频池 Refill | `modules/extract.js` → `ensureVideosAvailable()` | DOM 提取 + 换一换按钮，最多 3 次重试 |
| 页面隐藏 / 恢复 | `content.js` → `hidePage()` / `showPage()` | 保存原始 `display` 值，恢复时正确还原 |
| 全屏覆盖层 | `modules/ui.js` → `createOverlay()` | 三 iframe 槽位 + 标题/计数(已注释)/提示 |
| 视频加载 | `modules/player.js` → `loadVideo()` | iframe.src → UI 更新 → 超时保护 → 自动回退 |
| 三槽位双向预加载 | `modules/player.js` → `preloadIntoSlot()` / `swapForward()` / `swapBackward()` | 前进+后退零延迟切换，visibility:hidden 保留 contentDocument |
| 播放器设置 | `modules/player.js` → `setupPlayerInIframe()` | 轮询触发网页全屏 → 注入隐藏样式 → 绑定 video.ended |
| 键盘导航 | `modules/input.js` → `onKeyDown()` | ↑↓ 切视频 / Escape 退出 / F 全屏 / I O 倍速 / ← → 进度显示 |
| 播放进度指示器 | `modules/ui.js` → `showProgressIndicator()` | ← → 按下后居中显示 MM:SS / 总时长，1.5s 渐消 |
| 视频结束自动前进 | `modules/input.js` → `onMessage()` | 监听播放器 postMessage `video_ended` |
| iframe 键转发 | `modules/player.js` `setupPlayerInIframe` / `activateSlot` | iframe 内捕获 Escape/↑↓/F/I/O 通过 postMessage 转发父窗口 |
| 切换按钮 | `content.js` 末尾 + `content.css` | 固定右下角粉色按钮 |

## CODE MAP

| 函数 | 模块 | 分类 | 作用 |
|------|------|------|------|
| `init()` | content.js | 入口 | 编排：隐藏页面→创建覆盖层→绑定 iframe 事件→加载视频→绑定监听 |
| `cleanup()` | content.js | 退出 | 清除计时器→退出全屏→移除 DOM→恢复页面→解绑监听 |
| `nextVideo()` | content.js | 导航 | 三级处理：refill/预加载交换/正常前进 |
| `prevVideo()` | content.js | 导航 | 后退 + 触发前方预加载 |
| `extractVideoCards()` | modules/extract.js | 提取 | DOM 提取 BV ID + 标题，Set 去重 |
| `ensureVideosAvailable()` | modules/extract.js | 提取 | Refill 编排器 |
| `createOverlay()` | modules/ui.js | UI | 构建 #bikbok-overlay + 三 iframe 槽位 |
| `updateUI()` | modules/ui.js | UI | 标题（计数已注释） |
| `loadVideo(index)` | modules/player.js | 播放 | 核心加载器 |
| `preloadIntoSlot(slot, index)` | modules/player.js | 播放 | 向指定槽位预加载视频 |
| `swapForward()` | modules/player.js | 播放 | 向前交换槽位，零延迟切换 |
| `swapBackward()` | modules/player.js | 播放 | 向后交换槽位，零延迟切换 |
| `setupPlayerInIframe(gen)` | modules/player.js | 播放 | 轮询网页全屏 + 注入样式 + 绑定 ended |
| `adjustSpeed(delta)` | modules/player.js | 倍速 | I/O 键倍速控制 (0.25-3.0x) |
| `onKeyDown(e)` | modules/input.js | 事件 | Escape/F/↑↓/←→/I/O 键处理 |
| `onMessage(e)` | modules/input.js | 事件 | postMessage video_ended 监听 |
| `handlePreloadLoaded()` | modules/player.js | 预加载 | 暂停+静音预加载视频 |
| `showProgressIndicator(ct, dur)` | modules/ui.js | UI | ← → 键居中显示播放进度，>60min 显示 HH:MM:SS |
| `showSpeedIndicator(speed)` | modules/ui.js | UI | I/O 键居中显示当前倍速 |
| `finishLoad()` | modules/player.js | 辅助 | 隐藏 loading → 显示 iframe → 自动聚焦 |

## CONVENTIONS

- **MV3 content script**，`run_at: document_end`，仅主页（`pathname` 为 `/` 或 `/index.html`）
- **无外部依赖** — 纯 vanilla JS，无框架，无 API 调用，无构建步骤
- **`window.__bikbok` 命名空间** — 所有模块通过此全局对象共享状态，按 manifest `js` 数组顺序加载
- **IIFE + strict mode** — 所有代码包裹在 `(function (api) { 'use strict'; ... })(window.__bikbok)` 中
- **CSS 类命名空间** — 所有选择器以 `#bikbok-overlay` 或 `#bikbok-toggle-btn` 为前缀，防止污染 B 站页面
- **`textContent`** — 所有用户可见文本均使用 `textContent` 设置（防止 XSS）
- **原始 display 值恢复** — 隐藏元素时将 `node.style.display` 保存为 `{el, display}`，恢复时还原原始值
- **Generation counter** — `iframeLoadGen` 和 `preloadGen` 用于异步竞态安全，所有回调检查 `gen === iframeLoadGen`
- **按钮始终在 DOM** — `toggleBtn` 创建一次，仅通过 `display` 控制显隐，不 `remove()` 或重建
- **postMessage 来源严格匹配** — `e.origin ===`（非 `startsWith`），精确校验播放器来源

## ANTI-PATTERNS (本项目)

- **禁止 `innerHTML`** 设置用户控制的内容 — 仅用于静态 HTML
- **禁止 `as any` / `@ts-ignore`** — 本项目是 vanilla JS
- **禁止硬编码 CSS 样式于 JS 中** — 结构内联样式除外（`position: fixed; inset: 0`）
- **禁止 API 调用 B 站接口** — 依赖 DOM 提取（避免 WBI 签名复杂度和法律风险）
- **始终用中文回复** — 无论用户使用什么语言，AI 助手都必须用中文回复
- **禁止控制台日志输出**
- **向用户提问时使用 `question` 工具** — 当需要用户做出选择或确认时，使用 `question` 工具而非纯文本提问
- **禁止打破模块加载顺序** — manifest `js` 数组顺序不可变更，新增文件必须插入正确位置
- **禁止模块间循环依赖** — 通过 `state.navigation` 注册表打破 content.js ↔ input.js 循环
- **禁止主动提交代码** — 除非用户明确要求提交，否则不执行 `git commit`

## UNIQUE STYLES

- B 站首页通过 `HOME_PAGE_PATHS = new Set(['/', '/index.html'])` 检测，非首页立即返回
- iframe 播放器 URL: `www.bilibili.com/video/BV{ID}/`（完整视频页面，自动触发网页全屏）
- **三槽位双向预加载**：同时创建 3 个 iframe，预加载槽位使用 `visibility:hidden`（保留 contentDocument 可访问性）
- 预加载视频立即暂停 + 静音，带 `earlyMuteTimerId` 轮询防音频泄露
- 自动前进回退计时器: 接收到 `postMessage` / `video.ended` 事件后立即响应，若未收到则在 5 分钟后回退
- 视频计数显示（"N / M"）为 1-based，当前已注释（保留代码以便调试恢复）
- F 键全屏目标为外层 `#bikbok-overlay`，非内部 iframe；iframe 内部 F 键被拦截并 postMessage 转发
- I/O 键倍速控制：I 减速 0.25 / O 加速 0.25，范围 0.25-3.0x，居中显示倍速指示器
- ← → 键播放进度显示：居中显示 MM:SS / 总时长，>60min 自动切 HH:MM:SS，延迟 100ms 读取以等待 seek 生效，不拦截事件保持快进快退
- 三层键盘事件架构：`window` + `document` capture + iframe `postMessage` 转发，确保焦点不受限

## COMMANDS

```bash
# 无构建步骤 — 仅需加载未打包的扩展
# 1. 打开 chrome://extensions
# 2. 开启开发者模式
# 3. 点击"加载未打包的扩展程序" → 选择本目录
# 4. 访问 www.bilibili.com
```

## MCP 开发/验证工作流程

本项目通过 `opencode.json` 配置了 **chrome-devtools** MCP，用于开发和验证：

| 用途 | 操作 |
|------|------|
| 查看 B 站首页 DOM 结构 | `navigate_page` → `https://www.bilibili.com` → `take_snapshot` |
| 检查网络请求（推荐 API / 播放器 API） | `list_network_requests`，筛选 `xhr`/`fetch` 类型 |
| 执行 JS 检查选择器 / DOM 状态 | `evaluate_script` → `() => document.querySelectorAll('...')` |
| `evaluate_script` → `() => document.querySelectorAll('...')` |
| 重载扩展 | `reload_extension`(id="ejhcbeehkfciknhcinkhnnbnchlemefe") |

### 功能验证流程

代码修改后，遵循以下流程进行端到端验证：

```
1. reload_extension                  # 加载最新代码
2. navigate_page → B 站首页          # 确保在正确页面
3. evaluate_script 检查按钮存在      # document.getElementById('bikbok-toggle-btn')
4. click 按钮进入 TikTok 模式        # 检查: 按钮 display:none, overlay 存在
5. press_key ArrowDown 切换视频      # 检查: iframe.src 变化
6. press_key ArrowRight 检查进度指示器 # 检查: 居中显示 MM:SS / 总时长
6. press_key ArrowRight 检查进度指示器 # 检查: 居中显示 MM:SS / 总时长
7. press_key Escape 退出             # 检查: 按钮 display 恢复, overlay 已移除
8. 重复 2-3 次确保循环进出无异常    # 验证状态清理完整，无残留或丢失
```

**核心检查项**（通过 `evaluate_script` 查询）：

| 阶段 | 按钮 `#bikbok-toggle-btn` | overlay `#bikbok-overlay` |
|------|--------------------------|--------------------------|
| 页面初始 | `display: ""`, `textContent: "bikbok"` | 不存在 |
| TikTok 模式中 | `display: "none"`（隐藏，仍在 DOM 中） | 存在 |
| ESC 退出后 | `display: ""`, 文本不变 | 已从 DOM 移除 |

**关键原则**：按钮在进入/退出全程中应保持在 DOM 内，仅通过 `display` 控制显隐，不应被 `remove()` 或重新创建。

### 注意事项

- macOS 原生目录选择器无法通过 DevTools 自动化，首次加载扩展需手动操作
- 后续更新可直接点击 `chrome://extensions` 页面的「更新」按钮重新加载
- 若 MCP 配置了 `--categoryExtensions`，可在 DevTools 中直接加载扩展

## NOTES

- B 站标题主要存储在 `<img alt="...">` 属性中，而非 `<a>` 标签的 `textContent` 中
- `www.bilibili.com` 的 postMessage 原始来源需精确匹配（`===`，非 `startsWith`）
- 若未找到推荐视频，覆盖层将显示消息但仍可通过 Escape 键关闭
- 模块间通过 `state.navigation = { nextVideo, prevVideo, cleanup }` 注册表解决循环依赖
- `player.js` 中的 `navKeys` 数组决定哪些按键从 iframe 转发到父窗口，新增按键需同步更新两处（`setupPlayerInIframe` 和 `activateSlot`）
- ← → 键不在 `navKeys` 中，确保 B 站播放器可直接处理快进快退，父窗口仅附加显示进度指示器
