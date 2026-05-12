/**
 * bikbok — 播放器管理模块
 */
(function (api) {
  'use strict';

  api.loadVideo = function (index) {
    if (api.isTransitioning) return;
    api.isTransitioning = true;
    api.iframeLoadGen++;
    var loadGen = api.iframeLoadGen;
    const video = api.videos[index];
    if (!video) { api.isTransitioning = false; return; }
    if (api.autoAdvanceTimer !== null) { clearTimeout(api.autoAdvanceTimer); api.autoAdvanceTimer = null; }
    if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
    if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
    api.loadingEl.classList.remove('bikbok-loading-hidden');
    api.getActiveIframe().style.opacity = '0';
    api.getActiveIframe().src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';
    api.updateUI(index);
    api.loadingTimeoutId = setTimeout(function () {
      api.loadingTimeoutId = null;
      if (loadGen === api.iframeLoadGen && api.loadingEl && !api.loadingEl.classList.contains('bikbok-loading-hidden')) {
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
    var nextIdx = index + 1;
    if (nextIdx < api.videos.length && !api.preloadReady && api.preloadIndex !== nextIdx) {
      api.preloadVideo(nextIdx);
    }
  };

  api.immediatelyMuteIframe = function (iframeEl) {
    if (!iframeEl || !iframeEl.contentDocument) return;
    var doc = iframeEl.contentDocument;
    var els = doc.querySelectorAll('video, audio');
    for (var i = 0; i < els.length; i++) { els[i].muted = true; els[i].pause(); if (els[i].tagName === 'VIDEO') els[i].currentTime = 0; }
  };

  api.preloadVideo = function (index) {
    if (index >= api.videos.length || index === api.currentIndex) return;
    var preIfr = api.getPreloadIframe();
    if (!preIfr) return;
    if (api.earlyMuteTimerId !== null) { clearInterval(api.earlyMuteTimerId); api.earlyMuteTimerId = null; }
    api.preloadGen++;
    var gen = api.preloadGen;
    api.preloadReady = false;
    api.preloadIndex = index;
    var video = api.videos[index];
    if (!video) return;
    api.immediatelyMuteIframe(preIfr);
    preIfr.src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';
    var maxPolls = Math.floor(15000 / 50);
    var pollCount = 0;
    api.earlyMuteTimerId = setInterval(function () {
      if (gen !== api.preloadGen || api.preloadReady) { clearInterval(api.earlyMuteTimerId); api.earlyMuteTimerId = null; return; }
      pollCount++;
      api.immediatelyMuteIframe(preIfr);
      if (pollCount >= maxPolls) { clearInterval(api.earlyMuteTimerId); api.earlyMuteTimerId = null; }
    }, 50);
  };

  api.handlePreloadLoaded = function (iframeEl) {
    var gen = api.preloadGen;
    if (api.earlyMuteTimerId !== null) { clearInterval(api.earlyMuteTimerId); api.earlyMuteTimerId = null; }
    if (iframeEl && iframeEl.contentDocument) api.injectIframeHideStyles(iframeEl.contentDocument);
    function addPlayBlocker(video, ifr) {
      ifr._blockPlay = true;
      video.addEventListener('play', function () { if (ifr._blockPlay) { video.pause(); video.muted = true; } });
    }
    function tryPause() {
      if (gen !== api.preloadGen) return;
      if (!iframeEl || !iframeEl.contentDocument) return;
      var video = iframeEl.contentDocument.querySelector('video');
      if (video) { video.muted = true; video.pause(); video.currentTime = 0; addPlayBlocker(video, iframeEl); api.preloadReady = true; }
      else {
        var attempts = 0;
        var maxAttempts = Math.floor(5000 / 50);
        var timer = setInterval(function () {
          if (gen !== api.preloadGen) { clearInterval(timer); return; }
          attempts++;
          if (!iframeEl || !iframeEl.contentDocument) { clearInterval(timer); return; }
          var v = iframeEl.contentDocument.querySelector('video');
          if (v) { v.muted = true; v.pause(); v.currentTime = 0; addPlayBlocker(v, iframeEl); api.preloadReady = true; clearInterval(timer); }
          else if (attempts >= maxAttempts) { api.preloadReady = true; clearInterval(timer); }
        }, 50);
      }
    }
    tryPause();
  };

  api.onIframeLoad = function (slot) {
    var gen = api.iframeLoadGen;
    if (slot === api.activeSlot) api.setupPlayerInIframe(gen);
    else api.handlePreloadLoaded(api.iframes[slot]);
  };

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

  api.attachVideoEndedListener = function (doc, gen) {
    if (!doc) return;
    var video = doc.querySelector('video');
    if (video) {
      video.addEventListener('ended', function videoEndHandler() {
        if (gen === api.iframeLoadGen) api.onVideoEndedInIframe();
      }, { once: false });
      return;
    }
    var attempts = 0;
    var maxAttempts = Math.floor(5000 / 500);
    var pollTimer = setInterval(function () {
      if (gen !== api.iframeLoadGen) { clearInterval(pollTimer); return; }
      attempts++;
      var v = doc.querySelector('video');
      if (v) {
        v.addEventListener('ended', function videoEndHandler() {
          if (gen === api.iframeLoadGen) api.onVideoEndedInIframe();
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
      if (gen !== api.iframeLoadGen) { clearInterval(api.setupTimerId); api.setupTimerId = null; return; }
      pollCount++;
      var currentDoc = activeIfr && activeIfr.contentDocument;
      if (!currentDoc) { clearInterval(api.setupTimerId); api.setupTimerId = null; return; }
      var wideBtn = currentDoc.querySelector('.bpx-player-ctrl-web');
      if (wideBtn) {
        clearInterval(api.setupTimerId); api.setupTimerId = null;
        if (!wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
        api.injectIframeHideStyles(currentDoc);
        api.attachVideoEndedListener(currentDoc, gen);
        api.finishLoad();
      } else if (pollCount >= maxPolls) {
        clearInterval(api.setupTimerId); api.setupTimerId = null;
        api.injectIframeHideStyles(currentDoc);
        api.attachVideoEndedListener(currentDoc, gen);
        api.finishLoad();
      }
    }, api.WEBFULLSCREEN_POLL_INTERVAL);
  };

  api.onIframeError = function (slot) {
    if (slot === api.activeSlot) {
      if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
      var activeIfr = api.getActiveIframe();
      if (activeIfr) activeIfr.style.opacity = '0';
      api.showMessage('Failed to load video', true, function () { api.loadVideo(api.currentIndex); });
    }
  };

  api.swapAndPlayPreloaded = function () {
    if (!api.preloadReady) return;
    api.iframeLoadGen++;
    var gen = api.iframeLoadGen;
    if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
    if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
    if (api.autoAdvanceTimer !== null) { clearTimeout(api.autoAdvanceTimer); api.autoAdvanceTimer = null; }
    if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
    var oldActive = api.getActiveIframe();
    if (oldActive && oldActive.contentDocument) {
      var oldVideo = oldActive.contentDocument.querySelector('video');
      if (oldVideo) { oldVideo.pause(); oldVideo.muted = true; }
    }
    api.activeSlot = 1 - api.activeSlot;
    api.iframe = api.getActiveIframe();
    for (var i = 0; i < 2; i++) {
      if (api.iframes[i]) {
        api.iframes[i].className = (i === api.activeSlot) ? 'bikbok-player bikbok-player-active' : 'bikbok-player bikbok-player-preload';
      }
    }
    api.getActiveIframe().style.opacity = '1';
    api.getActiveIframe().focus();
    api.currentIndex = api.preloadIndex;
    api.preloadReady = false;
    api.preloadIndex = -1;
    var activeIfr = api.getActiveIframe();
    if (activeIfr && activeIfr.contentDocument) {
      var doc = activeIfr.contentDocument;
      var video = doc.querySelector('video');
      if (video) { activeIfr._blockPlay = false; video.currentTime = 0; video.muted = false; video.play().catch(function () {}); }
      var wideBtn = doc.querySelector('.bpx-player-ctrl-web');
      if (wideBtn && !wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
      api.injectIframeHideStyles(doc);
      api.attachVideoEndedListener(doc, gen);
      doc.addEventListener('keydown', function (e) {
var navKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B'];
    if (navKeys.indexOf(e.key) !== -1) {
      window.postMessage({ type: 'bikbok-key', key: e.key }, '*');
      e.preventDefault(); e.stopPropagation();
    }
  }, true);
}
api.updateUI(api.currentIndex);
    api.showTitleBriefly();
    api.hideHints();
    api.autoAdvanceTimer = setTimeout(function () {
      if (api.currentIndex < api.videos.length - 1) { api.currentIndex++; api.loadVideo(api.currentIndex); }
    }, api.AUTO_ADVANCE_FALLBACK_MS);
    var nextIdx = api.currentIndex + 1;
    if (nextIdx < api.videos.length) api.preloadVideo(nextIdx);
  };

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
