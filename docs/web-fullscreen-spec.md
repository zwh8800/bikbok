# Web Fullscreen Spec — bikbok iframe 迁移方案

**日期**: 2026-05-11
**涉及文件**: `content.js`, `content.css`

---

## 背景

bikbok 最初使用 `player.bilibili.com/player.html?bvid={ID}` 作为 iframe 嵌入源。该播放器是 B 站官方提供的外部嵌入端点，但默认只播放 360p 低清视频。

用户要求改为加载 `www.bilibili.com/video/BVxxx/` 完整视频页面（支持高清），并自动触发 B 站播放器的「网页全屏」功能。

---

## 技术调研结论

### 可行性验证（Chrome DevTools 实测）

| 问题 | 结论 |
|------|------|
| `www.bilibili.com/video/BV*/` 能否在 iframe 中加载？ | ✅ 可以。HTTP 响应头无 `X-Frame-Options`，无 CSP `frame-ancestors` |
| content script 能否访问 iframe 内部 DOM？ | ✅ 可以。content script 与 iframe 同源（均为 `www.bilibili.com`） |
| B 站网页全屏按钮选择器是什么？ | `.bpx-player-ctrl-web`（不是 `.bpx-player-ctrl-wide`） |
| 点击后按钮状态如何检测？ | 按钮添加 `bpx-state-entered` class，播放器 `data-screen="web"` |
| video 元素的 `ended` 事件能否跨 frame 监听？ | ✅ 可以。同源环境下 `iframe.contentDocument.querySelector('video')` 可访问 |
| 完整的视频页面加载后，评论区/推荐列表等是否需要隐藏？ | 需要隐藏。但网页全屏触发后 B 站会自动隐藏部分元素（`position:fixed` 播放器覆盖） |

### 废弃的备选方案

**方案 B**：保持 `player.bilibili.com`，只添加 `high_quality=1&as_wide=1` 参数。
- 优点：一行代码改动
- 缺点：用户明确要求使用完整视频页面，且外部播放器画质仍受限

---

## 架构决策

### 决策 1：iframe 内键事件转发

**问题**：同一源的 iframe 会抢走键盘焦点。当用户点击 iframe 内播放器后，父文档的 `document.addEventListener('keydown', handler, true)` 捕获不到事件。

**解决方案**：三层键盘事件防护

```
层级 1: window.addEventListener('keydown', onKeyDown, true)     ← 父窗口级别
层级 2: document.addEventListener('keydown', onKeyDown, true)   ← 父文档级别
层级 3: iframe.contentDocument → postMessage → onBikbokKey()    ← iframe 内部转发
```

iframe 内部监听关键按键 (`Escape`, `ArrowDown/Up/Left/Right`)，通过 `window.postMessage({type: 'bikbok-key', key: ...}, '*')` 转发到父窗口。父窗口的 `onBikbokKey()` 构造伪 KeyboardEvent 调用 `onKeyDown()`。

### 决策 2：Generation Counter 防止竞态

**问题**：`setupPlayerInIframe()` 使用 `setInterval` 轮询播放器按钮。快速切换视频时，旧视频的轮询可能在新视频加载后触发，导致错误地完成加载或绑定过期的事件监听。

**解决方案**：每次 `loadVideo()` 调用时递增 `iframeLoadGen`。所有异步回调（`setTimeout`、`setInterval`、事件监听器）在操作前检查 `gen === iframeLoadGen`，不匹配则立即中止。

```
loadVideo()          → iframeLoadGen++ (例如 gen=5)
onIframeLoad()       → 捕获 gen=5 → setupPlayerInIframe(5)
  setInterval 轮询   → 每次检查 gen===iframeLoadGen
用户快速切下一集     → loadVideo() → iframeLoadGen++ (gen=6)
旧轮询下次触发       → gen(5) !== iframeLoadGen(6) → clearInterval, 中止
```

### 决策 3：多层视频结束检测

**问题**：切换 iframe 源后，旧播放器的 postMessage 格式可能与 `player.bilibili.com` 不同。需要更可靠的检测机制。

**分层策略**：

| 优先级 | 检测方式 | 说明 |
|--------|---------|------|
| 1 (主) | `video.ended` 事件 (contentDocument) | 同源访问，最准确 |
| 2 (辅) | postMessage `video_ended` | B 站视频页面可能发送 |
| 3 (兜底) | `AUTO_ADVANCE_FALLBACK_MS` (5分钟) | 以上均未触发则定时器兜底 |

### 决策 4：CSS 调整

`content.css` 变更：

| 变更 | 原因 |
|------|------|
| 移除 `object-fit: cover` | 旧值针对固定尺寸的纯播放器页面。现在 iframe 加载完整网页，`cover` 会不当裁剪内容 |
| 移除 `@media (min-aspect-ratio: 16/9)` 的 `max-width` 限制 | 旧值维持 16:9 播放器比例。现在网页全屏后页面需要填满视口 |
| 添加 `background: #000` | 防止 iframe 页面导航时白屏闪烁 |

---

## 关键选择器

| 用途 | 选择器 |
|------|--------|
| 网页全屏按钮 | `.bpx-player-ctrl-web` |
| 进入网页全屏后的按钮状态 | `.bpx-player-ctrl-web.bpx-state-entered` |
| 播放器容器（检查 `data-screen`） | `.bpx-player-container` |
| 网页全屏激活标志 | `data-screen="web"` |
| iframe 内 video 元素 | `video` |
| 需隐藏的无关元素 | `.bili-header`, `.recommend-list`, `.video-toolbar`, `#comment`, `.bili-footer`, `.left-container .video-pod`, `.video-page-special` |

---

## 常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `PLAYER_ORIGIN` | `'https://www.bilibili.com'` | postMessage 来源校验 |
| `WEBFULLSCREEN_POLL_INTERVAL` | `200` (ms) | 轮询网页全屏按钮就绪的间隔 |
| `WEBFULLSCREEN_TIMEOUT_MS` | `10000` (ms) | 等待按钮就绪的最大时间，超时降级 |
| `IFRAME_HIDE_SELECTORS` | `[7个选择器]` | iframe 内需隐藏的 B 站页面元素 |

---

## 新增函数

| 函数 | 职责 |
|------|------|
| `setupPlayerInIframe(gen)` | 轮询 + 触发网页全屏 + 隐藏元素 + 绑定 ended |
| `finishLoad()` | 隐藏 loading 动画，显示 iframe |
| `injectIframeHideStyles(doc)` | 向 iframe 内部注入样式隐藏无关元素 |
| `attachVideoEndedListener(doc, gen)` | 查找 `<video>` 元素并绑定 `ended` 事件 |
| `onVideoEndedInIframe()` | 视频结束 → 清除定时器 → nextVideo() |
| `onBikbokKey(e)` | 接收来自 iframe 的 postMessage 键事件转发 |

---

## 修改的函数

| 函数 | 变更 |
|------|------|
| `loadVideo()` | iframe.src 改为 `https://www.bilibili.com/video/{bvid}/`；添加 generation counter；清除 loading/setup 定时器；超时回调用 `finishLoad()` |
| `onIframeLoad()` | 委托给 `setupPlayerInIframe(gen)` |
| `onMessage()` | `PLAYER_ORIGIN` 常量已更新为 `www.bilibili.com`，来源检查自动适配 |
| `cleanup()` | 清除 setup/loading 定时器；递增 gen 中止待处理异步操作；退出网页全屏再移除 overlay |
| `init()` | 重置 `loadingTimeoutId`, `setupTimerId`, `iframeLoadGen` |
