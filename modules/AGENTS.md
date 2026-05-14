# modules/ — bikbok 模块目录

所有逻辑模块，通过 `window.__bikbok` 命名空间协作。每个文件是一个 IIFE，将函数注册到共享 API 对象上。

## STRUCTURE

```
modules/
├── state.js      # 共享常量 + 可变状态 + DOM 引用 + 槽位辅助
├── extract.js    # 视频提取管道 (extractVideoCards / refill / ensureVideosAvailable)
├── player.js     # 播放器管理 (load / preload / swap / setup / speed / three-slot)
├── ui.js         # 覆盖层创建 + UI 更新 + 进度/倍速指示器 (createOverlay / updateUI / showProgressIndicator / showSpeedIndicator)
└── input.js      # 事件处理 (onKeyDown / onMessage / onBikbokKey / toggleFullscreen)
```

## 加载顺序 (不可变更)

manifest.json `js` 数组中的顺序决定初始化：
```
state.js → extract.js → player.js → ui.js → input.js → content.js
```

每个文件必须在引用 `api.xxx` 之前确保 `xxx` 已在先序文件中定义。依赖关系：

```
content.js ──→ 所有模块
input.js  ──→ state.js (通过 navigation 间接 → content.js)
player.js ──→ state.js, ui.js
ui.js     ──→ state.js
extract.js──→ state.js
```

## WHERE TO LOOK

| 功能 | 文件 | 函数 |
|------|------|------|
| 视频提取 | extract.js | `extractVideoCards()`, `refillVideos()`, `ensureVideosAvailable()` |
| 标题推断 | extract.js | `inferTitle()`, `truncateTitle()` |
| 覆盖层创建 | ui.js | `createOverlay()` |
| UI 更新 | ui.js | `updateUI()`, `showMessage()`, `showEndMessage()`, `hideHints()` |
| 播放进度/倍速指示 | ui.js | `showProgressIndicator()`, `showSpeedIndicator()` |
| 视频加载 | player.js | `loadVideo()` |
| 预加载 | player.js | `preloadIntoSlot()`, `swapForward()`, `swapBackward()`, `handlePreloadLoaded()` |
| 播放器设置 | player.js | `setupPlayerInIframe()`, `injectIframeHideStyles()`, `attachVideoEndedListener()` |
| 倍速控制 | player.js | `getCurrentSpeed()`, `setPlaybackSpeed()`, `adjustSpeed()` |
| 进度指示器 | ui.js | `showProgressIndicator()` |
| 倍速指示器 | ui.js | `showSpeedIndicator()` |
| 键盘事件 | input.js | `onKeyDown()`, `onBikbokKey()` |
| 消息事件 | input.js | `onMessage()` |
| 全屏切换 | input.js | `toggleFullscreen()` |
| 状态管理 | state.js | `getActiveIframe()`, `navigation`, 所有常量和可变状态 |

## CONVENTIONS

- **`api` 参数命名**: 所有 IIFE 的第一参数名为 `api`，指向 `window.__bikbok`
- **属性挂载**: 函数和变量通过 `api.xxx = ...` 注册到共享命名空间
- **状态初始化**: `state.js` 首次赋值 `window.__bikbok`，后续文件通过参数接收
- **无直接文件间引用**: 所有跨文件通信通过 `api.xxx` 完成，不使用 `import`

## ANTI-PATTERNS

- **禁止打破加载顺序**: 新文件必须插入 manifest.json 的正确位置，确保其依赖已就绪
- **禁止引用未定义的 api 属性**: 确保调用的函数/变量在加载顺序中的前面文件已定义
- **`navigation` 注册表**: input.js 不得直接调用 content.js 中的函数，必须通过 `api.navigation.xx()` 间接调用

## NOTES

- `input.js` → `content.js` 的调用通过 `api.navigation` 注册表实现，避免循环 import
- `player.js` → `ui.js` 的调用是直接的（`api.updateUI()` 等），无循环问题
- 新增按键需要同步更新 `player.js` 中两处 `navKeys` 数组（`setupPlayerInIframe` 和 `activateSlot`）
- ← → 键不在 `navKeys` 中，确保 B 站播放器可直接处理快进快退，父窗口仅附加显示进度指示器
