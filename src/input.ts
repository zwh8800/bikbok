import type { BikbokAPI } from './types';

const api: BikbokAPI = window.__bikbok;

api.toggleFullscreen = function (): void {
  if (!api.overlay) return;
  if (document.fullscreenElement && document.fullscreenElement === api.overlay) {
    document.exitFullscreen();
  } else if (api.overlay.requestFullscreen) {
    api.overlay.requestFullscreen().catch(function () {});
  }
};

api.onKeyDown = function (e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (document.fullscreenElement && document.fullscreenElement === api.overlay) return;
    e.preventDefault();
    e.stopPropagation();
    if (api.navigation.cleanup) api.navigation.cleanup();
    return;
  }

  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    e.stopPropagation();
    api.toggleFullscreen();
    return;
  }

  if (e.key === 'i' || e.key === 'I') {
    if (!api.overlay) return;
    e.preventDefault();
    e.stopPropagation();
    const slower = api.adjustSpeed(-api.SPEED_STEP);
    api.showSpeedIndicator(slower);
    return;
  }

  if (e.key === 'o' || e.key === 'O') {
    if (!api.overlay) return;
    e.preventDefault();
    e.stopPropagation();
    const faster = api.adjustSpeed(api.SPEED_STEP);
    api.showSpeedIndicator(faster);
    return;
  }

  if (e.key === 'b' || e.key === 'B') {
    e.preventDefault();
    e.stopPropagation();
    if (api.navigation.cleanup) api.navigation.cleanup();
    return;
  }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!api.overlay) return;
    setTimeout(function () {
      const activeIfr = api.getActiveIframe();
      if (!activeIfr || !activeIfr.contentDocument) return;
      const video = activeIfr.contentDocument.querySelector<HTMLVideoElement>('video');
      if (video) api.showProgressIndicator(video.currentTime, video.duration);
    }, 200);
    return;
  }

  if (e.key === ' ') return;

  const now = Date.now();
  if (now - api.lastNavTime < api.DEBOUNCE_MS) return;

  switch (e.key) {
    case 'ArrowDown':
      api.lastNavTime = now;
      if (api.navigation.nextVideo) api.navigation.nextVideo();
      e.preventDefault();
      e.stopPropagation();
      break;
    case 'ArrowUp':
      api.lastNavTime = now;
      if (api.navigation.prevVideo) api.navigation.prevVideo();
      e.preventDefault();
      e.stopPropagation();
      break;
  }
};

api.onMessage = function (e: MessageEvent): void {
  if (e.origin !== api.PLAYER_ORIGIN) return;

  const activeIfr = api.getActiveIframe();
  if (!activeIfr || e.source !== activeIfr.contentWindow) return;

  const data = e.data;
  if (!data || typeof data !== 'object') return;

  const isEnded =
    data.type === 'video_ended' ||
    data.type === 'ended' ||
    data.event === 'video_ended' ||
    data.event === 'ended' ||
    data.info === 'ended';

  if (isEnded && api.currentIndex < api.videos.length - 1) {
    if (api.navigation.nextVideo) api.navigation.nextVideo();
  }
};

api.onBikbokKey = function (e: MessageEvent): void {
  if (e.data && e.data.type === 'bikbok-key') {
    api.onKeyDown({
      key: e.data.key,
      preventDefault: function () {},
      stopPropagation: function () {},
    } as KeyboardEvent);
  }
};
