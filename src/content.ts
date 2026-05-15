import type { BikbokAPI } from './types';

const $: BikbokAPI = window.__bikbok;

if (!$.HOME_PAGE_PATHS.has(window.location.pathname)) {
  // Not on Bilibili homepage — don't initialize anything
}

if ($.HOME_PAGE_PATHS.has(window.location.pathname)) {
$.videos = $.extractVideoCards();
$.videos.forEach(function (v) { $.seenBvids.add(v.bvid); });

let debugTimerId: number | null = null;

function logIframeStates(): void {
  const overlay = document.getElementById('bikbok-overlay') as HTMLElement | null;
  if (!overlay) return;
  const now = new Date().toISOString().slice(11, 19);
  const lines: string[] = [];
  for (let i = 0; i < 3; i++) {
    const ifr = overlay.querySelectorAll<HTMLIFrameElement>('iframe')[i];
    if (!ifr) { lines.push('  slot' + i + ': no iframe'); continue; }
    const bvid = (ifr.src.match(/\/video\/(BV[a-zA-Z0-9]+)/) || [])[1] || 'empty';
    let vinfo = '-';
    try {
      const doc = ifr.contentDocument;
      if (doc) {
        const v = doc.querySelector<HTMLVideoElement>('video');
        if (v) {
          const ct = v.currentTime.toFixed(1);
          const dur = isNaN(v.duration) ? '?' : v.duration.toFixed(1);
          vinfo = ct + '/' + dur + (v.paused ? ' PAUSED' : '▶') + (v.muted ? ' MUTED' : '');
        } else { vinfo = 'no video el'; }
      } else { vinfo = 'no contentDoc'; }
    } catch (e) { vinfo = 'x-origin'; }
    lines.push('  slot' + i + ' [' + ifr.className.replace('bikbok-player ', '').replace('bikbok-player-', '') + '] ' + bvid + ' ' + vinfo);
  }
  lines.push('  currentIndex=' + $.currentIndex + ' activeSlot=' + $.activeSlot + ' fwd=' + $.forwardSlot + ' bwd=' + $.backwardSlot);
  console.debug('[bikbok ' + now + ']', '\n' + lines.join('\n'));
}

function hidePage(): void {
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  const selectors = [
    '.bili-video-card', '.video-card', '.feed-card', '.recommended-swipe',
    '.bili-grid', '.bili-layout', '#i_cecream', '.bpx-player-video-wrap',
    '.home-container', 'main', '.bili-feed4', '.bili-dyn-item',
    '.bili-album', '.bili-header',
  ];
  for (let si = 0; si < selectors.length; si++) {
    const nodes = document.querySelectorAll<HTMLElement>(selectors[si]);
    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];
      if (node instanceof HTMLElement && node.style.display !== 'none') {
        $.hiddenElements.push({ el: node, display: node.style.display });
        node.style.display = 'none';
      }
    }
  }
}

function showPage(): void {
  for (let i = 0; i < $.hiddenElements.length; i++) {
    $.hiddenElements[i].el.style.display = $.hiddenElements[i].display;
  }
  $.hiddenElements.length = 0;
}

function nextVideo(): void {
  if ($.currentIndex >= $.videos.length - 1) {
    if ($.refillPromise !== null) { $.showEndMessage('Loading more...'); return; }
    if ($.refreshAttempts >= $.MAX_REFRESH_ATTEMPTS) { $.showEndMessage(); return; }
    $.showEndMessage('Loading more...');
    $.refillPromise = $.ensureVideosAvailable();
    $.refillPromise.then(function () {
      $.refillPromise = null;
      $.removeEndMessage();
      $.updateUI($.currentIndex);
      if ($.currentIndex < $.videos.length - 1) { $.currentIndex++; $.loadVideo($.currentIndex); }
      else { $.showEndMessage(); }
    });
    return;
  }

  const remaining = $.videos.length - $.currentIndex - 1;
  if (remaining <= $.REFILL_THRESHOLD && $.refillPromise === null && $.refreshAttempts < $.MAX_REFRESH_ATTEMPTS) {
    $.refillPromise = $.ensureVideosAvailable();
    $.refillPromise.then(function () { $.refillPromise = null; $.updateUI($.currentIndex); $.removeEndMessage(); });
  }

  if ($.isForwardReady()) { $.swapForward(); return; }
  $.currentIndex++;
  $.loadVideo($.currentIndex);
  $.hideHints();
}

function prevVideo(): void {
  if ($.currentIndex <= 0) return;
  if ($.isBackwardReady()) { $.swapBackward(); return; }
  $.currentIndex--;
  $.loadVideo($.currentIndex);
  $.hideHints();
}

function cleanup(): void {
  if (debugTimerId !== null) { clearInterval(debugTimerId); debugTimerId = null; }
  if ($.setupTimerId !== null) { clearInterval($.setupTimerId!); $.setupTimerId = null; }
  if ($.loadingTimeoutId !== null) { clearTimeout($.loadingTimeoutId); $.loadingTimeoutId = null; }
  if ($.progressIndicatorTimer !== null) { clearTimeout($.progressIndicatorTimer); $.progressIndicatorTimer = null; }
  for (let t = 0; t < 3; t++) {
    if ($.earlyMuteTimerIds[t] !== null) { clearInterval($.earlyMuteTimerIds[t]!); $.earlyMuteTimerIds[t] = null; }
  }
  $.iframeLoadGen++;
  if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  if ($.overlay && $.overlay.parentNode) {
    for (let i = 0; i < $.iframes.length; i++) {
      if ($.iframes[i]) try { $.iframes[i]!.src = 'about:blank'; } catch (e) {}
    }
    const activeIfr = $.getActiveIframe();
    if (activeIfr && activeIfr.contentDocument) {
      const wideBtn = activeIfr.contentDocument.querySelector<HTMLElement>('.bpx-player-ctrl-web');
      if (wideBtn && wideBtn.classList.contains('bpx-state-entered')) wideBtn.click();
    }
    $.overlay.parentNode.removeChild($.overlay);
    $.overlay = null;
  }
  showPage();
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  document.removeEventListener('keydown', $.onKeyDown, true);
  window.removeEventListener('keydown', $.onKeyDown, true);
  window.removeEventListener('message', $.onMessage);
  window.removeEventListener('message', $.onBikbokKey);
  if ($.toggleBtn) $.toggleBtn.style.display = '';
  $.activeSlot = 0;
  $.forwardSlot = -1;
  $.backwardSlot = -1;
  $.slotIndex = [-1, -1, -1];
  $.slotGen = [0, 0, 0];
  $.slotReady = [false, false, false];
  $.earlyMuteTimerIds = [null, null, null];
  $.iframes = [null, null, null];
  $.iframe = null;
}

function init(): void {
  $.seenBvids.clear();
  $.videos.forEach(function (v) { $.seenBvids.add(v.bvid); });
  $.refillPromise = null;
  $.refreshAttempts = 0;
  $.loadingTimeoutId = null;
  $.setupTimerId = null;
  $.progressIndicatorTimer = null;
  $.iframeLoadGen = 0;
  $.earlyMuteTimerIds = [null, null, null];
  $.activeSlot = 0;
  $.forwardSlot = 1;
  $.backwardSlot = -1;
  $.slotIndex = [-1, -1, -1];
  $.slotGen = [0, 0, 0];
  $.slotReady = [false, false, false];
  $.iframes = [null, null, null];

  if ($.videos.length === 0) {
    $.overlay = document.createElement('div');
    $.overlay.id = 'bikbok-overlay';
    $.overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;';
    const msg = document.createElement('div');
    msg.className = 'bikbok-message';
    msg.textContent = 'No recommended videos found \u{1F615}';
    $.overlay.appendChild(msg);
    document.body.appendChild($.overlay);
    document.addEventListener('keydown', $.onKeyDown, true);
    $.iframe = null;
    return;
  }

  hidePage();
  $.createOverlay();

  for (let slot = 0; slot < 3; slot++) {
    if ($.iframes[slot]) {
      $.iframes[slot]!.addEventListener('load', (function (s: number) {
        return function () { $.onIframeLoad(s); };
      })(slot));
      $.iframes[slot]!.addEventListener('error', (function (s: number) {
        return function () { $.onIframeError(s); };
      })(slot));
    }
  }

  $.slotIndex[0] = 0;
  $.loadVideo(0);

  if ($.videos.length > 1) {
    setTimeout(function () { $.preloadIntoSlot(1, 1); }, 2000);
  }

  logIframeStates();
  debugTimerId = setInterval(logIframeStates, 3000);

  document.addEventListener('keydown', $.onKeyDown, true);
  window.addEventListener('keydown', $.onKeyDown, true);
  window.addEventListener('message', $.onMessage);
  window.addEventListener('message', $.onBikbokKey);

  setTimeout(function () { $.hideHints(); }, 8000);

  if ($.overlay && $.overlay.requestFullscreen) $.overlay.requestFullscreen().catch(function () {});
}

$.navigation.nextVideo = nextVideo;
$.navigation.prevVideo = prevVideo;
$.navigation.cleanup = cleanup;

window.addEventListener('keydown', function (e: KeyboardEvent) {
  if (e.key !== 'b' && e.key !== 'B') return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
  e.preventDefault();
  e.stopPropagation();
  if ($.overlay) { cleanup(); }
  else { $.toggleBtn!.style.display = 'none'; init(); }
}, true);

const toggleBtn = document.createElement('button');
toggleBtn.id = 'bikbok-toggle-btn';
toggleBtn.textContent = 'bikbok';
toggleBtn.addEventListener('click', function () {
  $.toggleBtn!.style.display = 'none';
  init();
});
document.body.appendChild(toggleBtn);
$.toggleBtn = toggleBtn;
}
