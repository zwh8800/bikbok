# 🎬 bikbok — TikTok-style Bilibili

将 B 站首页变为类似抖音的全屏短视频播放器。

> Transforms Bilibili homepage into a TikTok-like immersive fullscreen video player.

[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-blue)](https://developer.chrome.com/docs/extensions/mv3/)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-yellow)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-green)]()

---

## ✨ 特性

- **全屏沉浸式播放** — 隐藏 B 站原始页面，用一个纯黑全屏覆盖层嵌入 B 站视频播放器
- **键盘全面操控** — `↑` `↓` 切换视频，`←` `→` 快进快退，`F` 浏览器全屏，`I` `O` 倍速控制
- **三槽位双向预加载** — 前进+后退均零延迟切换，3 个 iframe 槽位协同
- **播放进度指示** — `←` `→` 快进快退时居中显示当前时间 / 总时长，>60min 自动切为 HH:MM:SS
- **自动前进** — 视频播完自动跳到下一个，5 分钟无响应自动回退触发
- **倍速控制** — `I` 减速 / `O` 加速，每步 0.25x，范围 0.25–3.0x，居中显示指示器
- **视频池自动 Refill** — 快看完时自动从 DOM 提取新视频，无新视频则点击「换一换」
- **网页全屏自动触发** — 自动点击 B 站播放器的网页全屏按钮，填满 iframe
- **零依赖、零构建** — 纯 vanilla JS + CSS，无框架，无打包工具，加载即用

## ⌨️ 键盘快捷键

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 上一个 / 下一个视频 |
| `←` / `→` | 快退 / 快进 + 居中显示播放进度 |
| `I` | 降低倍速（每步 0.25x，居中显示指示器） |
| `O` | 提高倍速（每步 0.25x，居中显示指示器） |
| `B` | 全局切换进入 / 退出 TikTok 模式 |
| `F` | 切换浏览器全屏 |
| `Space` | 播放 / 暂停（透传给 B 站播放器） |
| `Escape` | 退出 TikTok 模式（处于浏览器全屏时则先退出全屏） |

## 📦 安装

1. 克隆本仓库或下载 ZIP 并解压
2. 打开 Chrome，进入 `chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择项目根目录
5. 访问 [www.bilibili.com](https://www.bilibili.com)，右下角会出现粉色 **bikbok** 按钮

## 🚀 使用

1. 打开 [B 站首页](https://www.bilibili.com)
2. 点击右下角粉色 **bikbok** 按钮进入 TikTok 模式
3. 使用键盘快捷键浏览视频
4. 按 `Escape` 退出

## 🏗️ 架构

```
modules/
├── state.js      # 共享状态 + 配置常量
├── extract.js    # 视频提取（DOM 解析 BV 编号 + 标题推断）
├── player.js     # 播放器管理（加载/预加载/槽位交换/倍速）
├── ui.js         # UI 组件（覆盖层/标题/进度指示/倍速指示）
└── input.js      # 事件处理（键盘/postMessage/全屏）
content.js        # 入口 — init / cleanup / 导航 / 按钮
content.css       # 全屏覆盖层 + 切换按钮 + 指示器样式
```

- **Chrome MV3** content script，纯 vanilla JS
- 通过 `window.__bikbok` 命名空间共享状态
- IIFE + strict mode，CSS 命名空间隔离
- 三 iframe 槽位 + `visibility: hidden` 双向预加载

## 🛠️ 开发

```bash
# 无构建步骤 — 仅需加载未打包的扩展
# 1. 修改代码
# 2. 在 chrome://extensions 点击「更新」
# 3. 刷新 B 站页面验证
```

项目通过 `opencode.json` 配置了 chrome-devtools MCP，支持 AI 辅助的端到端自动化验证。详见 [docs/test-cases.md](docs/test-cases.md)。

## 📄 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Chrome MV3 Content Script |
| 语言 | Vanilla JavaScript (ES5/ES6) |
| 样式 | CSS3 (命名空间隔离) |
| 构建 | 无 — 零依赖，加载即用 |
| 测试 | chrome-devtools MCP 自动化 |

## 📝 License

MIT
