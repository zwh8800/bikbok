import type { BikbokAPI, SlotIndex, SlotOrNone } from './types';

const api: BikbokAPI = window.__bikbok;

// ── 本地函数：暂停槽位中的视频 ──────────────────────────────────────

function pauseAndBlockSlot(slot: number): void {
  const ifr = api.iframes[slot];
  if (!ifr || !ifr.contentDocument) return;
  const video = ifr.contentDocument.querySelector<HTMLVideoElement>('video');
  if (video) { video.pause(); video.muted = true; }
  ifr._blockPlay = true;
  if (video) {
    video.addEventListener('play', function () { if (ifr._blockPlay) { video.pause(); video.muted = true; } });
  }
}

// ── 本地函数：激活槽位为播放状态 ────────────────────────────────────

function activateSlot(slot: number, gen: number): void {
  const ifr = api.iframes[slot];
  if (!ifr) return;
  ifr._blockPlay = false;
  ifr.style.opacity = '1';
  ifr.focus();
  if (ifr.contentDocument) {
    const doc = ifr.contentDocument;
    const video = doc.querySelector<HTMLVideoElement>('video');
    if (video) { video.currentTime = 0; video.muted = false; video.play().catch(function () {}); }
    const wideBtn = doc.querySelector<HTMLElement>('.bpx-player-ctrl-web');
    if (wideBtn && !wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
    api.injectIframeHideStyles(doc);
    api.attachVideoEndedListener(doc, slot);
    doc.addEventListener('keydown', function (e: KeyboardEvent) {
      const forwardKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B', 'ArrowLeft', 'ArrowRight'];
      const blockKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B'];
      if (forwardKeys.indexOf(e.key) !== -1) {
        window.postMessage({ type: 'bikbok-key', key: e.key }, '*');
      }
      if (blockKeys.indexOf(e.key) !== -1) {
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
  }
  api.iframe = ifr;
  api.slotReady[slot] = true;
}

// ── 视频加载 ────────────────────────────────────────────────────────

api.loadVideo = function (index: number): void {
  if (api.isTransitioning) return;
  api.isTransitioning = true;
  api.slotGen[api.activeSlot]++;
  api.iframeLoadGen++;
  const gen = api.slotGen[api.activeSlot];
  const loadGen = api.iframeLoadGen;
  const video = api.videos[index];
  if (!video) { api.isTransitioning = false; return; }
  if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
  if (api.setupTimerId !== null) { clearInterval(api.setupTimerId); api.setupTimerId = null; }
  api.loadingEl!.classList.remove('bikbok-loading-hidden');
  const activeIfr = api.getActiveIframe();
  if (activeIfr) activeIfr.style.opacity = '0';
  if (activeIfr && activeIfr.contentDocument) {
    const oldVideo = activeIfr.contentDocument.querySelector<HTMLVideoElement>('video');
    if (oldVideo) { oldVideo.pause(); oldVideo.muted = true; }
  }
  if (activeIfr) activeIfr.src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';
  api.updateUI(index);
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

// ── 三槽位预加载 ────────────────────────────────────────────────────

api.immediatelyMuteIframe = function (iframeEl: HTMLIFrameElement): void {
  if (!iframeEl || !iframeEl.contentDocument) return;
  const doc = iframeEl.contentDocument;
  const els = doc.querySelectorAll<HTMLVideoElement | HTMLAudioElement>('video, audio');
  for (let i = 0; i < els.length; i++) { els[i].muted = true; els[i].pause(); if (els[i].tagName === 'VIDEO') (els[i] as HTMLVideoElement).currentTime = 0; }
};

api.preloadIntoSlot = function (slot: number, videoIndex: number): void {
  if (videoIndex < 0 || videoIndex >= api.videos.length) return;
  if (videoIndex === api.currentIndex) return;
  if (slot < 0 || slot >= 3) return;
  api.slotGen[slot]++;
  const gen = api.slotGen[slot];
  if (api.earlyMuteTimerIds[slot] !== null) {
    clearInterval(api.earlyMuteTimerIds[slot]!);
    api.earlyMuteTimerIds[slot] = null;
  }
  api.slotReady[slot] = false;
  api.slotIndex[slot] = videoIndex;
  const ifr = api.iframes[slot];
  if (!ifr) return;
  const video = api.videos[videoIndex];
  if (!video) return;
  api.immediatelyMuteIframe(ifr);
  ifr.src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';
  const maxPolls = Math.floor(15000 / 50);
  let pollCount = 0;
  api.earlyMuteTimerIds[slot] = setInterval(function () {
    if (gen !== api.slotGen[slot] || api.slotReady[slot]) {
      clearInterval(api.earlyMuteTimerIds[slot]!);
      api.earlyMuteTimerIds[slot] = null;
      return;
    }
    pollCount++;
    api.immediatelyMuteIframe(ifr);
    if (pollCount >= maxPolls) {
      clearInterval(api.earlyMuteTimerIds[slot]!);
      api.earlyMuteTimerIds[slot] = null;
    }
  }, 50);
};

api.handlePreloadLoaded = function (slot: number): void {
  const gen = api.slotGen[slot];
  if (api.earlyMuteTimerIds[slot] !== null) {
    clearInterval(api.earlyMuteTimerIds[slot]!);
    api.earlyMuteTimerIds[slot] = null;
  }
  const ifr = api.iframes[slot];
  if (ifr && ifr.contentDocument) api.injectIframeHideStyles(ifr.contentDocument);
  function addPlayBlocker(video: HTMLVideoElement, iframeEl: HTMLIFrameElement): void {
    iframeEl._blockPlay = true;
    video.addEventListener('play', function () { if (iframeEl._blockPlay) { video.pause(); video.muted = true; } });
  }
  function tryPause(): void {
    if (gen !== api.slotGen[slot]) return;
    if (!ifr || !ifr.contentDocument) return;
    const video = ifr.contentDocument.querySelector<HTMLVideoElement>('video');
    if (video) { video.muted = true; video.pause(); video.currentTime = 0; addPlayBlocker(video, ifr); api.slotReady[slot] = true; }
    else {
      let attempts = 0;
      const maxAttempts = Math.floor(5000 / 50);
      const timer = setInterval(function () {
        if (gen !== api.slotGen[slot]) { clearInterval(timer); return; }
        attempts++;
        if (!ifr || !ifr.contentDocument) { clearInterval(timer); return; }
        const v = ifr.contentDocument.querySelector<HTMLVideoElement>('video');
        if (v) { v.muted = true; v.pause(); v.currentTime = 0; addPlayBlocker(v, ifr); api.slotReady[slot] = true; clearInterval(timer); }
        else if (attempts >= maxAttempts) { api.slotReady[slot] = true; clearInterval(timer); }
      }, 50);
    }
  }
  tryPause();
};

// ── iframe 事件路由 ─────────────────────────────────────────────────

api.onIframeLoad = function (slot: number): void {
  if (slot === api.activeSlot) {
    const gen = api.slotGen[api.activeSlot];
    api.setupPlayerInIframe(gen);
  } else {
    api.handlePreloadLoaded(slot);
  }
};

api.onIframeError = function (slot: number): void {
  if (slot === api.activeSlot) {
    if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
    const activeIfr = api.getActiveIframe();
    if (activeIfr) activeIfr.style.opacity = '0';
    api.showMessage('Failed to load video', true, function () { api.loadVideo(api.currentIndex); });
  } else {
    api.slotReady[slot] = false;
    api.slotIndex[slot] = -1;
  }
};

// ── 播放器设置 ─────────────────────────────────────────────────────

api.finishLoad = function (): void {
  if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');
  const activeIfr = api.getActiveIframe();
  if (activeIfr) { activeIfr.style.opacity = '1'; activeIfr.focus(); }
  api.showTitleBriefly();
};

api.injectIframeHideStyles = function (doc: Document): void {
  if (!doc || !doc.body) return;
  doc.body.style.background = '#000';
  doc.documentElement.style.overflow = 'hidden';
  for (let i = 0; i < api.IFRAME_HIDE_SELECTORS.length; i++) {
    const els = doc.querySelectorAll<HTMLElement>(api.IFRAME_HIDE_SELECTORS[i]);
    for (let j = 0; j < els.length; j++) els[j].style.setProperty('display', 'none', 'important');
  }
};

api.onVideoEndedInIframe = function (): void {
  if (api.currentIndex < api.videos.length - 1) api.navigation.nextVideo!();
};

api.attachVideoEndedListener = function (doc: Document, slot: number): void {
  if (!doc) return;
  const gen = api.slotGen[slot];
  const video = doc.querySelector<HTMLVideoElement>('video');
  if (video) {
    video.addEventListener('ended', function videoEndHandler() {
      if (gen === api.slotGen[slot] && slot === api.activeSlot) api.onVideoEndedInIframe();
    }, { once: false });
    return;
  }
  let attempts = 0;
  const maxAttempts = Math.floor(5000 / 500);
  const pollTimer = setInterval(function () {
    if (gen !== api.slotGen[slot] || slot !== api.activeSlot) { clearInterval(pollTimer); return; }
    attempts++;
    const v = doc.querySelector<HTMLVideoElement>('video');
    if (v) {
      v.addEventListener('ended', function videoEndHandler() {
        if (gen === api.slotGen[slot] && slot === api.activeSlot) api.onVideoEndedInIframe();
      }, { once: false });
      clearInterval(pollTimer);
    } else if (attempts >= maxAttempts) { clearInterval(pollTimer); }
  }, 500);
};

api.setupPlayerInIframe = function (gen: number): void {
  const activeIfr = api.getActiveIframe();
  if (!activeIfr || !activeIfr.contentDocument) {
    if (activeIfr && activeIfr.contentDocument) api.injectIframeHideStyles(activeIfr.contentDocument);
    api.finishLoad();
    api.ensurePreloads();
    return;
  }
  const doc = activeIfr.contentDocument;
  doc.addEventListener('keydown', function (e: KeyboardEvent) {
    const forwardKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B', 'ArrowLeft', 'ArrowRight'];
    const blockKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'f', 'F', 'i', 'I', 'o', 'O', 'b', 'B'];
    if (forwardKeys.indexOf(e.key) !== -1) {
      window.postMessage({ type: 'bikbok-key', key: e.key }, '*');
    }
    if (blockKeys.indexOf(e.key) !== -1) {
      e.preventDefault(); e.stopPropagation();
    }
  }, true);
  let pollCount = 0;
  const maxPolls = Math.floor(api.WEBFULLSCREEN_TIMEOUT_MS / api.WEBFULLSCREEN_POLL_INTERVAL);
  api.setupTimerId = setInterval(function () {
    if (gen !== api.slotGen[api.activeSlot]) { clearInterval(api.setupTimerId!); api.setupTimerId = null; return; }
    pollCount++;
    const currentDoc = activeIfr && activeIfr.contentDocument;
    if (!currentDoc) { clearInterval(api.setupTimerId!); api.setupTimerId = null; return; }
    const wideBtn = currentDoc.querySelector<HTMLElement>('.bpx-player-ctrl-web');
    if (wideBtn) {
      clearInterval(api.setupTimerId!); api.setupTimerId = null;
      if (!wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
      api.injectIframeHideStyles(currentDoc);
      api.attachVideoEndedListener(currentDoc, api.activeSlot);
      api.slotReady[api.activeSlot] = true;
      api.finishLoad();
      api.ensurePreloads();
    } else if (pollCount >= maxPolls) {
      clearInterval(api.setupTimerId!); api.setupTimerId = null;
      api.injectIframeHideStyles(currentDoc);
      api.attachVideoEndedListener(currentDoc, api.activeSlot);
      api.slotReady[api.activeSlot] = true;
      api.finishLoad();
      api.ensurePreloads();
    }
  }, api.WEBFULLSCREEN_POLL_INTERVAL);
};

// ── 确保双向预加载就绪 ────────────────────────────────────────────

api.ensurePreloads = function (): void {
  const ci = api.currentIndex;

  const fwdIdx = ci + 1;
  if (fwdIdx < api.videos.length) {
    if (api.forwardSlot < 0) api.forwardSlot = api.findFreeSlot() as SlotOrNone;
    if (api.forwardSlot >= 0 && (api.slotIndex[api.forwardSlot] !== fwdIdx || !api.slotReady[api.forwardSlot])) {
      api.preloadIntoSlot(api.forwardSlot, fwdIdx);
    }
  } else {
    api.forwardSlot = -1;
  }

  const bwdIdx = ci - 1;
  if (bwdIdx >= 0) {
    if (api.backwardSlot < 0) api.backwardSlot = api.findFreeSlot() as SlotOrNone;
    if (api.backwardSlot >= 0 && (api.slotIndex[api.backwardSlot] !== bwdIdx || !api.slotReady[api.backwardSlot])) {
      api.preloadIntoSlot(api.backwardSlot, bwdIdx);
    }
  } else {
    api.backwardSlot = -1;
  }
};

// ── 槽位交换 ────────────────────────────────────────────────────────

api.swapForward = function (): void {
  if (!api.isForwardReady()) return;
  api.iframeLoadGen++;
  api.slotGen[api.activeSlot]++;
  const gen = api.iframeLoadGen;
  if (api.setupTimerId !== null) { clearInterval(api.setupTimerId!); api.setupTimerId = null; }
  if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
  if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');

  const oldActive = api.activeSlot;
  const oldForward = api.forwardSlot;
  const oldBackward = api.backwardSlot;

  pauseAndBlockSlot(oldActive);
  api.slotGen[oldForward]++;

  api.activeSlot = oldForward as SlotIndex;
  api.backwardSlot = oldActive;
  api.forwardSlot = (oldBackward >= 0 ? oldBackward : api.findFreeSlot()) as SlotOrNone;
  if (api.forwardSlot < 0) api.forwardSlot = api.findFreeSlot() as SlotOrNone;

  for (let i = 0; i < 3; i++) {
    if (api.iframes[i]) {
      api.iframes[i]!.className = (i === api.activeSlot)
        ? 'bikbok-player bikbok-player-active'
        : 'bikbok-player bikbok-player-preload';
    }
  }

  api.currentIndex++;
  activateSlot(api.activeSlot, gen);
  api.updateUI(api.currentIndex);
  api.showTitleBriefly();
  api.hideHints();

  const nextIdx = api.currentIndex + 1;
  if (nextIdx < api.videos.length && api.forwardSlot >= 0) {
    api.preloadIntoSlot(api.forwardSlot, nextIdx);
  } else if (nextIdx >= api.videos.length) {
    api.forwardSlot = -1;
  }
};

api.swapBackward = function (): void {
  if (!api.isBackwardReady()) return;
  api.iframeLoadGen++;
  api.slotGen[api.activeSlot]++;
  const gen = api.iframeLoadGen;
  if (api.setupTimerId !== null) { clearInterval(api.setupTimerId!); api.setupTimerId = null; }
  if (api.loadingTimeoutId !== null) { clearTimeout(api.loadingTimeoutId); api.loadingTimeoutId = null; }
  if (api.loadingEl) api.loadingEl.classList.add('bikbok-loading-hidden');

  const oldActive = api.activeSlot;
  const oldBackward = api.backwardSlot;
  const oldForward = api.forwardSlot;

  pauseAndBlockSlot(oldActive);
  api.slotGen[oldBackward]++;

  api.activeSlot = oldBackward as SlotIndex;
  api.forwardSlot = oldActive;
  api.backwardSlot = (oldForward >= 0 ? oldForward : api.findFreeSlot()) as SlotOrNone;
  if (api.backwardSlot < 0) api.backwardSlot = api.findFreeSlot() as SlotOrNone;

  for (let i = 0; i < 3; i++) {
    if (api.iframes[i]) {
      api.iframes[i]!.className = (i === api.activeSlot)
        ? 'bikbok-player bikbok-player-active'
        : 'bikbok-player bikbok-player-preload';
    }
  }

  api.currentIndex--;
  activateSlot(api.activeSlot, gen);
  api.updateUI(api.currentIndex);
  api.showTitleBriefly();
  api.hideHints();

  const prevIdx = api.currentIndex - 1;
  if (prevIdx >= 0 && api.backwardSlot >= 0) {
    api.preloadIntoSlot(api.backwardSlot, prevIdx);
  } else if (prevIdx < 0) {
    api.backwardSlot = -1;
  }
};

// ── 倍速控制 ────────────────────────────────────────────────────────

api.getCurrentSpeed = function (): number {
  const activeIfr = api.getActiveIframe();
  if (!activeIfr || !activeIfr.contentDocument) return 1.0;
  const video = activeIfr.contentDocument.querySelector<HTMLVideoElement>('video');
  return video ? video.playbackRate : 1.0;
};

api.setPlaybackSpeed = function (rate: number): void {
  const activeIfr = api.getActiveIframe();
  if (activeIfr && activeIfr.contentDocument) {
    const video = activeIfr.contentDocument.querySelector<HTMLVideoElement>('video');
    if (video) video.playbackRate = rate;
  }
};

api.adjustSpeed = function (delta: number): number {
  let newRate = api.getCurrentSpeed() + delta;
  if (newRate < api.SPEED_MIN) newRate = api.SPEED_MIN;
  if (newRate > api.SPEED_MAX) newRate = api.SPEED_MAX;
  newRate = Math.round(newRate * 100) / 100;
  api.setPlaybackSpeed(newRate);
  return newRate;
};
