# bikbok 功能测试用例

**用途**: 供 AI 或人工验证 bikbok 扩展功能。通过 Chrome DevTools MCP 执行自动化验证。
**前提**: 扩展已在 Chrome 中加载并启用。

---

## 测试环境

| 项目 | 值 |
|------|-----|
| 起始 URL | `https://www.bilibili.com` |
| 扩展 ID | `ejhcbeehkfciknhcinkhnnbnchlemefe` |
| 验证工具 | chrome-devtools MCP (evaluate_script, press_key, navigate_page, reload_extension) |

---

## 测试用例

### TC01: 按钮存在于 B 站首页

**步骤**:
1. `navigate_page` → `https://www.bilibili.com`
2. `evaluate_script`:
```javascript
() => {
  const btn = document.getElementById('bikbok-toggle-btn');
  return { exists: !!btn, text: btn?.textContent, display: btn?.style.display };
}
```

**预期**:
```json
{ "exists": true, "text": "TikTok Mode", "display": "" }
```

---

### TC02: 点击按钮进入 TikTok 模式

**步骤**:
1. `take_snapshot` → 找到按钮 uid
2. `click` → 按钮 uid
3. `evaluate_script` (等待 5s):
```javascript
() => {
  return new Promise(resolve => {
    setTimeout(() => {
      const overlay = document.getElementById('bikbok-overlay');
      const iframe = overlay?.querySelector('iframe');
      const btn = document.getElementById('bikbok-toggle-btn');
      resolve({
        overlayExists: !!overlay,
        iframeExists: !!iframe,
        iframeSrc: iframe?.src,
        buttonDisplay: btn?.style.display
      });
    }, 5000);
  });
}
```

**预期**:
```json
{
  "overlayExists": true,
  "iframeExists": true,
  "iframeSrc": "以 https://www.bilibili.com/video/BV 开头，以 / 结尾",
  "buttonDisplay": "none"
}
```

---

### TC03: 网页全屏自动触发

**步骤**:
1. 进入 TikTok 模式后，等待 8s
2. `evaluate_script`:
```javascript
() => {
  const overlay = document.getElementById('bikbok-overlay');
  const iframe = overlay?.querySelector('iframe');
  if (!iframe?.contentDocument) return { error: 'no iframe access' };
  const doc = iframe.contentDocument;
  const webBtn = doc.querySelector('.bpx-player-ctrl-web');
  const container = doc.querySelector('.bpx-player-container');
  const player = doc.querySelector('#bilibili-player');
  return {
    webBtnEntered: webBtn?.classList.contains('bpx-state-entered'),
    dataScreen: container?.getAttribute('data-screen'),
    playerPosition: player ? iframe.contentWindow.getComputedStyle(player).position : null,
    playerWidth: player ? iframe.contentWindow.getComputedStyle(player).width : null,
    playerHeight: player ? iframe.contentWindow.getComputedStyle(player).height : null,
    headerDisplay: doc.querySelector('.bili-header') ? iframe.contentWindow.getComputedStyle(doc.querySelector('.bili-header')).display : null
  };
}
```

**预期**:
```json
{
  "webBtnEntered": true,
  "dataScreen": "web",
  "playerPosition": "fixed",
  "playerWidth": "视口宽度 (如 1200px)",
  "playerHeight": "视口高度 (如 792px)",
  "headerDisplay": "none"
}
```

---

### TC04: ArrowDown 切换到下一个视频

**步骤**:
1. 进入 TikTok 模式，确认视频索引（counter 显示 "N / M"）
2. 记录当前 iframe.src 和 counter.textContent
3. `press_key` → `ArrowDown`
4. 等待 4s 让新视频加载并触发网页全屏
5. `evaluate_script`:
```javascript
() => {
  return new Promise(resolve => {
    setTimeout(() => {
      const overlay = document.getElementById('bikbok-overlay');
      const iframe = overlay?.querySelector('iframe');
      const counter = overlay?.querySelector('.bikbok-counter');
      resolve({
        iframeSrc: iframe?.src,
        counterText: counter?.textContent,
        webBtnEntered: iframe?.contentDocument?.querySelector('.bpx-player-ctrl-web')?.classList.contains('bpx-state-entered'),
        dataScreen: iframe?.contentDocument?.querySelector('.bpx-player-container')?.getAttribute('data-screen')
      });
    }, 4000);
  });
}
```

**预期**:
- `iframeSrc` 已更改（不同的 BV 编号）
- `counterText` 递增（如 "1 / 8" → "2 / 8"）
- `webBtnEntered: true`, `dataScreen: "web"`（新视频也触发了网页全屏）

---

### TC05: ArrowUp 切换到上一个视频

**步骤**:
1. 当前在 index N（N ≥ 2）
2. `press_key` → `ArrowUp`
3. 等待 4s
4. `evaluate_script`（同 TC04）

**预期**:
- `counterText` 递减（如 "2 / 8" → "1 / 8"）
- `iframeSrc` 回到上一个 BV 编号

---

### TC06: Escape 退出 TikTok 模式

**步骤**:
1. 在 TikTok 模式中
2. `press_key` → `Escape`
3. 等待 1s
4. `evaluate_script`:
```javascript
() => {
  const overlay = document.getElementById('bikbok-overlay');
  const btn = document.getElementById('bikbok-toggle-btn');
  const main = document.querySelector('main');
  return {
    overlayRemoved: !overlay,
    buttonDisplay: btn?.style.display,
    buttonText: btn?.textContent,
    pageRestored: main && main.offsetParent !== null && main.style.display !== 'none'
  };
}
```

**预期**:
```json
{
  "overlayRemoved": true,
  "buttonDisplay": "",
  "buttonText": "TikTok Mode",
  "pageRestored": true
}
```

---

### TC07: 退出后重新进入

**步骤**:
1. Escape 退出后（TC06 通过）
2. `take_snapshot` → 找到按钮 uid
3. `click` → 按钮
4. 等待 8s
5. `evaluate_script`（同 TC03）

**预期**: 同 TC03 — 覆盖层创建、iframe 加载、网页全屏触发、按钮隐藏。

---

### TC08: 按钮全程保持在 DOM 中

**步骤**:
1. 页面初始 → 检查按钮存在
2. 进入 TikTok 模式 → 检查按钮 `display: none`（DOM 中仍存在）
3. Escape 退出 → 检查按钮 `display: ""`（恢复可见）
4. 重复 2-3 次

**验证脚本** (任意时刻):
```javascript
() => {
  const btn = document.getElementById('bikbok-toggle-btn');
  return { inDOM: !!btn, display: btn?.style.display };
}
```

**预期**: 每次查询 `inDOM: true`，display 根据模式为 `""` 或 `"none"`。

---

## 完整验证流程（一键执行）

AI 可依次执行以下步骤完成全部验证：

```
Step 1: reload_extension(id="ejhcbeehkfciknhcinkhnnbnchlemefe")

Step 2: navigate_page(url="https://www.bilibili.com", timeout=20000)

Step 3: evaluate_script → TC01 脚本 → 确认 {exists: true, text: "TikTok Mode"}

Step 4: take_snapshot → 获取按钮 uid → click(uid)

Step 5: 等待 8s → evaluate_script → TC03 脚本 → 确认 webBtnEntered=true, dataScreen="web"

Step 6: evaluate_script → 记录 counter 当前值

Step 7: press_key("ArrowDown") → 等待 4s → evaluate_script → TC04 脚本 → 确认 counter 递增

Step 8: press_key("ArrowUp") → 等待 4s → evaluate_script → TC05 脚本 → 确认 counter 递减

Step 9: press_key("Escape") → 等待 1s → evaluate_script → TC06 脚本 → 确认退出

Step 10: take_snapshot → click(按钮) → 等待 8s → evaluate_script → TC03 脚本 → 确认重新进入

Step 11: press_key("Escape") → 最终退出
```
