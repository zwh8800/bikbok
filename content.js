/**
 * bikbok — B 站 TikTok 模式 Chrome 扩展（Content Script 入口）
 * 
 * 模块架构（按 manifest.json 顺序加载，共享 window.__bikbok 命名空间）：
 *   modules/state.js   — 共享状态与常量
 *   modules/extract.js — 视频提取管道
 *   modules/player.js  — 播放器管理
 *   modules/ui.js      — UI 组件
 *   modules/input.js   — 事件处理
 *   content.js         — 入口
 */
(function () {
  'use strict';

  var $ = window.__bikbok;

  // ── 仅在 B 站首页执行 ──────────────────────────────────────
  if (!$.HOME_PAGE_PATHS.has(window.location.pathname)) return;

  // ── 初始化视频池 ───────────────────────────────────────────
  $.videos = $.extractVideoCards();
  $.videos.forEach(function (v) { $.seenBvids.add(v.bvid); });

  // ── 页面隐藏 / 恢复 ───────────────────────────────────────

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
          $.hiddenElements.push({ el: node, display: node.style.display });
          node.style.display = 'none';
        }
      }
    }
  }

  function showPage() {
    for (var i = 0; i < $.hiddenElements.length; i++) {
      $.hiddenElements[i].el.style.display = $.hiddenElements[i].display;
    }
    $.hiddenElements.length = 0;
  }

  // ── 导航 ──────────────────────────────────────────────────

  function nextVideo() {
    if ($.currentIndex >= $.videos.length - 1) {
      if ($.refillPromise !== null) { $.showEndMessage('Loading more...'); return; }
      if ($.refreshAttempts >= $.MAX_REFRESH_ATTEMPTS) { $.showEndMessage(); return; }
      $.showEndMessage('Loading more...');
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
    if (remaining <= $.REFILL_THRESHOLD && $.refillPromise === null && $.refreshAttempts < $.MAX_REFRESH_ATTEMPTS) {
      $.refillPromise = $.ensureVideosAvailable();
      $.refillPromise.then(function () { $.refillPromise = null; $.updateUI($.currentIndex); $.removeEndMessage(); });
    }
    if ($.preloadReady && $.preloadIndex === $.currentIndex + 1) { $.swapAndPlayPreloaded(); return; }
    $.currentIndex++;
    $.loadVideo($.currentIndex);
    $.hideHints();
  }

  function prevVideo() {
    if ($.currentIndex <= 0) return;
    $.currentIndex--;
    $.loadVideo($.currentIndex);
    if ($.currentIndex + 1 < $.videos.length) $.preloadVideo($.currentIndex + 1);
    $.hideHints();
  }

  // ── 入口 / 退出 ──────────────────────────────────────────

  function cleanup() {
    if ($.setupTimerId !== null) { clearInterval($.setupTimerId); $.setupTimerId = null; }
    if ($.loadingTimeoutId !== null) { clearTimeout($.loadingTimeoutId); $.loadingTimeoutId = null; }
    if ($.earlyMuteTimerId !== null) { clearInterval($.earlyMuteTimerId); $.earlyMuteTimerId = null; }
    $.iframeLoadGen++;
    if ($.autoAdvanceTimer !== null) { clearTimeout($.autoAdvanceTimer); $.autoAdvanceTimer = null; }
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    if ($.overlay && $.overlay.parentNode) {
      for (var i = 0; i < $.iframes.length; i++) {
        if ($.iframes[i]) try { $.iframes[i].src = 'about:blank'; } catch (e) {}
      }
      var activeIfr = $.getActiveIframe();
      if (activeIfr && activeIfr.contentDocument) {
        var wideBtn = activeIfr.contentDocument.querySelector('.bpx-player-ctrl-web');
        if (wideBtn && wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
      }
      $.overlay.parentNode.removeChild($.overlay);
      $.overlay = null;
    }
    showPage();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.removeEventListener('keydown', $.onKeyDown, true);
    window.removeEventListener('keydown', $.onKeyDown, true);
    window.removeEventListener('message', $.onMessage);
    window.removeEventListener('message', $.onBikbokKey);
    if ($.toggleBtn) $.toggleBtn.style.display = '';
    $.activeSlot = 0;
    $.preloadIndex = -1;
    $.preloadGen = 0;
    $.preloadReady = false;
    $.iframes = [null, null];
    $.iframe = null;
  }

  function init() {
    $.seenBvids.clear();
    $.videos.forEach(function (v) { $.seenBvids.add(v.bvid); });
    $.refillPromise = null;
    $.refreshAttempts = 0;
    $.loadingTimeoutId = null;
    $.setupTimerId = null;
    $.iframeLoadGen = 0;
    $.earlyMuteTimerId = null;
    $.activeSlot = 0;
    $.preloadIndex = -1;
    $.preloadGen = 0;
    $.preloadReady = false;
    $.iframes = [null, null];

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

    hidePage();
    $.createOverlay();

    for (var slot = 0; slot < 2; slot++) {
      if ($.iframes[slot]) {
        $.iframes[slot].addEventListener('load', (function (s) {
          return function () { $.onIframeLoad(s); };
        })(slot));
        $.iframes[slot].addEventListener('error', (function (s) {
          return function () { $.onIframeError(s); };
        })(slot));
      }
    }

    $.loadVideo(0);

    if ($.videos.length > 1) {
      setTimeout(function () { $.preloadVideo(1); }, 2000);
    }

    document.addEventListener('keydown', $.onKeyDown, true);
    window.addEventListener('keydown', $.onKeyDown, true);
    window.addEventListener('message', $.onMessage);
    window.addEventListener('message', $.onBikbokKey);

    // 自动进入浏览器全屏
    if ($.overlay.requestFullscreen) $.overlay.requestFullscreen().catch(function () {});
  }

  // ── 导航注册表赋值 ────────────────────────────────────────
  $.navigation.nextVideo = nextVideo;
  $.navigation.prevVideo = prevVideo;
  $.navigation.cleanup = cleanup;

  // ── B 键全局切换 ──────────────────────────────────────────
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'b' && e.key !== 'B') return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    e.preventDefault();
    e.stopPropagation();
    if ($.overlay) { cleanup(); }
    else { $.toggleBtn.style.display = 'none'; init(); }
  }, true);

  // ── 模式切换按钮 ───────────────────────────────────────────
  var toggleBtn = document.createElement('button');
  toggleBtn.id = 'bikbok-toggle-btn';
  toggleBtn.textContent = 'bikbok';
  toggleBtn.addEventListener('click', function () {
    $.toggleBtn.style.display = 'none';
    init();
  });
  document.body.appendChild(toggleBtn);
  $.toggleBtn = toggleBtn;

})();
