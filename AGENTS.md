# bikbok — B站 TikTok 模式 Chrome 插件

**Generated:** 2026-05-12
**Commit:** 879d83c
**Branch:** master

## OVERVIEW

Chrome MV3 扩展，将 B 站首页变为类似抖音的全屏视频播放器。纯 vanilla JS，iframe 嵌入 B 站播放器。

## STRUCTURE

```
/
├── manifest.json    # MV3 清单 — content_script 在 www.bilibili.com，无后台/popup/options
├── content.js       # 主逻辑 (1054 行) — 视频提取 / 全屏覆盖层 / 键盘导航 / 全屏切换
├── content.css      # 深色全屏覆盖层 + 切换按钮样式 (207 行)
├── opencode.json    # OpenCode 编辑器 + chrome-devtools MCP 配置
├── icons/           # 扩展图标 (16/48/128px)
├── docs/            # 设计文档 + 测试用例
└── .sisyphus/       # AI 工作流工具目录 (与扩展运行时无关)
```

## WHERE TO LOOK

| 需求 | 位置 | 说明 |
|------|------|------|
| 视频提取逻辑 | `content.js` → `extractVideoCards()` | 从 DOM `a[href*="/video/BV"]` 提取 BV ID |
| 标题推断 | `content.js` → `inferTitle()` | 回退链: img[alt] → title 属性 → textContent → 卡片标题 → 父元素文本 → BV ID |
| 页面隐藏 / 恢复 | `content.js` → `hidePage()` / `showPage()` | 保存原始 `display` 值，恢复时正确还原 |
| 全屏覆盖层 | `content.js` → `createOverlay()` | iframe 嵌入 `www.bilibili.com/video/BV{ID}/` |
| 键盘导航 | `content.js` → `onKeyDown()` | ↑↓ = 上一个/下一个，Escape = 退出，300ms 防抖 |
| 浏览器全屏切换 | `content.js` → `toggleFullscreen()` | F 键切换 overlay 外层浏览器全屏 |
| 视频快进/快退 | `content.js` → `onKeyDown()` | ← → 透传给 B 站播放器 (seek) |
| iframe 自动聚焦 | `content.js` → `finishLoad()` | 加载完成后自动聚焦 iframe，Space/←→ 即用 |
| 视频结束自动前进 | `content.js` → `onMessage()` | 监听播放器的 postMessage `video_ended` |
| 切换按钮 | `content.js` 末尾 + `content.css` → `#bikbok-toggle-btn` | 固定右下角粉红色按钮 |

## CODE MAP

| 函数 | 行 | 分类 | 作用 |
|------|-----|------|------|
| `init()` | ~1010 | 入口 | 进入 TikTok 全屏模式，编排隐藏页面→创建覆盖层→加载视频→绑定监听 |
| `cleanup()` | ~955 | 退出 | 清除计时器→退出全屏→移除 DOM→恢复页面→解绑监听 |
| `extractVideoCards()` | ~51 | 提取 | DOM 提取 BV ID + 标题，Set 去重 |
| `ensureVideosAvailable()` | ~145 | 提取 | Refill 编排器：先 DOM 提取→再点击换一换，最多 3 次重试 |
| `createOverlay()` | ~363 | UI | 构建 #bikbok-overlay 及所有子元素 (iframe/标题/计数/提示) |
| `loadVideo(index)` | ~416 | 播放 | 核心加载器：设置 iframe.src→UI 更新→超时保护→自动前进回退 |
| `setupPlayerInIframe(gen)` | ~571 | 播放 | 轮询触发网页全屏→注入隐藏样式→绑定 video.ended，带 gen 防过期 |
| `onKeyDown(e)` | ~832 | 事件 | 键盘导航：Escape 退出 / F 全屏 / ↑↓ 切视频 / Space ← → 透传 |
| `onMessage(e)` | ~902 | 事件 | postMessage 监听：视频结束自动前进 |
| `toggleFullscreen()` | ~671 | 全屏 | F 键切换 overlay 浏览器全屏 |
| `finishLoad()` | ~484 | 辅助 | 隐藏 loading → 显示 iframe → 自动聚焦 |

## CONVENTIONS

- **MV3 content script**，`run_at: document_end`，仅主页（`pathname` 为 `/` 或 `/index.html`）
- **无外部依赖** — 纯 vanilla JS，无框架，无 API 调用
- **CSS 类命名空间** — 所有选择器以 `#bikbok-overlay` 或 `#bikbok-toggle-btn` 为前缀，防止污染 B 站页面
- **IIFE + strict mode** — 所有代码包裹在 `(function () { 'use strict'; ... })();` 中
- **textContent** — 所有用户可见文本均使用 `textContent` 设置（防止 XSS）
- **原始 display 值恢复** — 隐藏元素时将 `node.style.display` 保存为 `{el, display}`，恢复时还原原始值
- **Generation counter** — `iframeLoadGen` 用于异步竞态安全，所有回调检查 `gen === iframeLoadGen`
- **按钮始终在 DOM** — `toggleBtn` 创建一次，仅通过 `display` 控制显隐，不 `remove()` 或重建
- **postMessage 来源严格匹配** — `e.origin ===`（非 `startsWith`），精确校验播放器来源
- **所有函数均有 JSDoc** — `@param` / `@returns` 文档注释覆盖全部函数

## ANTI-PATTERNS (本项目)

- **禁止 `innerHTML`** 设置用户控制的内容 — 仅用于静态 HTML
- **禁止 `as any` / `@ts-ignore`** — 本项目是 vanilla JS
- **禁止硬编码 CSS 样式于 JS 中** — 结构内联样式除外（`position: fixed; inset: 0`）
- **禁止 `var`** — 但 `hidePage` / `showPage` 中保存/恢复 display 值模式必须使用 `var` 以保证兼容性
- **禁止 API 调用 B 站接口** — 依赖 DOM 提取（避免 WBI 签名复杂度和法律风险）
- **始终用中文回复** — 无论用户使用什么语言，AI 助手都必须用中文回复
- **禁止控制台日志输出**

## UNIQUE STYLES

- B 站首页通过 `HOME_PAGE_PATHS = new Set(['/', '/index.html'])` 检测
- iframe 播放器 URL: `www.bilibili.com/video/BV{ID}/`（完整视频页面，自动触发网页全屏）
- 原始 B 站内容通过隐藏多个常见选择器（`.bili-video-card`、`.feed-card`、`main` 等）来隐藏，并使用 `z-index: 999999` 覆盖层覆盖其余内容
- 自动前进回退计时器: 接收到 `postMessage` 事件后立即响应，若未收到则在 5 分钟后回退
- 视频计数显示（"N / M"）为 1-based，多于 1 个视频时可见
- F 键全屏目标为外层 `#bikbok-overlay`，非内部 iframe；iframe 内部 F 键被拦截并 postMessage 转发

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
| 检查 B 站视频页播放器 HTML | `navigate_page` → `https://www.bilibili.com/video/BV{ID}` → `take_snapshot` |
| 验证 iframe 嵌入播放器是否可用 | `navigate_page` → `https://player.bilibili.com/player.html?bvid={ID}&autoplay=1` |
| 执行 JS 检查选择器 / DOM 状态 | `evaluate_script` → `() => document.querySelectorAll('...')` |
| 加载扩展到 Chrome | 点击「加载未打包的扩展程序」→ `press_key`(Meta+Shift+G) 导航到项目目录 |

### 开发流程

```
1. 用 chrome-devtools 打开 B 站首页，检查 DOM 结构 / 网络请求是否变化
2. 修改 content.js / content.css / manifest.json
3. 点击「更新」重新加载扩展（或通过 evaluate_script 调用 chrome.developerPrivate.reload）
4. 刷新 B 站页面，手动验证功能
```

### 功能验证流程

代码修改后，遵循以下流程进行端到端验证：

```
1. reload_extension                  # 加载最新代码
2. navigate_page → B 站首页          # 确保在正确页面
3. evaluate_script 检查按钮存在      # document.getElementById('bikbok-toggle-btn')
4. click 按钮进入 TikTok 模式        # 检查: 按钮 display:none, overlay 存在
5. press_key Escape 退出             # 检查: 按钮 display 恢复, overlay 已移除
6. 重复 2-3 次确保循环进出无异常    # 验证状态清理完整，无残留或丢失
```

**核心检查项**（通过 `evaluate_script` 查询）：

| 阶段 | 按钮 `#bikbok-toggle-btn` | overlay `#bikbok-overlay` |
|------|--------------------------|--------------------------|
| 页面初始 | `display: ""`, `textContent: "TikTok Mode"` | 不存在 |
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
