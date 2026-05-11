# Iframe Preloading Spec — 双槽位预加载系统

**日期**: 2026-05-12
**涉及文件**: `content.js`, `content.css`

---

## 背景

用户向下切换视频时，当前实现需要重新设置 `iframe.src` 并等待 B 站完整视频页面加载、播放器初始化、网页全屏触发，整个过程有明显延迟。

新增预加载功能：在当前视频播放时，后台预先加载下一个视频的 iframe（暂停 + 静音），切换时直接交换槽位，无需重新加载。

---

## 架构决策

### 决策 1：双 iframe 槽位系统

**方案**：在 `createOverlay()` 中同时创建两个 iframe，通过槽位编号管理。

```
Slot 0 (activeSlot=0):   class="bikbok-player bikbok-player-active"
                          z-index: 2, visibility: visible
                          正在播放的视频

Slot 1 (preload slot):   class="bikbok-player bikbok-player-preload"
                          z-index: 1, visibility: hidden
                          下一个视频，已暂停 + 静音
```

**为什么不使用单 iframe + `preconnect/prefetch`？**
- Resource hints 只能预加载 HTML/CSS/JS，无法预加载 B 站播放器的完整初始化流程
- 同一 iframe 切换 `src` 需要完整的销毁 → 重建周期，无法复用已加载的 DOM 和 JS 上下文

**为什么用 `visibility: hidden` 而不是 `display: none`？**
- `display: none` 会导致 iframe 完全不渲染，`contentDocument` 返回 `null`，无法访问内部的 `<video>` 来暂停
- `visibility: hidden` 保持元素在布局中但不可见，iframe 正常加载和渲染

### 决策 2：预加载视频暂停 + 静音

**问题**：B 站完整视频页面默认自动播放，如果不处理，用户会听到预加载视频的音频泄露。

**解决方案**：`handlePreloadLoaded()` 在预加载 iframe 加载完成后立即：
1. 注入隐藏样式（`injectIframeHideStyles`）
2. 查找 `<video>` 元素
3. 设置 `muted = true` 并调用 `pause()`
4. 标记 `preloadReady = true`

若 `<video>` 元素尚未出现（B 站 JS 异步创建），轮询查找，最多等待 5 秒。

### 决策 3：快速切换路径 vs 回退路径

```
nextVideo() 被调用
  ├── preloadReady && preloadIndex === currentIndex + 1 ?
  │     └── YES → swapAndPlayPreloaded()  ← 快速路径（零延迟）
  │               1. 交换 activeSlot
  │               2. 切换 CSS 类名
  │               3. unmute + play 新活跃的 video
  │               4. 触发网页全屏
  │               5. 更新 UI（标题/计数器）
  │               6. preloadVideo(currentIndex + 1)
  │
  └── NO → currentIndex++ → loadVideo(currentIndex)  ← 回退路径（原有逻辑）
```

**回退路径触发场景**：
- 首次进入，预加载尚未完成（2s 延迟内按 ↓）
- 用户按 ↑ 后再按 ↓（预加载的方向不对）
- 预加载失败（网络错误 / 超时）

### 决策 4：预加载方向仅限于向前

prevVideo() 不使用预加载。因为预加载槽位始终指向 `currentIndex + 1`，向后导航的方向相反。

prevVideo() 中的策略：
1. 正常回退：`currentIndex--; loadVideo(currentIndex);`
2. 加载完成后，触发前方预加载：`preloadVideo(currentIndex + 1)`

### 决策 5：Generation Counter 保护预加载操作

与 `iframeLoadGen` 类似，新增 `preloadGen` 保护预加载异步操作：

```
preloadVideo(2)          → preloadGen++ (gen=1)
handlePreloadLoaded()    → 捕获 gen=1 → 轮询 video → pause + mute
用户快速切换视频         → preloadVideo(4) → preloadGen++ (gen=2)
旧预加载轮询下次触发     → gen(1) !== preloadGen(2) → clearInterval, 中止
```

---

## CSS 新增

```css
/* 基础样式 — 替代 JS 中 iframe 的内联 style */
#bikbok-overlay .bikbok-player {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  border: none; outline: none;
  background: #000;
}

/* 当前正在播放的 iframe */
#bikbok-overlay .bikbok-player-active {
  z-index: 2;
  visibility: visible;
}

/* 预加载的 iframe */
#bikbok-overlay .bikbok-player-preload {
  z-index: 1;
  visibility: hidden;
}
```

---

## 新增状态变量

| 变量 | 类型 | 初始值 | 说明 |
|------|------|--------|------|
| `iframes` | `Array<HTMLIFrameElement\|null>` | `[null, null]` | 两个 iframe 槽位 |
| `activeSlot` | `number` | `0` | 当前活跃槽位 (0 或 1) |
| `preloadIndex` | `number` | `-1` | 预加载槽位中的视频索引 (-1 表示无) |
| `preloadGen` | `number` | `0` | 预加载代数计数器 |
| `preloadReady` | `boolean` | `false` | 预加载视频是否已暂停就绪 |

---

## 新增函数

| 函数 | 职责 |
|------|------|
| `getActiveIframe()` | 返回活跃槽位的 iframe |
| `getPreloadIframe()` | 返回预加载槽位的 iframe |
| `preloadVideo(index)` | 设置预加载 iframe 的 `src` 为指定视频 URL |
| `handlePreloadLoaded(iframeEl)` | 预加载 iframe 加载完成 → 暂停 + 静音 video |
| `swapAndPlayPreloaded()` | 交换槽位 → 播放预加载视频 → 触发下一个预加载 |

---

## 修改的函数

| 函数 | 变更 |
|------|------|
| `createOverlay()` | 创建 2 个 iframe（循环），闭包绑定 `slot` 参数到事件处理器，移除内联样式 |
| `onIframeLoad(slot)` | 接受 `slot` 参数；`slot===activeSlot` 时调用 `setupPlayerInIframe`，否则调用 `handlePreloadLoaded` |
| `loadVideo()` | 所有 `iframe` 引用 → `getActiveIframe()`；末尾触发 `preloadVideo(index+1)` |
| `finishLoad()` | `iframe` → `getActiveIframe()` |
| `setupPlayerInIframe()` | `iframe.contentDocument` → `getActiveIframe().contentDocument` |
| `onIframeError(slot)` | 仅活跃槽位的错误才显示提示 |
| `nextVideo()` | `currentIndex++` 之前检查预加载就绪，就绪则走 `swapAndPlayPreloaded()` |
| `prevVideo()` | 加载完成后触发 `preloadVideo(currentIndex+1)` |
| `cleanup()` | 清除两个 iframe 的 `src`；重置所有槽位状态变量 |
| `init()` | 重置槽位状态（`activeSlot=0`, `preloadIndex=-1` 等）；2s 后触发 `preloadVideo(1)` |

---

## 端到端流程

```
用户点击 TikTok Mode
    ↓
init()
    ├── activeSlot=0, preloadIndex=-1, preloadReady=false
    ├── createOverlay() → 创建 2 个 iframe
    ├── loadVideo(0) → 活跃 iframe 开始加载视频[0]
    └── setTimeout(2s) → preloadVideo(1) → 预加载 iframe 开始加载视频[1]
         ↓
    handlePreloadLoaded() → 暂停 + 静音 → preloadReady=true
         ↓
用户按 ↓
    ↓
nextVideo()
    ├── preloadReady && preloadIndex(1) === currentIndex(0)+1 → YES
    └── swapAndPlayPreloaded()
         ├── activeSlot = 1 (交换)
         ├── 切换 CSS 类名
         ├── unmute + play 视频[1]
         ├── 触发网页全屏
         ├── 绑定 video.ended 监听
         ├── updateUI(1)
         └── preloadVideo(2) → 预加载下一个
```
