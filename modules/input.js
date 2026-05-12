/**
 * bikbok — 输入处理模块
 */
(function (api) {
  'use strict';

  api.toggleFullscreen = function () {
    if (!api.overlay) return;
    if (document.fullscreenElement && document.fullscreenElement === api.overlay) {
      document.exitFullscreen();
    } else if (api.overlay.requestFullscreen) {
      api.overlay.requestFullscreen().catch(function () {});
    }
  };

  api.onKeyDown = function (e) {
    if (e.key === 'Escape') {
      if (document.fullscreenElement && document.fullscreenElement === api.overlay) return;
      e.preventDefault();
      e.stopPropagation();
      api.navigation.cleanup();
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      e.stopPropagation();
      api.toggleFullscreen();
      return;
    }
    if (e.key === ' ') return;
    const now = Date.now();
    if (now - api.lastNavTime < api.DEBOUNCE_MS) return;
    let handled = false;
    switch (e.key) {
      case 'ArrowDown': api.lastNavTime = now; api.navigation.nextVideo(); handled = true; break;
      case 'ArrowUp': api.lastNavTime = now; api.navigation.prevVideo(); handled = true; break;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  api.onMessage = function (e) {
    if (e.origin !== api.PLAYER_ORIGIN) return;
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    const isEnded = data.type === 'video_ended' || data.type === 'ended' || data.event === 'video_ended' || data.event === 'ended' || data.info === 'ended';
    if (isEnded && api.currentIndex < api.videos.length - 1) {
      if (api.autoAdvanceTimer !== null) { clearTimeout(api.autoAdvanceTimer); api.autoAdvanceTimer = null; }
      api.navigation.nextVideo();
    }
  };

  api.onBikbokKey = function (e) {
    if (e.data && e.data.type === 'bikbok-key') {
      api.onKeyDown({ key: e.data.key, preventDefault: function () {}, stopPropagation: function () {} });
    }
  };

})(window.__bikbok);
