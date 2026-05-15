import type { BikbokAPI } from './types';

const api: BikbokAPI = (window.__bikbok = window.__bikbok || {}) as BikbokAPI;

// ── 全局配置 ──
api.DEBOUNCE_MS = 300;
api.LOADING_TIMEOUT_MS = 15000;
api.PLAYER_ORIGIN = 'https://www.bilibili.com';
api.HOME_PAGE_PATHS = new Set(['/', '/index.html']);
api.WEBFULLSCREEN_POLL_INTERVAL = 200;
api.WEBFULLSCREEN_TIMEOUT_MS = 10000;
api.IFRAME_HIDE_SELECTORS = [
  '.bili-header',
  '.recommend-list',
  '.video-toolbar',
  '#comment',
  '.bili-footer',
  '.left-container .video-pod',
  '.video-page-special',
];

// ── 全局状态 ──
api.videos = [];
api.seenBvids = new Set();
api.currentIndex = 0;
api.lastNavTime = 0;
api.hintsHidden = false;
api.isTransitioning = false;
api.refillPromise = null;
api.refreshAttempts = 0;
api.REFILL_THRESHOLD = 3;
api.MAX_REFRESH_ATTEMPTS = 3;
api.iframeLoadGen = 0;
api.loadingTimeoutId = null;
api.setupTimerId = null;
api.earlyMuteTimerId = null;
api.speedIndicatorTimer = null;
api.progressIndicatorTimer = null;
api.titleTimerId = null;

// ── 倍速控制 ──
api.SPEED_STEP = 0.25;
api.SPEED_MIN = 0.25;
api.SPEED_MAX = 3.0;

// ── 三槽位系统 ──
api.iframes = [null, null, null];
api.activeSlot = 0;
api.forwardSlot = -1;
api.backwardSlot = -1;
api.slotIndex = [-1, -1, -1];
api.slotGen = [0, 0, 0];
api.slotReady = [false, false, false];
api.earlyMuteTimerIds = [null, null, null];

// ── 辅助函数 ──
api.getActiveIframe = function (): HTMLIFrameElement | null {
  return api.iframes[api.activeSlot];
};

api.isForwardReady = function (): boolean {
  return api.forwardSlot >= 0 &&
    api.slotReady[api.forwardSlot] &&
    api.slotIndex[api.forwardSlot] === api.currentIndex + 1;
};

api.isBackwardReady = function (): boolean {
  return api.backwardSlot >= 0 &&
    api.slotReady[api.backwardSlot] &&
    api.slotIndex[api.backwardSlot] === api.currentIndex - 1;
};

api.findFreeSlot = function (): number {
  for (let i = 0; i < 3; i++) {
    if (i !== api.activeSlot && i !== api.forwardSlot && i !== api.backwardSlot) return i;
  }
  return -1;
};

// ── DOM 引用 ──
api.overlay = null;
api.iframe = null;
api.titleEl = null;
api.counterEl = null;
api.hintsEl = null;
api.loadingEl = null;
api.toggleBtn = null;
api.hiddenElements = [];

// ── 导航注册表 ──
api.navigation = {
  nextVideo: null,
  prevVideo: null,
  cleanup: null,
};
