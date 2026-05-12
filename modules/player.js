/**
 * bikbok — 播放器管理模块（三槽位双向预加载）
 */
(function (api) {
  'use strict';

  // ── 视频加载（总是加载到 activeSlot） ──────────────────────

  api.loadVideo = function (index) {
    if (api.isTransitioning) return;
    api.isTransitioning = true;
    api.slotGen[api.activeSlot]++;
    api.iframeLoadGen++;
    var gen = api.slotGen[api.activeSlot];
    var loadGen = api.iframeLoadGen;
    const video = api.videos[index];
    if (!video) { api.isTransitioning = false; return; }
    if (api.autoAdvanceTimer !== null) { clearTimeout(api.autoAdvanceTimer); api.autoAdvanceTimer = null; }
    if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
    if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
    api.loadingEl.classList.remove('bikbok-loading-hidden');
    api.getActiveIframe().style.opacity = '0';
    var oldIfr = api.getActiveIframe();
    if (oldIfr && oldIfr.contentDocument) {
      var oldVideo = oldIfr.contentDocument.querySelector('video');
      if (oldVideo) { oldVideo.pause(); oldVideo.muted = true; }
    }
    api.getActiveIframe().src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';
    api.updateUI(index);
    api.loadingTimeoutId = setTimeout(function () {
      api.loadingTimeoutId = null;
      if (gen === api.slotGen[api.activeSlot] && api.loadingEl && !api.loadingEl.classList.contains('bikbok-loading-hidden')) {
        api.finishLoad();
      }
    }, api.LOADING_TIMEOUT_MS);
    api.autoAdvanceTimer = setTimeout(function () {
      if (api.currentIndex < api.videos.length - 1) {
        api.currentIndex++;
        api.loadVideo(api.currentIndex);
      }
    }, api.AUTO_ADVANCE_FALLBACK_MS);
    api.isTransitioning = false;
    api.slotIndex[api.activeSlot] = index;
    api.slotReady[api.activeSlot] = false;
  };

  // ── 三槽位预加载 ──────────────────────────────────────────

  api.immediatelyMuteIframe = function (iframeEl) {
    if (!iframeEl || !iframeEl.contentDocument) return;
    var doc = iframeEl.contentDocument;
    var els = doc.querySelectorAll('video, audio');
    for (var i = 0; i < els.length; i++) { els[i].muted = true; els[i].pause(); if (els[i].tagName === 'VIDEO') els[i].currentTime = 0; }
  };

  api.preloadIntoSlot = function (slot, videoIndex) {
    if (videoIndex < 0 || videoIndex >= api.videos.length) return;
    if (videoIndex === api.currentIndex) return;
    if (slot < 0 || slot >= 3) return;
    api.slotGen[slot]++;
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
    api.immediatelyMuteIframe(ifr);
    ifr.src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';
    var maxPolls = Math.floor(15000 / 50);
    var pollCount = 0;
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

  api.handlePreloadLoaded = function (slot) {
    var gen = api.slotGen[slot];
    if (api.earlyMuteTimerIds[slot] !== null) {
      clearInterval(api.earlyMuteTimerIds[slot]);
      api.earlyMuteTimerIds[slot] = null;
    }
    var ifr = api.iframes[slot];
    if (ifr && ifr.contentDocument) api.injectIframeHideStyles(ifr.contentDocument);
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

  // ── iframe 事件路由 ───────────────────────────────────────

  api.onIframeLoad = function (slot) {
    if (slot === api.activeSlot) {
      var gen = api.slotGen[api.activeSlot];
      api.setupPlayerInIframe(gen);
    } else {
      api.handlePreloadLoaded(slot);
    }
  };

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

  // ── 播放器设置 ────────────────────────────────────────────

  api.finishLoad = function () {
    if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
    var activeIfr = api.getActiveIframe();
    if (activeIfr) { activeIfr.style.opacity = '1'; activeIfr.focus(); }
    api.showTitleBriefly();
  };

  api.injectIframeHideStyles = function (doc) {
    if (!doc || !doc.body) return;
    doc.body.style.background = '#000';
    doc.documentElement.style.overflow = 'hidden';
    for (var i = 0; i < api.IFRAME_HIDE_SELECTORS.length; i++) {
      var els = doc.querySelectorAll(api.IFRAME_HIDE_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) els[j].style.setProperty('display', 'none', 'important');
    }
  };

  api.onVideoEndedInIframe = function () {
    if (api.autoAdvanceTimer !== null) { clearTimeout(api.autoAdvanceTimer); api.autoAdvanceTimer = null; }
    if (api.currentIndex < api.videos.length - 1) api.navigation.nextVideo();
  };

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

  api.setupPlayerInIframe = function (gen) {
    var activeIfr = api.getActiveIframe();
    if (!activeIfr || !activeIfr.contentDocument) {
      api.injectIframeHideStyles(activeIfr && activeIfr.contentDocument);
      api.finishLoad();
      api.ensurePreloads();
      return;
    }
    var doc = activeIfr.contentDocument;
    doc.addEventListener('keydown', function (e) {
      var navKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B'];
      if (navKeys.indexOf(e.key) !== -1) {
        window.postMessage({ type: 'bikbok-key', key: e.key }, '*');
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
    var pollCount = 0;
    var maxPolls = Math.floor(api.WEBFULLSCREEN_TIMEOUT_MS / api.WEBFULLSCREEN_POLL_INTERVAL);
    api.setupTimerId = setInterval(function () {
      if (gen !== api.slotGen[api.activeSlot]) { clearInterval(api.setupTimerId); api.setupTimerId = null; return; }
      pollCount++;
      var currentDoc = activeIfr && activeIfr.contentDocument;
      if (!currentDoc) { clearInterval(api.setupTimerId); api.setupTimerId = null; return; }
      var wideBtn = currentDoc.querySelector('.bpx-player-ctrl-web');
      if (wideBtn) {
        clearInterval(api.setupTimerId); api.setupTimerId = null;
        if (!wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
        api.injectIframeHideStyles(currentDoc);
        api.attachVideoEndedListener(currentDoc, api.activeSlot);
        api.slotReady[api.activeSlot] = true;
        api.finishLoad();
        api.ensurePreloads();
      } else if (pollCount >= maxPolls) {
        clearInterval(api.setupTimerId); api.setupTimerId = null;
        api.injectIframeHideStyles(currentDoc);
        api.attachVideoEndedListener(currentDoc, api.activeSlot);
        api.slotReady[api.activeSlot] = true;
        api.finishLoad();
        api.ensurePreloads();
      }
    }, api.WEBFULLSCREEN_POLL_INTERVAL);
  };

  // ── 确保双向预加载 ────────────────────────────────────────

  api.ensurePreloads = function () {
    var ci = api.currentIndex;

    // 向前预加载
    var fwdIdx = ci + 1;
    if (fwdIdx < api.videos.length) {
      if (api.forwardSlot < 0) api.forwardSlot = api.findFreeSlot();
      if (api.forwardSlot >= 0 && (api.slotIndex[api.forwardSlot] !== fwdIdx || !api.slotReady[api.forwardSlot])) {
        api.preloadIntoSlot(api.forwardSlot, fwdIdx);
      }
    } else {
      api.forwardSlot = -1;
    }

    // 向后预加载
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

  // ── 暂停槽位中的视频 ──────────────────────────────────────

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

  // ── 激活槽位为播放状态 ────────────────────────────────────

  function activateSlot(slot, gen) {
    var ifr = api.iframes[slot];
    if (!ifr) return;
    ifr._blockPlay = false;
    ifr.style.opacity = '1';
    ifr.focus();
    if (ifr.contentDocument) {
      var doc = ifr.contentDocument;
      var video = doc.querySelector('video');
      if (video) { video.currentTime = 0; video.muted = false; video.play().catch(function () {}); }
      var wideBtn = doc.querySelector('.bpx-player-ctrl-web');
      if (wideBtn && !wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
      api.injectIframeHideStyles(doc);
      api.attachVideoEndedListener(doc, slot);
      doc.addEventListener('keydown', function (e) {
        var navKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B'];
        if (navKeys.indexOf(e.key) !== -1) {
          window.postMessage({ type: 'bikbok-key', key: e.key }, '*');
          e.preventDefault(); e.stopPropagation();
        }
      }, true);
    }
    api.iframe = ifr;
    api.slotReady[slot] = true;
  }

  // ── 前向/后向槽位交换 ────────────────────────────────────

  api.swapForward = function () {
    if (!api.isForwardReady()) return;
    api.iframeLoadGen++;
    api.slotGen[api.activeSlot]++;
    var gen = api.iframeLoadGen;
    if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
    if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
    if (api.autoAdvanceTimer !== null) { clearTimeout(api.autoAdvanceTimer); api.autoAdvanceTimer = null; }
    if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');

    var oldActive = api.activeSlot;
    var oldForward = api.forwardSlot;
    var oldBackward = api.backwardSlot;

    pauseAndBlockSlot(oldActive);
    api.slotGen[oldForward]++;

    api.activeSlot = oldForward;
    api.backwardSlot = oldActive;
    api.forwardSlot = oldBackward >= 0 ? oldBackward : api.findFreeSlot();
    if (api.forwardSlot < 0) api.forwardSlot = api.findFreeSlot();

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

    var nextIdx = api.currentIndex + 1;
    if (nextIdx < api.videos.length && api.forwardSlot >= 0) {
      api.preloadIntoSlot(api.forwardSlot, nextIdx);
    } else if (nextIdx >= api.videos.length) {
      api.forwardSlot = -1;
    }

    api.autoAdvanceTimer = setTimeout(function () {
      if (api.currentIndex < api.videos.length - 1) { api.currentIndex++; api.loadVideo(api.currentIndex); }
    }, api.AUTO_ADVANCE_FALLBACK_MS);
  };

  api.swapBackward = function () {
    if (!api.isBackwardReady()) return;
    api.iframeLoadGen++;
    api.slotGen[api.activeSlot]++;
    var gen = api.iframeLoadGen;
    if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
    if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
    if (api.autoAdvanceTimer !== null) { clearTimeout(api.autoAdvanceTimer); api.autoAdvanceTimer = null; }
    if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');

    var oldActive = api.activeSlot;
    var oldBackward = api.backwardSlot;
    var oldForward = api.forwardSlot;

    pauseAndBlockSlot(oldActive);
    api.slotGen[oldBackward]++;

    api.activeSlot = oldBackward;
    api.forwardSlot = oldActive;
    api.backwardSlot = oldForward >= 0 ? oldForward : api.findFreeSlot();
    if (api.backwardSlot < 0) api.backwardSlot = api.findFreeSlot();

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

    var prevIdx = api.currentIndex - 1;
    if (prevIdx >= 0 && api.backwardSlot >= 0) {
      api.preloadIntoSlot(api.backwardSlot, prevIdx);
    } else if (prevIdx < 0) {
      api.backwardSlot = -1;
    }

    api.autoAdvanceTimer = setTimeout(function () {
      if (api.currentIndex < api.videos.length - 1) { api.currentIndex++; api.loadVideo(api.currentIndex); }
    }, api.AUTO_ADVANCE_FALLBACK_MS);
  };

  // ── 倍速控制 ──────────────────────────────────────────────

  api.getCurrentSpeed = function () {
    var activeIfr = api.getActiveIframe();
    if (!activeIfr || !activeIfr.contentDocument) return 1.0;
    var video = activeIfr.contentDocument.querySelector('video');
    return video ? video.playbackRate : 1.0;
  };

  api.setPlaybackSpeed = function (rate) {
    var activeIfr = api.getActiveIframe();
    if (activeIfr && activeIfr.contentDocument) {
      var video = activeIfr.contentDocument.querySelector('video');
      if (video) video.playbackRate = rate;
    }
  };

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
