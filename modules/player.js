/**
 * bikbok — 播放器管理模块（三槽位双向预加载）
 *
 * 核心模块，管理 B 站视频播放器的完整生命周期：
 *   - 视频加载：loadVideo() 负责将视频加载到活动槽位
 *   - 三槽位预加载：preloadIntoSlot() + swapForward/Backward() 实现零延迟切换
 *   - 播放器设置：setupPlayerInIframe() 自动触发网页全屏、注入隐藏样式、绑定结束事件
 *   - 倍速控制：adjustSpeed() 支持 0.25-3.0x 范围，0.25x 步长
 *
 * 竞态安全通过 slotGen 数组和 iframeLoadGen 代数计数器保障，所有异步回调均校验代数。
 *
 * @module modules/player
 * @requires window.__bikbok (state.js, ui.js)
 */
(function (api) {
  'use strict';

  // ── 视频加载（总是加载到 activeSlot，含竞态保护）──────────────────────

  /**
   * 加载视频到当前活动槽位（activeSlot）
   *
   * 执行流程：
   *  1. 防重入检查 + 代数递增
   *  2. 清理旧定时器（loadingTimeout、setupTimer）
   *  3. 显示加载动画、隐藏旧 iframe（opacity: 0）
   *  4. 暂停旧视频 → 设置新 iframe.src
   *  5. 更新 UI + 启动加载超时兜底 + 自动前进回退定时器
   *
   * @param {number} index - videos 数组中的目标视频索引
   * @returns {void}
   */
  api.loadVideo = function (index) {
    if (api.isTransitioning) return;
    api.isTransitioning = true;   // 防重入守卫
    api.slotGen[api.activeSlot]++;
    api.iframeLoadGen++;          // 递增全局代数，使旧超时/轮询失效
    var gen = api.slotGen[api.activeSlot];
    var loadGen = api.iframeLoadGen;
    const video = api.videos[index];
    if (!video) { api.isTransitioning = false; return; }
    if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
    if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
    api.loadingEl.classList.remove('bikbok-loading-hidden');
    api.getActiveIframe().style.opacity = '0';  // 隐藏旧 iframe 避免闪烁
    // 暂停旧活动槽位的视频，避免同时播放
    var oldIfr = api.getActiveIframe();
    if (oldIfr && oldIfr.contentDocument) {
      var oldVideo = oldIfr.contentDocument.querySelector('video');
      if (oldVideo) { oldVideo.pause(); oldVideo.muted = true; }
    }
    api.getActiveIframe().src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';
    api.updateUI(index);
    // 15 秒超时兜底：无论是否加载完都显示 iframe
    api.loadingTimeoutId = setTimeout(function () {
      api.loadingTimeoutId = null;
      if (gen === api.slotGen[api.activeSlot] && api.loadingEl && !api.loadingEl.classList.contains('bikbok-loading-hidden')) {
        api.finishLoad();
      }
    }, api.LOADING_TIMEOUT_MS);
    api.isTransitioning = false;
    api.slotIndex[api.activeSlot] = index;
    api.slotReady[api.activeSlot] = false;
  };

  // ── 三槽位预加载（前向 + 后向，early mute 轮询防音频泄露）──────────────────────

  /**
   * 立即静音并暂停 iframe 内的所有音视频元素
   *
   * @param {HTMLIFrameElement} iframeEl - 目标 iframe 元素
   * @returns {void}
   */
  api.immediatelyMuteIframe = function (iframeEl) {
    if (!iframeEl || !iframeEl.contentDocument) return;
    var doc = iframeEl.contentDocument;
    var els = doc.querySelectorAll('video, audio');
    for (var i = 0; i < els.length; i++) { els[i].muted = true; els[i].pause(); if (els[i].tagName === 'VIDEO') els[i].currentTime = 0; }
  };

  /**
   * 向指定槽位预加载视频（前向或后向）
   *
   * 加载后立即启动早期静音轮询（每 50ms，最多 15 秒），
   * 确保预加载视频在后台保持静音暂停，防止音频泄露。
   * 竞态保护：通过 slotGen[slot] 代数计数器校验。
   *
   * @param {number} slot - 目标槽位索引 (0-2)
   * @param {number} videoIndex - videos 数组中的视频位置
   * @returns {void}
   */
  api.preloadIntoSlot = function (slot, videoIndex) {
    // 检查槽位和索引有效性
    if (videoIndex < 0 || videoIndex >= api.videos.length) return;
    if (videoIndex === api.currentIndex) return;
    if (slot < 0 || slot >= 3) return;
    api.slotGen[slot]++;  // 递增代数，使旧轮询失效
    var gen = api.slotGen[slot];
    if (api.earlyMuteTimerIds[slot] !== null) {
      clearInterval(api.earlyMuteTimerIds[slot]);
      api.earlyMuteTimerIds[slot] = null;
    }
    api.slotReady[slot] = false;
    api.slotIndex[slot] = videoIndex;
    var ifr = api.iframes[slot];
    if (!ifr) return;
    var video = api.videos[videoIndex];
    if (!video) return;
    // 提前静音，防止 src 加载瞬间音频泄露
    api.immediatelyMuteIframe(ifr);
    ifr.src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';
    var maxPolls = Math.floor(15000 / 50);
    var pollCount = 0;
    // 每 50ms 轮询静音，防御 SPA 动态加载过程
    api.earlyMuteTimerIds[slot] = setInterval(function () {
      if (gen !== api.slotGen[slot] || api.slotReady[slot]) {
        clearInterval(api.earlyMuteTimerIds[slot]);
        api.earlyMuteTimerIds[slot] = null;
        return;
      }
      pollCount++;
      api.immediatelyMuteIframe(ifr);
      if (pollCount >= maxPolls) {
        clearInterval(api.earlyMuteTimerIds[slot]);
        api.earlyMuteTimerIds[slot] = null;
      }
    }, 50);
  };

  /**
   * 处理预加载槽位的 iframe 加载完成事件
   *
   * 注入隐藏样式，查找 video 元素并执行：静音 → 暂停 → 重置进度 → 绑定 play 阻止器。
   * 如果 video 尚未渲染，启动轮询等待（每 50ms，最多 5 秒）。
   *
   * @param {number} slot - 预加载槽位索引
   * @returns {void}
   */
  api.handlePreloadLoaded = function (slot) {
    var gen = api.slotGen[slot];
    if (api.earlyMuteTimerIds[slot] !== null) {
      clearInterval(api.earlyMuteTimerIds[slot]);
      api.earlyMuteTimerIds[slot] = null;
    }
    var ifr = api.iframes[slot];
    if (ifr && ifr.contentDocument) api.injectIframeHideStyles(ifr.contentDocument);
    // play 阻止器：预加载视频不应自动播放
    function addPlayBlocker(video, iframeEl) {
      iframeEl._blockPlay = true;
      video.addEventListener('play', function () { if (iframeEl._blockPlay) { video.pause(); video.muted = true; } });
    }
    function tryPause() {
      if (gen !== api.slotGen[slot]) return;
      if (!ifr || !ifr.contentDocument) return;
      var video = ifr.contentDocument.querySelector('video');
      if (video) { video.muted = true; video.pause(); video.currentTime = 0; addPlayBlocker(video, ifr); api.slotReady[slot] = true; }
      else {
        var attempts = 0;
        var maxAttempts = Math.floor(5000 / 50);
        var timer = setInterval(function () {
          if (gen !== api.slotGen[slot]) { clearInterval(timer); return; }
          attempts++;
          if (!ifr || !ifr.contentDocument) { clearInterval(timer); return; }
          var v = ifr.contentDocument.querySelector('video');
          if (v) { v.muted = true; v.pause(); v.currentTime = 0; addPlayBlocker(v, ifr); api.slotReady[slot] = true; clearInterval(timer); }
          else if (attempts >= maxAttempts) { api.slotReady[slot] = true; clearInterval(timer); }
        }, 50);
      }
    }
    tryPause();
  };

  // ── iframe 事件路由（active slot → 播放器设置 / 预加载 → 静音暂停）──────────────────────

  /**
   * iframe 加载事件统一路由
   *
   * 根据槽位类型分发：
   *   - activeSlot → setupPlayerInIframe()（网页全屏 + 样式注入 + ended 绑定）
   *   - 预加载槽位 → handlePreloadLoaded()（静音暂停 + play 阻止）
   *
   * @param {number} slot - 触发事件的槽位索引
   * @returns {void}
   */
  api.onIframeLoad = function (slot) {
    if (slot === api.activeSlot) {
      var gen = api.slotGen[api.activeSlot];
      api.setupPlayerInIframe(gen);
    } else {
      api.handlePreloadLoaded(slot);
    }
  };

  /**
   * iframe 加载失败处理
   *
   * activeSlot 失败：隐藏 loading，显示重试按钮（含 retry 回调重新 loadVideo）
   * 预加载槽位失败：标记 slotReady=false，重置 slotIndex
   *
   * @param {number} slot - 出错的槽位索引
   * @returns {void}
   */
  api.onIframeError = function (slot) {
    if (slot === api.activeSlot) {
      if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
      var activeIfr = api.getActiveIframe();
      if (activeIfr) activeIfr.style.opacity = '0';
      api.showMessage('Failed to load video', true, function () { api.loadVideo(api.currentIndex); });
    } else {
      api.slotReady[slot] = false;
      api.slotIndex[slot] = -1;
    }
  };

  // ── 播放器设置（网页全屏轮询 + 样式注入 + ended 绑定 + 键盘转发）──────────────────────

  /**
   * 完成视频加载后的 UI 收尾工作
   *
   * 隐藏加载动画 → 显示 iframe（opacity: 1）→ 聚焦 iframe（键盘事件可直达）→
   * 显示标题（3 秒后渐隐）
   *
   * @returns {void}
   */
  api.finishLoad = function () {
    if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
    var activeIfr = api.getActiveIframe();
    if (activeIfr) { activeIfr.style.opacity = '1'; activeIfr.focus(); }
    api.showTitleBriefly();
  };

  /**
   * 在 iframe 内部注入样式，隐藏 B 站页面无关元素
   *
   * 基于 IFRAME_HIDE_SELECTORS 列表，将导航栏、推荐列表、评论区等
   * 隐藏（使用 !important 覆盖 B 站自身样式），同时将背景设为纯黑。
   *
   * @param {Document} doc - iframe 的 contentDocument
   * @returns {void}
   */
  api.injectIframeHideStyles = function (doc) {
    if (!doc || !doc.body) return;
    doc.body.style.background = '#000';
    doc.documentElement.style.overflow = 'hidden';
    for (var i = 0; i < api.IFRAME_HIDE_SELECTORS.length; i++) {
      var els = doc.querySelectorAll(api.IFRAME_HIDE_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) els[j].style.setProperty('display', 'none', 'important');
    }
  };

  /**
   * 视频播放结束回调
   *
   * 清除自动前进回退定时器（因为已经及时响应），
   * 若非最后一个视频则触发 nextVideo()
   *
   * @returns {void}
   */
  api.onVideoEndedInIframe = function () {
    if (api.currentIndex < api.videos.length - 1) api.navigation.nextVideo();
  };

  /**
   * 为 iframe 内的 video 元素绑定 ended 事件监听
   *
   * 如果 video 已存在则直接绑定；否则轮询等待（每 500ms，最多 5 秒）。
   * 竞态保护：校验 gen === slotGen[slot] 和 slot === activeSlot。
   *
   * @param {Document} doc - iframe 的 contentDocument
   * @param {number} slot - 槽位索引
   * @returns {void}
   */
  api.attachVideoEndedListener = function (doc, slot) {
    if (!doc) return;
    var gen = api.slotGen[slot];
    var video = doc.querySelector('video');
    if (video) {
      video.addEventListener('ended', function videoEndHandler() {
        if (gen === api.slotGen[slot] && slot === api.activeSlot) api.onVideoEndedInIframe();
      }, { once: false });
      return;
    }
    var attempts = 0;
    var maxAttempts = Math.floor(5000 / 500);
    var pollTimer = setInterval(function () {
      if (gen !== api.slotGen[slot] || slot !== api.activeSlot) { clearInterval(pollTimer); return; }
      attempts++;
      var v = doc.querySelector('video');
      if (v) {
        v.addEventListener('ended', function videoEndHandler() {
          if (gen === api.slotGen[slot] && slot === api.activeSlot) api.onVideoEndedInIframe();
        }, { once: false });
        clearInterval(pollTimer);
      } else if (attempts >= maxAttempts) { clearInterval(pollTimer); }
    }, 500);
  };

  /**
   * 设置 iframe 内的播放器环境
   *
   * 三步骤：
   *  1. 绑定键盘事件转发（Escape/ArrowUp/ArrowDown/F/I/O/B → postMessage 到父窗口）
   *  2. 轮询等待网页全屏按钮 .bpx-player-ctrl-web（每 200ms，最多 10 秒），
   *     找到后自动点击触发网页全屏
   *  3. 注入隐藏样式 + 绑定 ended 事件 + finishLoad()
   *
   * 竞态保护：gen 与 slotGen[activeSlot] 比较，不匹配则停止轮询。
   *
   * @param {number} gen - 调用时的槽位代数，用于竞态安全校验
   * @returns {void}
   */
  api.setupPlayerInIframe = function (gen) {
    var activeIfr = api.getActiveIframe();
    if (!activeIfr || !activeIfr.contentDocument) {
      api.injectIframeHideStyles(activeIfr && activeIfr.contentDocument);
      api.finishLoad();
      api.ensurePreloads();
      return;
    }
    var doc = activeIfr.contentDocument;
    // forwardKeys：需从 iframe 内 postMessage 转发到父窗口的按键
    // blockKeys：需阻止默认行为防止 B 站播放器冲突的按键（← → 不在内，保留快进快退）
    // 注意：此列表需与 activateSlot() 中的列表保持同步
    doc.addEventListener('keydown', function (e) {
       var forwardKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B', 'z', 'Z', 'c', 'C', 'ArrowLeft', 'ArrowRight', 'Enter'];
       var blockKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B', 'z', 'Z', 'c', 'C', 'Enter'];
      if (forwardKeys.indexOf(e.key) !== -1) {
        window.postMessage({ type: 'bikbok-key', key: e.key }, '*');
      }
      if (blockKeys.indexOf(e.key) !== -1) {
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
    var pollCount = 0;
    var maxPolls = Math.floor(api.WEBFULLSCREEN_TIMEOUT_MS / api.WEBFULLSCREEN_POLL_INTERVAL);
    // 轮询等待 bpx-player-ctrl-web 按钮出现
    api.setupTimerId = setInterval(function () {
      if (gen !== api.slotGen[api.activeSlot]) { clearInterval(api.setupTimerId); api.setupTimerId = null; return; }
      pollCount++;
      var currentDoc = activeIfr && activeIfr.contentDocument;
      if (!currentDoc) { clearInterval(api.setupTimerId); api.setupTimerId = null; return; }
      var wideBtn = currentDoc.querySelector('.bpx-player-ctrl-web');
      var playerContainer = currentDoc.querySelector('.bpx-player-container');
      // 使用 data-screen="web" 属性判断是否已进入网页全屏
      // 这是比按钮上的 bpx-state-entered 类更可靠的状态标记
      var isWebFullscreen = playerContainer && playerContainer.getAttribute('data-screen') === 'web';
      if (wideBtn) {
        if (isWebFullscreen) {
          // ✓ 验证已进入网页全屏，结束轮询
          clearInterval(api.setupTimerId); api.setupTimerId = null;
          api.injectIframeHideStyles(currentDoc);
          api.attachVideoEndedListener(currentDoc, api.activeSlot);
          api.slotReady[api.activeSlot] = true;
          api.finishLoad();
          api.ensurePreloads();
        } else {
          // ✗ 未进入全屏，点击触发，下一轮（50ms后）验证是否生效
          wideBtn.click();
        }
      } else if (pollCount >= maxPolls) {
        // 超时仍继续：即使没有网页全屏，也要注入样式并完成加载
        clearInterval(api.setupTimerId); api.setupTimerId = null;
        api.injectIframeHideStyles(currentDoc);
        api.attachVideoEndedListener(currentDoc, api.activeSlot);
        api.slotReady[api.activeSlot] = true;
        api.finishLoad();
        api.ensurePreloads();
      }
    }, api.WEBFULLSCREEN_POLL_INTERVAL);
  };

  // ── 确保双向预加载就绪 ────────────────────────────────────────

  /**
   * 确保前向和后向双向预加载均处于就绪状态
   *
   * 根据 currentIndex 计算 fwdIdx（+1）和 bwdIdx（-1），
   * 若对应槽位未加载目标视频则触发 preloadIntoSlot()。
   * 无目标时（已是首/末视频）将对应槽位标记为 -1。
   *
   * @returns {void}
   */
  api.ensurePreloads = function () {
    var ci = api.currentIndex;

    // 向前预加载（下一个视频）
    var fwdIdx = ci + 1;
    if (fwdIdx < api.videos.length) {
      if (api.forwardSlot < 0) api.forwardSlot = api.findFreeSlot();
      if (api.forwardSlot >= 0 && (api.slotIndex[api.forwardSlot] !== fwdIdx || !api.slotReady[api.forwardSlot])) {
        api.preloadIntoSlot(api.forwardSlot, fwdIdx);
      }
    } else {
      api.forwardSlot = -1;
    }

    // 向后预加载（上一个视频）
    var bwdIdx = ci - 1;
    if (bwdIdx >= 0) {
      if (api.backwardSlot < 0) api.backwardSlot = api.findFreeSlot();
      if (api.backwardSlot >= 0 && (api.slotIndex[api.backwardSlot] !== bwdIdx || !api.slotReady[api.backwardSlot])) {
        api.preloadIntoSlot(api.backwardSlot, bwdIdx);
      }
    } else {
      api.backwardSlot = -1;
    }
  };

  // ── 暂停槽位中的视频（本地函数）──────────────────────────────────────

  /**
   * 暂停并阻止指定槽位中的视频播放
   *
   * 暂停视频、静音、设置 _blockPlay 标志，绑定 play 事件监听
   * 以便在预加载视频意外播放时立即暂停。
   *
   * @param {number} slot - 要暂停的槽位索引
   * @returns {void}
   */
  function pauseAndBlockSlot(slot) {
    var ifr = api.iframes[slot];
    if (!ifr || !ifr.contentDocument) return;
    var video = ifr.contentDocument.querySelector('video');
    if (video) { video.pause(); video.muted = true; }
    ifr._blockPlay = true;
    if (video) {
      video.addEventListener('play', function () { if (ifr._blockPlay) { video.pause(); video.muted = true; } });
    }
  }

  // ── 激活槽位为播放状态（本地函数）───────────────────────────────────

  /**
   * 激活指定槽位为当前播放状态
   *
   * 解除 play 阻止 → 显示 iframe → 聚焦 → 重置进度并播放 →
   * 触发网页全屏 → 注入隐藏样式 → 绑定 ended 事件 → 设置键盘转发。
   *
   * @param {number} slot - 要激活的槽位索引
   * @param {number} gen - 当前代数，用于传递到 ended 事件监听和竞态保护
   * @returns {void}
   */
  function activateSlot(slot, gen) {
    var ifr = api.iframes[slot];
    if (!ifr) return;
    ifr._blockPlay = false;
    ifr.focus();
    if (ifr.contentDocument) {
      var doc = ifr.contentDocument;
      var video = doc.querySelector('video');
      if (video) { video.currentTime = 0; video.muted = false; video.play().catch(function () {}); }
      // 先尝试立即触发网页全屏（如果未进入）
      var wideBtn = doc.querySelector('.bpx-player-ctrl-web');
      var playerContainer = doc.querySelector('.bpx-player-container');
      var isWebFullscreen = playerContainer && playerContainer.getAttribute('data-screen') === 'web';
      if (wideBtn && !isWebFullscreen) wideBtn.click();
      api.injectIframeHideStyles(doc);
      api.attachVideoEndedListener(doc, slot);
       // forwardKeys 需与 setupPlayerInIframe 中的列表保持同步
       // blockKeys：阻止默认行为（← → 不在内，保留快进快退）
       doc.addEventListener('keydown', function (e) {
         var forwardKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B', 'z', 'Z', 'c', 'C', 'ArrowLeft', 'ArrowRight', 'Enter'];
         var blockKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B', 'z', 'Z', 'c', 'C', 'Enter'];
        if (forwardKeys.indexOf(e.key) !== -1) {
          window.postMessage({ type: 'bikbok-key', key: e.key }, '*');
        }
        if (blockKeys.indexOf(e.key) !== -1) {
          e.preventDefault(); e.stopPropagation();
        }
      }, true);
      // 修复时序问题：如果预加载 iframe 还没加载完就被激活，
      // wideBtn 可能还不存在，需要轮询等待（竞态安全）
      // 保持 loading 状态直到全屏触发成功或超时
      var pollCount = 0;
      var maxPolls = Math.floor(api.WEBFULLSCREEN_TIMEOUT_MS / api.WEBFULLSCREEN_POLL_INTERVAL);
      var webFullscreenTimer = setInterval(function () {
        // 竞态校验：槽位代数变化或不再是活动槽位则终止
        if (gen !== api.slotGen[slot] || slot !== api.activeSlot) {
          clearInterval(webFullscreenTimer);
          ifr.style.opacity = '1';
          if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
          return;
        }
        pollCount++;
        var currentDoc = ifr && ifr.contentDocument;
        if (!currentDoc) {
          clearInterval(webFullscreenTimer);
          ifr.style.opacity = '1';
          if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
          return;
        }
        var btn = currentDoc.querySelector('.bpx-player-ctrl-web');
        var playerContainer = currentDoc.querySelector('.bpx-player-container');
        // 使用 data-screen="web" 属性判断是否已进入网页全屏
        var isWebFullscreen = playerContainer && playerContainer.getAttribute('data-screen') === 'web';
        if (btn) {
          if (isWebFullscreen) {
            // ✓ 验证已进入网页全屏，显示内容并结束轮询
            clearInterval(webFullscreenTimer);
            ifr.style.opacity = '1';
            if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
          } else {
            // ✗ 未进入全屏，点击触发，下一轮（50ms后）验证是否生效
            btn.click();
          }
        } else if (pollCount >= maxPolls) {
          // 超时终止（即使不进入全屏，视频仍可播放）
          clearInterval(webFullscreenTimer);
          ifr.style.opacity = '1';
          if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
        }
      }, api.WEBFULLSCREEN_POLL_INTERVAL);
    } else {
      // iframe 文档不可用，直接显示
      ifr.style.opacity = '1';
      if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
    }
    api.iframe = ifr;
    api.slotReady[slot] = true;
  }

  // ── 前向/后向槽位交换（零延迟切换 + 自动预加载后续视频）──────────────────────

  /**
   * 前向槽位交换（零延迟切换到下一视频）
   *
   * 槽位旋转逻辑：
   *   oldActive 变为 backwardSlot（保留给回退使用）
   *   oldForward 变为 activeSlot（开始播放）
   *   oldBackward 变为 forwardSlot（或找空闲槽位）
   *
   * 交换后：更新 CSS 类名 → 激活新 activeSlot → 更新 UI → 预加载下一视频
   *
   * @returns {void}
   */
  api.swapForward = function () {
    if (!api.isForwardReady()) return;
    api.iframeLoadGen++;
    api.slotGen[api.activeSlot]++;
    // 清理旧定时器
    if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
    if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
    // 先显示 loading，直到全屏触发成功后由 activateSlot 隐藏
    if (api.loadingEl) api.loadingEl.classList.remove('bikbok-loading-hidden');

    var oldActive = api.activeSlot;
    var oldForward = api.forwardSlot;
    var oldBackward = api.backwardSlot;

    // 暂停旧 activeSlot 的视频
    pauseAndBlockSlot(oldActive);
    api.slotGen[oldForward]++;
    var gen = api.slotGen[oldForward];  // 使用槽位自己的代数，不是全局 iframeLoadGen

    // 槽位角色轮换：active ← forward, backward ← active, forward ← backward（或空闲）
    api.activeSlot = oldForward;
    api.backwardSlot = oldActive;
    api.forwardSlot = oldBackward >= 0 ? oldBackward : api.findFreeSlot();
    if (api.forwardSlot < 0) api.forwardSlot = api.findFreeSlot();

    // 更新 CSS 类名：active 的 z-index 更高 + visible
    for (var i = 0; i < 3; i++) {
      if (api.iframes[i]) {
        api.iframes[i].className = (i === api.activeSlot)
          ? 'bikbok-player bikbok-player-active'
          : 'bikbok-player bikbok-player-preload';
      }
    }

    api.currentIndex++;
    activateSlot(api.activeSlot, gen);
    api.updateUI(api.currentIndex);
    api.showTitleBriefly();
    api.hideHints();

    // 预加载下一个前向视频
    var nextIdx = api.currentIndex + 1;
    if (nextIdx < api.videos.length && api.forwardSlot >= 0) {
      api.preloadIntoSlot(api.forwardSlot, nextIdx);
    } else if (nextIdx >= api.videos.length) {
      api.forwardSlot = -1;
    }
  };

  /**
   * 后向槽位交换（零延迟切换到上一视频）
   *
   * 槽位旋转逻辑（与 swapForward 反向）：
   *   oldActive 变为 forwardSlot
   *   oldBackward 变为 activeSlot
   *   oldForward 变为 backwardSlot（或找空闲槽位）
   *
   * @returns {void}
   */
  api.swapBackward = function () {
    if (!api.isBackwardReady()) return;
    api.iframeLoadGen++;
    api.slotGen[api.activeSlot]++;
    // 清理旧定时器
    if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
    if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
    // 先显示 loading，直到全屏触发成功后由 activateSlot 隐藏
    if (api.loadingEl) api.loadingEl.classList.remove('bikbok-loading-hidden');

    var oldActive = api.activeSlot;
    var oldBackward = api.backwardSlot;
    var oldForward = api.forwardSlot;

    // 暂停旧 activeSlot 的视频
    pauseAndBlockSlot(oldActive);
    api.slotGen[oldBackward]++;
    var gen = api.slotGen[oldBackward];  // 使用槽位自己的代数，不是全局 iframeLoadGen

    // 槽位角色轮换：active ← backward, forward ← active, backward ← forward（或空闲）
    api.activeSlot = oldBackward;
    api.forwardSlot = oldActive;
    api.backwardSlot = oldForward >= 0 ? oldForward : api.findFreeSlot();
    if (api.backwardSlot < 0) api.backwardSlot = api.findFreeSlot();

    // 更新 CSS 类名：active 的 z-index 更高 + visible
    for (var i = 0; i < 3; i++) {
      if (api.iframes[i]) {
        api.iframes[i].className = (i === api.activeSlot)
          ? 'bikbok-player bikbok-player-active'
          : 'bikbok-player bikbok-player-preload';
      }
    }

    api.currentIndex--;
    activateSlot(api.activeSlot, gen);
    api.updateUI(api.currentIndex);
    api.showTitleBriefly();
    api.hideHints();

    // 预加载上一个视频
    var prevIdx = api.currentIndex - 1;
    if (prevIdx >= 0 && api.backwardSlot >= 0) {
      api.preloadIntoSlot(api.backwardSlot, prevIdx);
    } else if (prevIdx < 0) {
      api.backwardSlot = -1;
    }
  };

  // ── 倍速控制（I 减速 / O 加速，0.25-3.0x，0.25x 步长）─────────────────

  /**
   * 获取当前活动 iframe 中视频的播放速率
   *
   * @returns {number} 当前播放速率（playbackRate），默认 1.0
   */
  api.getCurrentSpeed = function () {
    var activeIfr = api.getActiveIframe();
    if (!activeIfr || !activeIfr.contentDocument) return 1.0;
    var video = activeIfr.contentDocument.querySelector('video');
    return video ? video.playbackRate : 1.0;
  };

  /**
   * 设置当前活动 iframe 中视频的播放速率
   *
   * @param {number} rate - 目标播放速率
   * @returns {void}
   */
  api.setPlaybackSpeed = function (rate) {
    var activeIfr = api.getActiveIframe();
    if (activeIfr && activeIfr.contentDocument) {
      var video = activeIfr.contentDocument.querySelector('video');
      if (video) video.playbackRate = rate;
    }
  };

  /**
   * 调整播放速率（I 减速 / O 加速）
   *
   * 在当前速率基础上加减 delta，结果钳位到 [SPEED_MIN, SPEED_MAX]，
   * 并四舍五入到两位小数以避免浮点数精度问题。
   *
   * @param {number} delta - 速率变化量（正值加速，负值减速）
   * @returns {number} 调整后的新速率值
   */
  api.adjustSpeed = function (delta) {
    var current = api.getCurrentSpeed();
    var newRate = current + delta;
    if (newRate < api.SPEED_MIN) newRate = api.SPEED_MIN;
    if (newRate > api.SPEED_MAX) newRate = api.SPEED_MAX;
    newRate = Math.round(newRate * 100) / 100;
    api.setPlaybackSpeed(newRate);
    return newRate;
  };

})(window.__bikbok);
