/**
 * bikbok — B 站 TikTok 模式 Chrome 扩展（Content Script 入口）
 * 
 * 模块架构（按 manifest.json 顺序加载，共享 window.__bikbok 命名空间）：
 *   modules/state.js   — 共享状态与常量
 *   modules/extract.js — 视频提取管道
 *   modules/player.js  — 播放器管理（三槽位双向预加载）
 *   modules/ui.js      — UI 组件
 *   modules/input.js   — 事件处理
 *   content.js         — 入口
 *
 * 本文件是扩展的入口点，负责：
 *   - 初始化编排：隐藏页面 → 创建覆盖层 → 绑定事件 → 加载视频 → 请求全屏
 *   - 视频导航：nextVideo()（三级处理）/ prevVideo()（预加载交换优先）
 *   - 资源清理：cleanup() 完整清理定时器、DOM、事件监听器、槽位状态
 *   - 全局切换：B 键全局监听 + 右下角粉色按钮
 *   - 页面显隐：hidePage()/showPage() 保存和恢复 B 站页面原始 display 值
 */
(function () {
  'use strict';

  var $ = window.__bikbok;

  if (!$.HOME_PAGE_PATHS.has(window.location.pathname)) return;

  var debugTimerId = null;

  function logIframeStates() {
    var overlay = document.getElementById('bikbok-overlay');
    if (!overlay) return;
    var now = new Date().toISOString().slice(11, 19);
    var lines = [];
    for (var i = 0; i < 3; i++) {
      var ifr = overlay.querySelectorAll('iframe')[i];
      if (!ifr) { lines.push('  slot' + i + ': no iframe'); continue; }
      var bvid = (ifr.src.match(/\/video\/(BV[a-zA-Z0-9]+)/) || [])[1] || 'empty';
      var vinfo = '-';
      try {
        var doc = ifr.contentDocument;
        if (doc) {
          var v = doc.querySelector('video');
          if (v) {
            var ct = v.currentTime.toFixed(1);
            var dur = isNaN(v.duration) ? '?' : v.duration.toFixed(1);
            vinfo = ct + '/' + dur + (v.paused ? ' PAUSED' : '▶') + (v.muted ? ' MUTED' : '');
          } else { vinfo = 'no video el'; }
        } else { vinfo = 'no contentDoc'; }
      } catch (e) { vinfo = 'x-origin'; }
      lines.push('  slot' + i + ' [' + ifr.className.replace('bikbok-player ', '').replace('bikbok-player-', '') + '] ' + bvid + ' ' + vinfo);
    }
    lines.push('  currentIndex=' + $.currentIndex + ' activeSlot=' + $.activeSlot + ' fwd=' + $.forwardSlot + ' bwd=' + $.backwardSlot);
    console.debug('[bikbok ' + now + ']', '\n' + lines.join('\n'));
  }

  $.videos = $.extractVideoCards();
  $.videos.forEach(function (v) { $.seenBvids.add(v.bvid); });

  /**
   * 隐藏 B 站页面元素，为全屏覆盖层腾出空间
   *
   * 通过 display:none 隐藏首页卡片、推荐流、导航栏等元素。
   * 隐藏前保存元素的原始 display 值到 hiddenElements 数组，
   * 以便 showPage() 正确恢复（而非统一设回 block）。
   *
   * @returns {void}
   */
  function hidePage() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    var selectors = [
      '.bili-video-card', '.video-card', '.feed-card', '.recommended-swipe',
      '.bili-grid', '.bili-layout', '#i_cecream', '.bpx-player-video-wrap',
      '.home-container', 'main', '.bili-feed4', '.bili-dyn-item',
      '.bili-album', '.bili-header',
    ];
    for (var si = 0; si < selectors.length; si++) {
      var nodes = document.querySelectorAll(selectors[si]);
      for (var ni = 0; ni < nodes.length; ni++) {
        var node = nodes[ni];
        if (node instanceof HTMLElement && node.style.display !== 'none') {
          $.hiddenElements.push({ el: node, display: node.style.display }); // 保存原始 display 值，showPage() 时恢复（不假设默认值）
          node.style.display = 'none';
        }
      }
    }
  }

  /**
   * 恢复被 hidePage() 隐藏的 B 站页面元素
   *
   * 遍历 hiddenElements 数组，将每个元素的 display 恢复为其隐藏前的原始值，
   * 然后清空数组。同时恢复 html 和 body 的 overflow 样式。
   *
   * @returns {void}
   */
  function showPage() {
    for (var i = 0; i < $.hiddenElements.length; i++) {
      $.hiddenElements[i].el.style.display = $.hiddenElements[i].display;
    }
    $.hiddenElements.length = 0;
  }

  /**
   * 切换到下一个视频（三级处理逻辑）
   *
   * 第一级 — 已到末尾：触发 refill 流程
   *   ① 若 refillPromise 已在执行 → 显示"加载中"并返回
   *   ② 若已达最大重试次数 → 显示"推荐列表结束"
   *   ③ 启动 ensureVideosAvailable()，完成后自动前进
   *
   * 第二级 — 近末尾触发预 refill：剩余视频数 ≤ REFILL_THRESHOLD 时，
   *   后台静默调用 ensureVideosAvailable() 补充视频池（不阻塞当前播放）
   *
   * 第三级 — 正常前进：
   *   若前向预加载就绪 → swapForward()（零延迟槽位交换）
   *   否则 → currentIndex++ + loadVideo()（完整加载流程）
   *
   * @returns {void}
   */
  function nextVideo() {
    // 第一级：已到视频池末尾
    if ($.currentIndex >= $.videos.length - 1) {
      // 已有 refill 在执行，等待即可
      if ($.refillPromise !== null) { $.showEndMessage('Loading more...'); return; }
      // 已达最大刷新次数，显示结束
      if ($.refreshAttempts >= $.MAX_REFRESH_ATTEMPTS) { $.showEndMessage(); return; }
      $.showEndMessage('Loading more...');
      // 启动 refill 流程，完成后自动前进
      $.refillPromise = $.ensureVideosAvailable();
      $.refillPromise.then(function () {
        $.refillPromise = null;
        $.removeEndMessage();
        $.updateUI($.currentIndex);
        if ($.currentIndex < $.videos.length - 1) { $.currentIndex++; $.loadVideo($.currentIndex); }
        else { $.showEndMessage(); }
      });
      return;
    }
    var remaining = $.videos.length - $.currentIndex - 1;
    // 第二级：剩余不足，后台静默 refill
    if (remaining <= $.REFILL_THRESHOLD && $.refillPromise === null && $.refreshAttempts < $.MAX_REFRESH_ATTEMPTS) {
      $.refillPromise = $.ensureVideosAvailable();
      $.refillPromise.then(function () { $.refillPromise = null; $.updateUI($.currentIndex); $.removeEndMessage(); });
    }
    // 第三级-A：前向预加载就绪，零延迟交换
    if ($.isForwardReady()) { $.swapForward(); return; }
    // 第三级-B：预加载未就绪，走完整加载流程
    $.currentIndex++;
    $.loadVideo($.currentIndex);
    $.hideHints();
  }

  /**
   * 切换到上一个视频
   *
   * 若后向预加载就绪 → swapBackward()（零延迟槽位交换）
   * 否则 → currentIndex-- + loadVideo()（完整加载流程）
   * 已在第一个视频时（currentIndex <= 0）不执行任何操作。
   *
   * @returns {void}
   */
  function prevVideo() {
    // 已是第一个视频，不执行操作
    if ($.currentIndex <= 0) return;
    // 后向预加载就绪，零延迟交换
    if ($.isBackwardReady()) { $.swapBackward(); return; }
    $.currentIndex--;
    $.loadVideo($.currentIndex);
    $.hideHints();
  }

  /**
   * 完整清理 TikTok 模式的所有资源和状态
   *
   * 清理顺序（按依赖关系排列）：
   *   1. 停止所有定时器（setupTimerId、loadingTimeoutId、progressIndicatorTimer、earlyMuteTimerIds）
   *   2. 递增 iframeLoadGen 使所有异步回调失效
   *   3. 清除自动前进回退定时器
   *   4. 退出浏览器全屏
   *   5. 将 iframe src 清空为 about:blank（释放视频资源）
   *   6. 退出播放器网页全屏（若活动 iframe 处于网页全屏）
   *   7. 从 DOM 中移除 #bikbok-overlay
   *   8. 恢复 B 站页面元素（showPage）
   *   9. 移除所有事件监听器（keydown、message）
   *   10. 恢复按钮显示
   *   11. 重置槽位系统状态
   *
   * @returns {void}
   */
  function cleanup() {
    // 0. 停止调试日志
    if (debugTimerId !== null) { clearInterval(debugTimerId); debugTimerId = null; }
    // 1. 停止所有计时器
    if ($.setupTimerId !== null) { clearInterval($.setupTimerId); $.setupTimerId = null; }
    if ($.loadingTimeoutId !== null) { clearTimeout($.loadingTimeoutId); $.loadingTimeoutId = null; }
    if ($.progressIndicatorTimer !== null) { clearTimeout($.progressIndicatorTimer); $.progressIndicatorTimer = null; }
    for (var t = 0; t < 3; t++) {
      if ($.earlyMuteTimerIds[t] !== null) { clearInterval($.earlyMuteTimerIds[t]); $.earlyMuteTimerIds[t] = null; }
    }
    // 2. 使异步回调失效
    $.iframeLoadGen++;
    // 3. 退出全屏
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    if ($.overlay && $.overlay.parentNode) {
      // 5. 释放 iframe 资源
      for (var i = 0; i < $.iframes.length; i++) {
        if ($.iframes[i]) try { $.iframes[i].src = 'about:blank'; } catch (e) {}
      }
      // 6. 退出播放器网页全屏
      var activeIfr = $.getActiveIframe();
      if (activeIfr && activeIfr.contentDocument) {
        var wideBtn = activeIfr.contentDocument.querySelector('.bpx-player-ctrl-web');
        if (wideBtn && wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
      }
      // 7. 移除覆盖层
      $.overlay.parentNode.removeChild($.overlay);
      $.overlay = null;
    }
    // 8. 恢复页面
    showPage();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    // 9. 移除事件监听
    document.removeEventListener('keydown', $.onKeyDown, true);
    window.removeEventListener('keydown', $.onKeyDown, true);
    window.removeEventListener('message', $.onMessage);
    window.removeEventListener('message', $.onBikbokKey);
    // 10. 恢复按钮
    if ($.toggleBtn) $.toggleBtn.style.display = '';
    // 11. 重置槽位状态
    $.activeSlot = 0;
    $.forwardSlot = -1;
    $.backwardSlot = -1;
    $.slotIndex = [-1, -1, -1];
    $.slotGen = [0, 0, 0];
    $.slotReady = [false, false, false];
    $.earlyMuteTimerIds = [null, null, null];
    $.iframes = [null, null, null];
    $.iframe = null;
  }

  /**
   * TikTok 模式入口函数（编排器），完整初始化流程：
   *
   * 1. 清空 seenBvids 并重新播种当前视频
   * 2. 初始化 refill / 重试 / 定时器状态
   * 3. 初始化三槽位变量（activeSlot=0, forwardSlot=1, backwardSlot=-1）
   * 4. 若无视频 → 显示空消息提示
   * 5. 隐藏页面 + 创建覆盖层
   * 6. 为 3 个 iframe 绑定 load / error 事件
   * 7. 加载第一个视频到 activeSlot
   * 8. 延迟 2s 预加载第二个视频到 slot 1
   * 9. 绑定键盘 / message 事件监听器（双层 keydown + postMessage）
   * 10. 8s 后自动隐藏键盘提示
   * 11. 自动请求浏览器全屏
   *
   * @returns {void}
   */
  function init() {
    // 步骤 1: 清空 seenBvids，重新播种当前视频
    $.seenBvids.clear();
    $.videos.forEach(function (v) { $.seenBvids.add(v.bvid); });
    // 步骤 2: 初始化 refill / 重试 / 定时器状态
    $.refillPromise = null;
    $.refreshAttempts = 0;
    $.loadingTimeoutId = null;
    $.setupTimerId = null;
    $.progressIndicatorTimer = null;
    $.iframeLoadGen = 0;
    $.earlyMuteTimerIds = [null, null, null];
    // 步骤 3: 初始化三槽位变量（activeSlot=0, forwardSlot=1, backwardSlot=-1）
    $.activeSlot = 0;
    $.forwardSlot = 1;
    $.backwardSlot = -1;
    $.slotIndex = [-1, -1, -1];
    $.slotGen = [0, 0, 0];
    $.slotReady = [false, false, false];
    $.iframes = [null, null, null];

    // 步骤 4: 若无视频 → 显示空消息提示
    if ($.videos.length === 0) {
      $.overlay = document.createElement('div');
      $.overlay.id = 'bikbok-overlay';
      $.overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;';
      var msg = document.createElement('div');
      msg.className = 'bikbok-message';
      msg.textContent = 'No recommended videos found \u{1F615}';
      $.overlay.appendChild(msg);
      document.body.appendChild($.overlay);
      document.addEventListener('keydown', $.onKeyDown, true);
      $.iframe = null;
      return;
    }

    // 步骤 5: 隐藏页面 + 创建覆盖层
    hidePage();
    $.createOverlay();

    // 步骤 6: 为 3 个 iframe 绑定 load / error 事件
    for (var slot = 0; slot < 3; slot++) {
      if ($.iframes[slot]) {
        $.iframes[slot].addEventListener('load', (function (s) {
          return function () { $.onIframeLoad(s); };
        })(slot));
        $.iframes[slot].addEventListener('error', (function (s) {
          return function () { $.onIframeError(s); };
        })(slot));
      }
    }

    // 步骤 7: 加载第一个视频到 activeSlot
    $.slotIndex[0] = 0;
    $.loadVideo(0);

    // 步骤 8: 延迟 2s 预加载第二个视频到 slot 1
    if ($.videos.length > 1) {
      setTimeout(function () { $.preloadIntoSlot(1, 1); }, 2000);
    }

    // 步骤 8.5: 启动调试日志（每 3s 打印三槽位播放状态）
    logIframeStates();
    debugTimerId = setInterval(logIframeStates, 3000);

    // 步骤 9: 绑定键盘 / message 事件监听器（双层 keydown + postMessage）
    document.addEventListener('keydown', $.onKeyDown, true);
    window.addEventListener('keydown', $.onKeyDown, true);
    window.addEventListener('message', $.onMessage);
    window.addEventListener('message', $.onBikbokKey);

    // 步骤 10: 8s 后自动隐藏键盘提示
    setTimeout(function () { $.hideHints(); }, 8000);

    // 步骤 11: 自动请求浏览器全屏
    if ($.overlay.requestFullscreen) $.overlay.requestFullscreen().catch(function () {});
  }

  // 将本地函数注册到 navigation 注册表，供 input.js 通过 api.navigation.xxx() 间接调用
  $.navigation.nextVideo = nextVideo;
  $.navigation.prevVideo = prevVideo;
  $.navigation.cleanup = cleanup;

  // B 键全局切换：进入 / 退出 TikTok 模式
  // 输入框中不触发（INPUT / TEXTAREA / contentEditable）
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'b' && e.key !== 'B') return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    e.preventDefault();
    e.stopPropagation();
    // overlay 存在 → cleanup() 退出；不存在 → init() 进入
    if ($.overlay) { cleanup(); }
    else { $.toggleBtn.style.display = 'none'; init(); }
  }, true);

  // 创建右下角粉色 bikbok 切换按钮
  // 按钮始终在 DOM 中（仅通过 display 控制显隐），符合 AGENTS.md 规范
  var toggleBtn = document.createElement('button');
  toggleBtn.id = 'bikbok-toggle-btn';
  toggleBtn.textContent = 'bikbok';
  toggleBtn.addEventListener('click', function () {
    $.toggleBtn.style.display = 'none';
    init();
  });
  document.body.appendChild(toggleBtn);
  // 存储到 api.toggleBtn 以便 cleanup() 恢复显示
  $.toggleBtn = toggleBtn;

})();
