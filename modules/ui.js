/**
 * bikbok — UI 模块
 */
(function (api) {
  'use strict';

  api.createOverlay = function () {
    api.overlay = document.createElement('div');
    api.overlay.id = 'bikbok-overlay';
    api.overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;';
    api.loadingEl = document.createElement('div');
    api.loadingEl.className = 'bikbok-loading';
    api.overlay.appendChild(api.loadingEl);
    for (var slot = 0; slot < 3; slot++) {
      var ifr = document.createElement('iframe');
      ifr.className = slot === api.activeSlot ? 'bikbok-player bikbok-player-active' : 'bikbok-player bikbok-player-preload';
      ifr.setAttribute('allow', 'autoplay; fullscreen');
      api.iframes[slot] = ifr;
      api.overlay.appendChild(ifr);
    }
    api.iframe = api.getActiveIframe();
    api.titleEl = document.createElement('div');
    api.titleEl.className = 'bikbok-title';
    api.overlay.appendChild(api.titleEl);
    api.counterEl = document.createElement('div');
    api.counterEl.className = 'bikbok-counter';
    api.overlay.appendChild(api.counterEl);
    api.hintsEl = document.createElement('div');
    api.hintsEl.className = 'bikbok-hints';
    api.hintsEl.textContent = '↑ ↓ 切换视频\n← → 快进快退\nSpace 播放/暂停\nF 全屏\nI O 倍速\nEsc 退出';
    api.overlay.appendChild(api.hintsEl);
    document.body.appendChild(api.overlay);
  };

  api.updateUI = function (index) {
    const video = api.videos[index];
    if (!video) return;
    if (api.titleEl) api.titleEl.textContent = video.title;
    if (api.counterEl) {
      if (api.videos.length > 1) {
        api.counterEl.textContent = `${index + 1} / ${api.videos.length}`;
        api.counterEl.style.display = '';
      } else {
        api.counterEl.style.display = 'none';
      }
    }
  };

  api.showMessage = function (text, showRetry, retryCallback) {
    if (!api.overlay) return;
    const prev = api.overlay.querySelector('.bikbok-message');
    if (prev) prev.remove();
    const msg = document.createElement('div');
    msg.className = 'bikbok-message';
    msg.textContent = text;
    if (showRetry) {
      msg.appendChild(document.createElement('br'));
      const btn = document.createElement('button');
      btn.className = 'bikbok-retry';
      btn.textContent = 'Retry';
      btn.addEventListener('click', function () { msg.remove(); if (retryCallback) retryCallback(); });
      msg.appendChild(btn);
    }
    api.overlay.appendChild(msg);
  };

  api.showEndMessage = function (text) {
    if (!api.overlay) return;
    var existing = api.overlay.querySelector('.bikbok-end');
    if (existing) existing.remove();
    var msg = document.createElement('div');
    msg.className = 'bikbok-end';
    msg.textContent = typeof text === 'string' ? text : 'End of recommendations \u2728';
    api.overlay.appendChild(msg);
  };

  api.removeEndMessage = function () {
    if (!api.overlay) return;
    var el = api.overlay.querySelector('.bikbok-end');
    if (el) el.remove();
  };

  api.hideHints = function () {
    if (!api.hintsHidden && api.hintsEl) {
      api.hintsHidden = true;
      api.hintsEl.classList.add('bikbok-hints-hidden');
    }
  };

  api.showSpeedIndicator = function (speed) {
    if (!api.overlay) return;
    var prev = api.overlay.querySelector('.bikbok-speed-indicator');
    if (prev) prev.remove();
    clearTimeout(api.speedIndicatorTimer);
    var el = document.createElement('div');
    el.className = 'bikbok-speed-indicator';
    el.textContent = speed + 'x';
    api.overlay.appendChild(el);
    api.speedIndicatorTimer = setTimeout(function () { if (el.parentNode) el.remove(); }, 1500);
  };

  api.showTitleBriefly = function () {
    if (!api.titleEl) return;
    clearTimeout(api.titleTimerId);
    api.titleEl.classList.remove('bikbok-title-hidden');
    api.titleTimerId = setTimeout(function () {
      if (api.titleEl) api.titleEl.classList.add('bikbok-title-hidden');
    }, 3000);
  };

})(window.__bikbok);
