import type { BikbokAPI } from './types';

const api: BikbokAPI = window.__bikbok;

api.createOverlay = function (): void {
  api.overlay = document.createElement('div');
  api.overlay.id = 'bikbok-overlay';
  api.overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;';

  api.loadingEl = document.createElement('div');
  api.loadingEl.className = 'bikbok-loading';
  api.overlay.appendChild(api.loadingEl);

  for (let slot = 0; slot < 3; slot++) {
    const ifr = document.createElement('iframe');
    ifr.className = slot === api.activeSlot
      ? 'bikbok-player bikbok-player-active'
      : 'bikbok-player bikbok-player-preload';
    ifr.setAttribute('allow', 'autoplay; fullscreen');
    api.iframes[slot] = ifr;
    api.overlay.appendChild(ifr);
  }

  api.iframe = api.getActiveIframe();

  api.titleEl = document.createElement('div');
  api.titleEl.className = 'bikbok-title';
  api.overlay.appendChild(api.titleEl);

  api.hintsEl = document.createElement('div');
  api.hintsEl.className = 'bikbok-hints';
  api.hintsEl.textContent = '↑ ↓ 切换视频\n← → 快进快退\nSpace 播放/暂停\nF 全屏\nI O 倍速\nEsc 退出';
  api.overlay.appendChild(api.hintsEl);

  document.body.appendChild(api.overlay);
};

api.updateUI = function (index: number): void {
  const video = api.videos[index];
  if (!video) return;
  if (api.titleEl) api.titleEl.textContent = video.title;
};

api.showMessage = function (text: string, showRetry?: boolean, retryCallback?: () => void): void {
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
    btn.addEventListener('click', function () {
      msg.remove();
      if (retryCallback) retryCallback();
    });
    msg.appendChild(btn);
  }

  api.overlay.appendChild(msg);
};

api.showEndMessage = function (text?: string): void {
  if (!api.overlay) return;
  const existing = api.overlay.querySelector('.bikbok-end');
  if (existing) existing.remove();

  const msg = document.createElement('div');
  msg.className = 'bikbok-end';
  msg.textContent = typeof text === 'string' ? text : 'End of recommendations \u2728';
  api.overlay.appendChild(msg);
};

api.removeEndMessage = function (): void {
  if (!api.overlay) return;
  const el = api.overlay.querySelector('.bikbok-end');
  if (el) el.remove();
};

api.hideHints = function (): void {
  if (!api.hintsHidden && api.hintsEl) {
    api.hintsHidden = true;
    api.hintsEl.classList.add('bikbok-hints-hidden');
  }
};

api.showProgressIndicator = function (currentTime: number, duration: number): void {
  if (!api.overlay) return;
  const prev = api.overlay.querySelector('.bikbok-progress-indicator');
  if (prev) prev.remove();
  if (api.progressIndicatorTimer !== null) clearTimeout(api.progressIndicatorTimer);

  const el = document.createElement('div');
  el.className = 'bikbok-progress-indicator';

  function fmt(sec: number, showHours: boolean): string {
    if (!isFinite(sec) || sec < 0) return '--:--';
    const h = showHours ? Math.floor(sec / 3600) : 0;
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const pad = function (n: number) { return (n < 10 ? '0' : '') + n; };
    return showHours ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
  }

  const hasHours = isFinite(duration) && duration >= 3600;
  el.textContent = fmt(currentTime, hasHours) + ' / ' + fmt(duration, hasHours);
  api.overlay.appendChild(el);

  api.progressIndicatorTimer = window.setTimeout(function () {
    if (el.parentNode) el.remove();
  }, 1500);
};

api.showSpeedIndicator = function (speed: number): void {
  if (!api.overlay) return;
  const prev = api.overlay.querySelector('.bikbok-speed-indicator');
  if (prev) prev.remove();
  if (api.speedIndicatorTimer !== null) clearTimeout(api.speedIndicatorTimer);

  const el = document.createElement('div');
  el.className = 'bikbok-speed-indicator';
  el.textContent = speed + 'x';
  api.overlay.appendChild(el);

  api.speedIndicatorTimer = window.setTimeout(function () {
    if (el.parentNode) el.remove();
  }, 1500);
};

api.showTitleBriefly = function (): void {
  if (!api.titleEl) return;
  if (api.titleTimerId !== null) clearTimeout(api.titleTimerId);
  api.titleEl.classList.remove('bikbok-title-hidden');
  api.titleTimerId = window.setTimeout(function () {
    if (api.titleEl) api.titleEl.classList.add('bikbok-title-hidden');
  }, 3000);
};
