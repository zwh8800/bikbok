/**
 * bikbok — TypeScript 类型定义
 *
 * 定义所有共享类型、BikbokAPI 完整接口、Window 全局声明。
 * 运行时所有模块通过 window.__bikbok 访问此命名空间。
 */

// ── 基础类型 ────────────────────────────────────────────────────

export interface VideoItem {
  bvid: string;
  title: string;
}

export interface HiddenElementRecord {
  el: HTMLElement;
  display: string;
}

export interface NavigationRegistry {
  nextVideo: (() => void) | null;
  prevVideo: (() => void) | null;
  cleanup: (() => void) | null;
}

export type SlotIndex = 0 | 1 | 2;
export type SlotOrNone = -1 | SlotIndex;

// ── HTMLIFrameElement 扩展属性 _blockPlay ───────────────────────

declare global {
  interface HTMLIFrameElement {
    /** 预加载槽位视频的 play 阻止标志 */
    _blockPlay?: boolean;
  }
}

// ── BikbokAPI 完整接口 ─────────────────────────────────────────

export interface BikbokAPI {
  // ══ 配置常量（只读） ════════════════════════════════════════
  DEBOUNCE_MS: number;
  LOADING_TIMEOUT_MS: number;
  PLAYER_ORIGIN: string;
  HOME_PAGE_PATHS: Set<string>;
  WEBFULLSCREEN_POLL_INTERVAL: number;
  WEBFULLSCREEN_TIMEOUT_MS: number;
  IFRAME_HIDE_SELECTORS: string[];
  REFILL_THRESHOLD: number;
  MAX_REFRESH_ATTEMPTS: number;
  SPEED_STEP: number;
  SPEED_MIN: number;
  SPEED_MAX: number;

  // ══ 可变状态 ════════════════════════════════════════════════
  videos: VideoItem[];
  seenBvids: Set<string>;
  currentIndex: number;
  lastNavTime: number;
  hintsHidden: boolean;
  isTransitioning: boolean;
  refillPromise: Promise<number> | null;
  refreshAttempts: number;
  iframeLoadGen: number;
  loadingTimeoutId: number | null;
  setupTimerId: number | null;
  earlyMuteTimerId: number | null;
  speedIndicatorTimer: number | null;
  progressIndicatorTimer: number | null;
  titleTimerId: number | null;

  // ══ 三槽位系统 ══════════════════════════════════════════════
  iframes: (HTMLIFrameElement | null)[];
  activeSlot: SlotIndex;
  forwardSlot: SlotOrNone;
  backwardSlot: SlotOrNone;
  slotIndex: number[];
  slotGen: number[];
  slotReady: boolean[];
  earlyMuteTimerIds: (number | null)[];

  // ══ DOM 引用 ═════════════════════════════════════════════════
  overlay: HTMLElement | null;
  iframe: HTMLIFrameElement | null;
  titleEl: HTMLElement | null;
  counterEl: HTMLElement | null;
  hintsEl: HTMLElement | null;
  loadingEl: HTMLElement | null;
  toggleBtn: HTMLButtonElement | null;
  hiddenElements: HiddenElementRecord[];

  // ══ 导航注册表（解决循环依赖）══════════════════════════════
  navigation: NavigationRegistry;

  // ══ state.ts — 辅助函数 ══════════════════════════════════════
  getActiveIframe(): HTMLIFrameElement | null;
  isForwardReady(): boolean;
  isBackwardReady(): boolean;
  findFreeSlot(): number;

  // ══ extract.ts — 视频提取管道 ════════════════════════════════
  extractVideoCards(): VideoItem[];
  refillVideos(): number;
  clickRefreshButton(): Promise<number>;
  ensureVideosAvailable(): Promise<number>;
  inferTitle(link: Element, bvid: string): string;
  truncateTitle(text: string): string;

  // ══ player.ts — 播放器管理 ═══════════════════════════════════
  loadVideo(index: number): void;
  immediatelyMuteIframe(iframeEl: HTMLIFrameElement): void;
  preloadIntoSlot(slot: number, videoIndex: number): void;
  handlePreloadLoaded(slot: number): void;
  onIframeLoad(slot: number): void;
  onIframeError(slot: number): void;
  finishLoad(): void;
  injectIframeHideStyles(doc: Document): void;
  onVideoEndedInIframe(): void;
  attachVideoEndedListener(doc: Document, slot: number): void;
  setupPlayerInIframe(gen: number): void;
  ensurePreloads(): void;
  swapForward(): void;
  swapBackward(): void;
  getCurrentSpeed(): number;
  setPlaybackSpeed(rate: number): void;
  adjustSpeed(delta: number): number;

  // ══ ui.ts — UI 组件 ══════════════════════════════════════════
  createOverlay(): void;
  updateUI(index: number): void;
  showMessage(text: string, showRetry?: boolean, retryCallback?: () => void): void;
  showEndMessage(text?: string): void;
  removeEndMessage(): void;
  hideHints(): void;
  showProgressIndicator(currentTime: number, duration: number): void;
  showSpeedIndicator(speed: number): void;
  showTitleBriefly(): void;

  // ══ input.ts — 事件处理 ══════════════════════════════════════
  toggleFullscreen(): void;
  onKeyDown(e: KeyboardEvent): void;
  onMessage(e: MessageEvent): void;
  onBikbokKey(e: MessageEvent): void;
}

// ── 全局 Window 声明 ────────────────────────────────────────────

declare global {
  interface Window {
    __bikbok: BikbokAPI;
  }
}

export {};
