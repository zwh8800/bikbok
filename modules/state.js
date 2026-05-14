/**
 * bikbok — 共享状态与配置常量
 *
 * 定义全局运行时状态、配置常量、三槽位 iframe 系统辅助函数、
 * DOM 引用和导航注册表。所有模块通过 window.__bikbok 读写此命名空间，
 * 本文件在 manifest.json 中第一个加载，通过首次赋值 window.__bikbok 初始化。
 *
 * @module modules/state
 * @requires window.__bikbok
 */
(function (api) {
  'use strict';

  // ── 全局配置（超时、来源验证、首页检测）──
  /** @constant {number} 防抖延迟毫秒数，用于导航和按钮点击防抖 */
  api.DEBOUNCE_MS = 300;
  /** @constant {number} 视频加载超时毫秒数，超时后自动回退到下一个视频 */
  api.LOADING_TIMEOUT_MS = 15000;
  /** @constant {number} 自动前进回退毫秒数，视频结束后若未收到 ended 事件则超时触发 */
  api.AUTO_ADVANCE_FALLBACK_MS = 300000;
  /** @constant {string} B 站播放器 iframe 的精确来源，用于 postMessage 校验 */
  api.PLAYER_ORIGIN = 'https://www.bilibili.com';
  /** @constant {Set<string>} 首页路径集合，用于判断当前页面是否为 B 站首页 */
  api.HOME_PAGE_PATHS = new Set(['/', '/index.html']);
  /** @constant {number} 网页全屏轮询间隔毫秒数，用于检测 B 站播放器网页全屏按钮 */
  api.WEBFULLSCREEN_POLL_INTERVAL = 200;
  /** @constant {number} 网页全屏超时毫秒数，超过此时间放弃轮询 */
  api.WEBFULLSCREEN_TIMEOUT_MS = 10000;
  /** @constant {string[]} iframe 内需要隐藏的 B 站页面元素 CSS 选择器列表 */
  api.IFRAME_HIDE_SELECTORS = [
    '.bili-header',
    '.recommend-list',
    '.video-toolbar',
    '#comment',
    '.bili-footer',
    '.left-container .video-pod',
    '.video-page-special',
  ];

  // ── 全局状态（视频列表、导航位置、定时器 ID）──
  /** @type {Array<{bvid: string, title: string}>} 视频列表 */
  api.videos = [];
  /** @type {Set<string>} 已见过的 BV 号，用于去重 */
  api.seenBvids = new Set();
  /** @type {number} 当前播放视频在 videos 数组中的索引（0-based） */
  api.currentIndex = 0;
  /** @type {number} 上次导航时间戳，用于 ArrowDown/ArrowUp 防抖 */
  api.lastNavTime = 0;
  /** @type {boolean} 键盘提示是否已隐藏 */
  api.hintsHidden = false;
  /** @type {boolean} 是否正在切换视频，loadVideo 的防重入守卫 */
  api.isTransitioning = false;
  /** @type {number|null} 自动前进回退 setTimeout 定时器 ID */
  api.autoAdvanceTimer = null;
  /** @type {Promise|null} 视频池 refill 操作的 Promise，用于防止重复触发 */
  api.refillPromise = null;
  /** @type {number} 已尝试的刷新次数 */
  api.refreshAttempts = 0;
  /** @constant {number} 视频池剩余数量低于此值时触发 refill */
  api.REFILL_THRESHOLD = 3;
  /** @constant {number} 最大刷新重试次数 */
  api.MAX_REFRESH_ATTEMPTS = 3;
  /** @type {number} iframe 加载代数计数器，用于异步竞态保护 */
  api.iframeLoadGen = 0;
  /** @type {number|null} 加载超时定时器 ID */
  api.loadingTimeoutId = null;
  /** @type {number|null} 网页全屏按钮轮询定时器 ID */
  api.setupTimerId = null;
  /** @type {number|null} 早期静音轮询定时器 ID（已迁移到数组 earlyMuteTimerIds） */
  api.earlyMuteTimerId = null;
  /** @type {number|null} 倍速指示器自动消失定时器 ID */
  api.speedIndicatorTimer = null;
  /** @type {number|null} 播放进度指示器自动消失定时器 ID */
  api.progressIndicatorTimer = null;
  /** @type {number|null} 标题自动隐藏定时器 ID */
  api.titleTimerId = null;

  // ── 倍速控制（步长、范围）──
  /** @constant {number} 每次倍速调整的步长 */
  api.SPEED_STEP = 0.25;
  /** @constant {number} 最低倍速 */
  api.SPEED_MIN = 0.25;
  /** @constant {number} 最高倍速 */
  api.SPEED_MAX = 3.0;

  // ── 三 iframe 槽位系统（双向预加载）──
  /** @type {Array<HTMLIFrameElement|null>} 三个 iframe 槽位，activeSlot 可见，其余 visibility:hidden */
  api.iframes = [null, null, null];
  /** @type {number} 当前活跃槽位索引（0/1/2），该槽位的 iframe 可见 */
  api.activeSlot = 0;
  /** @type {number} 前方（下一个）预加载槽位索引，-1 表示未分配 */
  api.forwardSlot = -1;
  /** @type {number} 后方（上一个）预加载槽位索引，-1 表示未分配 */
  api.backwardSlot = -1;
  /** @type {Array<number>} 每个槽位对应的视频索引，-1 表示未分配 */
  api.slotIndex = [-1, -1, -1];
  /** @type {Array<number>} 每个槽位的代数计数器，用于异步竞态安全 */
  api.slotGen = [0, 0, 0];
  /** @type {Array<boolean>} 每个槽位的预加载完成标记 */
  api.slotReady = [false, false, false];
  /** @type {Array<number|null>} 每个槽位的早期静音定时器 ID */
  api.earlyMuteTimerIds = [null, null, null];

  /**
   * @description 获取当前活动槽位的 iframe 元素
   * @returns {HTMLIFrameElement|null}
   */
  api.getActiveIframe = function () {
    return api.iframes[api.activeSlot];
  };

  /**
   * @description 检查前向预加载槽位是否就绪，即 forwardSlot 有效、slotReady 为 true、且 slotIndex 匹配 currentIndex+1
   * @returns {boolean}
   */
  api.isForwardReady = function () {
    return api.forwardSlot >= 0 && api.slotReady[api.forwardSlot]
      && api.slotIndex[api.forwardSlot] === api.currentIndex + 1;
  };

  /**
   * @description 检查后向预加载槽位是否就绪，即 backwardSlot 有效、slotReady 为 true、且 slotIndex 匹配 currentIndex-1
   * @returns {boolean}
   */
  api.isBackwardReady = function () {
    return api.backwardSlot >= 0 && api.slotReady[api.backwardSlot]
      && api.slotIndex[api.backwardSlot] === api.currentIndex - 1;
  };

  /**
   * @description 寻找空闲槽位，排除 activeSlot、forwardSlot、backwardSlot
   * @returns {number} 空闲槽位索引，-1 表示无
   */
  api.findFreeSlot = function () {
    for (var i = 0; i < 3; i++) {
      if (i !== api.activeSlot && i !== api.forwardSlot && i !== api.backwardSlot) return i;
    }
    return -1;
  };

  // ── DOM 引用（覆盖层、标题、按钮等）──
  /** @type {HTMLElement|null} #bikbok-overlay 覆盖层元素 */
  api.overlay = null;
  /** @type {HTMLIFrameElement|null} 当前播放中的 iframe（便利引用，指向 iframes[activeSlot]） */
  api.iframe = null;
  /** @type {HTMLElement|null} 视频标题元素 */
  api.titleEl = null;
  /** @type {HTMLElement|null} 视频计数器元素（"N / M"） */
  api.counterEl = null;
  /** @type {HTMLElement|null} 键盘操作提示元素 */
  api.hintsEl = null;
  /** @type {HTMLElement|null} 加载动画元素 */
  api.loadingEl = null;
  /** @type {HTMLButtonElement|null} 模式切换按钮 #bikbok-toggle-btn */
  api.toggleBtn = null;
  /** @type {Array<{el: HTMLElement, display: string}>} 被隐藏的 B 站页面元素及其原始 display 值 */
  api.hiddenElements = [];

  // ── 导航注册表（解决循环依赖）──
  /** @type {{nextVideo: Function|null, prevVideo: Function|null, cleanup: Function|null}} 导航函数注册表，解决 content.js ↔ input.js 循环依赖 */
  api.navigation = {
    nextVideo: null,
    prevVideo: null,
    cleanup: null,
  };

})(window.__bikbok = window.__bikbok || {});
