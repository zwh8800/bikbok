(function () {
  'use strict';

  const DEBOUNCE_MS = 300;
  const LOADING_TIMEOUT_MS = 15000;
  const AUTO_ADVANCE_FALLBACK_MS = 300000;
  const PLAYER_ORIGIN = 'https://player.bilibili.com';
  const HOME_PAGE_PATHS = new Set(['/', '/index.html']);

  if (!HOME_PAGE_PATHS.has(window.location.pathname)) {
    return;
  }

  /**
   * Extract video recommendations from the B站 homepage DOM.
   * Queries all anchor tags linking to /video/BV..., deduplicates by BV ID,
   * and attempts to extract a readable title from each card.
   * @returns {{bvid: string, title: string}[]}
   */
  function extractVideoCards() {
    const links = document.querySelectorAll('a[href*="/video/BV"]');
    if (!links || links.length === 0) return [];

    const bvPattern = /\/video\/(BV[a-zA-Z0-9]+)/;
    const seen = new Set();
    /** @type {{bvid: string, title: string}[]} */
    const videos = [];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;

      const match = href.match(bvPattern);
      if (!match) continue;

      const bvid = match[1];
      if (seen.has(bvid)) continue;
      seen.add(bvid);

      videos.push({ bvid, title: inferTitle(link, bvid) });
    }

    return videos;
  }

  /**
   * Infer a human-readable title from an anchor element.
   * Fallback chain: img[alt] → title attribute → textContent → sibling heading
   * inside a parent card → parent text → BV ID.
   * @param {HTMLAnchorElement} link
   * @param {string} bvid
   * @returns {string}
   */
  function inferTitle(link, bvid) {
    var img = link.querySelector('img[alt]');
    if (img) {
      var alt = (img.getAttribute('alt') || '').trim();
      if (alt.length > 1) return truncateTitle(alt);
    }

    var attrTitle = (link.getAttribute('title') || '').trim();
    if (attrTitle.length > 1) return truncateTitle(attrTitle);

    var directText = (link.textContent || '').trim();
    if (directText.length > 1 && directText.length < 200) return directText;

    const card = link.closest(
      '.bili-video-card, .video-card, .feed-card, [class*="card"], [class*="Card"]'
    );
    if (card) {
      const headings = card.querySelectorAll(
        'h3, h4, [class*="title"], [class*="tit"], [class*="headline"], ' +
        '[class*="name"], p, span[title]'
      );
      for (const h of headings) {
        const t = (h.textContent || '').trim();
        if (t.length > 1 && t.length < 200 && t !== directText) return t;
      }
    }

    const parent = link.parentElement;
    if (parent) {
      const parentText = (parent.textContent || '').trim();
      const linkOwn = (link.textContent || '').trim();
      if (parentText !== linkOwn && parentText.length > 1 && parentText.length < 200) {
        return parentText;
      }
    }

    return bvid;
  }

  function truncateTitle(text) {
    return text.length > 120 ? text.slice(0, 117) + '...' : text;
  }

  /** @type {Array<{el: HTMLElement, display: string}>} */
  var hiddenElements = [];

  function hidePage() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    var selectors = [
      '.bili-video-card',
      '.video-card',
      '.feed-card',
      '.recommended-swipe',
      '.bili-grid',
      '.bili-layout',
      '#i_cecream',
      '.bpx-player-video-wrap',
      '.home-container',
      'main',
      '.bili-feed4',
      '.bili-dyn-item',
      '.bili-album',
      '.bili-header',
    ];

    for (var si = 0; si < selectors.length; si++) {
      var nodes = document.querySelectorAll(selectors[si]);
      for (var ni = 0; ni < nodes.length; ni++) {
        var node = nodes[ni];
        if (node instanceof HTMLElement && node.style.display !== 'none') {
          hiddenElements.push({ el: node, display: node.style.display });
          node.style.display = 'none';
        }
      }
    }
  }

  function showPage() {
    for (var i = 0; i < hiddenElements.length; i++) {
      hiddenElements[i].el.style.display = hiddenElements[i].display;
    }
    hiddenElements.length = 0;
  }

  const videos = extractVideoCards();

  let currentIndex = 0;
  let lastNavTime = 0;
  let hintsHidden = false;
  let isTransitioning = false;
  let autoAdvanceTimer = null;

  let overlay = null;
  let iframe = null;
  let titleEl = null;
  let counterEl = null;
  let hintsEl = null;
  let loadingEl = null;

  /**
   * Build the fullscreen overlay, iframe player, and all child UI elements.
   * Uses CSS classes for styling (content.css); only structural inline styles
   * are set here.
   */
  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'bikbok-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;';

    loadingEl = document.createElement('div');
    loadingEl.className = 'bikbok-loading';
    overlay.appendChild(loadingEl);

    iframe = document.createElement('iframe');
    iframe.className = 'bikbok-player';
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    iframe.style.position = 'absolute';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.addEventListener('load', onIframeLoad);
    iframe.addEventListener('error', onIframeError);
    overlay.appendChild(iframe);

    titleEl = document.createElement('div');
    titleEl.className = 'bikbok-title';
    overlay.appendChild(titleEl);

    counterEl = document.createElement('div');
    counterEl.className = 'bikbok-counter';
    overlay.appendChild(counterEl);

    hintsEl = document.createElement('div');
    hintsEl.className = 'bikbok-hints';
    hintsEl.textContent = '\u2191 \u2193 or \u2190 \u2192 to navigate';

    overlay.appendChild(hintsEl);

    document.body.appendChild(overlay);
  }

  /**
   * Load the video at the given index. Updates the iframe src, shows
   * a loading spinner, resets the auto-advance fallback timer, and
   * applies a safety timeout in case the iframe never fires onload.
   * @param {number} index
   */
  function loadVideo(index) {
    if (isTransitioning) return;
    isTransitioning = true;

    const video = videos[index];
    if (!video) {
      isTransitioning = false;
      return;
    }

    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }

    loadingEl.classList.remove('bikbok-loading-hidden');
    iframe.style.opacity = '0';

    iframe.src = `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(video.bvid)}&autoplay=1&page=1&danmaku=0&muted=0`;

    updateUI(index);

    setTimeout(function () {
      if (loadingEl && !loadingEl.classList.contains('bikbok-loading-hidden')) {
        onIframeLoad();
      }
    }, LOADING_TIMEOUT_MS);

    autoAdvanceTimer = setTimeout(function () {
      if (currentIndex < videos.length - 1) {
        currentIndex++;
        loadVideo(currentIndex);
      }
    }, AUTO_ADVANCE_FALLBACK_MS);

    isTransitioning = false;
  }

  function onIframeLoad() {
    if (loadingEl) loadingEl.classList.add('bikbok-loading-hidden');
    if (iframe) iframe.style.opacity = '1';
  }

  function onIframeError() {
    if (loadingEl) loadingEl.classList.add('bikbok-loading-hidden');
    if (iframe) iframe.style.opacity = '0';
    showMessage('Failed to load video', true);
  }

  function updateUI(index) {
    const video = videos[index];
    if (!video) return;

    if (titleEl) titleEl.textContent = video.title;

    if (counterEl) {
      if (videos.length > 1) {
        counterEl.textContent = `${index + 1} / ${videos.length}`;
        counterEl.style.display = '';
      } else {
        counterEl.style.display = 'none';
      }
    }
  }

  function showMessage(text, showRetry) {
    if (!overlay) return;

    const prev = overlay.querySelector('.bikbok-message');
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
        loadVideo(currentIndex);
      });
      msg.appendChild(btn);
    }

    overlay.appendChild(msg);
  }

  function nextVideo() {
    if (currentIndex >= videos.length - 1) {
      showEndMessage();
      return;
    }
    currentIndex++;
    loadVideo(currentIndex);
    hideHints();
  }

  function prevVideo() {
    if (currentIndex <= 0) return;
    currentIndex--;
    loadVideo(currentIndex);
    hideHints();
  }

  function showEndMessage() {
    var msg = document.createElement('div');
    msg.className = 'bikbok-end';
    msg.textContent = 'End of recommendations \u2728';
    if (overlay) overlay.appendChild(msg);
  }

  function hideHints() {
    if (!hintsHidden && hintsEl) {
      hintsHidden = true;
      hintsEl.classList.add('bikbok-hints-hidden');
    }
  }

  /**
   * Global keydown handler. Arrow keys navigate between videos with
   * a 300 ms debounce. Escape tears down the overlay. Space is passed
   * through to the iframe for play/pause.
   * @param {KeyboardEvent} e
   */
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      return;
    }

    if (e.key === ' ') {
      return;
    }

    const now = Date.now();
    if (now - lastNavTime < DEBOUNCE_MS) {
      return;
    }

    let handled = false;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        lastNavTime = now;
        nextVideo();
        handled = true;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        lastNavTime = now;
        prevVideo();
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * Listen for video-ended events from the B站 embedded player.
   * The player communicates via postMessage with origin player.bilibili.com.
   * Accepted message shapes: {type: 'video_ended'}, {event: 'ended'}, etc.
   * @param {MessageEvent} e
   */
  function onMessage(e) {
    if (e.origin !== PLAYER_ORIGIN) {
      return;
    }

    const data = e.data;
    if (!data || typeof data !== 'object') return;

    const isEnded =
      data.type === 'video_ended' ||
      data.type === 'ended' ||
      data.event === 'video_ended' ||
      data.event === 'ended' ||
      data.info === 'ended';

    if (isEnded && currentIndex < videos.length - 1) {
      if (autoAdvanceTimer !== null) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
      }
      nextVideo();
    }
  }

  function cleanup() {
    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }

    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
      overlay = null;
    }

    showPage();

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('message', onMessage);

    if (toggleBtn) toggleBtn.style.display = '';
  }

  /**
   * Entry point. If recommendations are found, hides the B站 page,
   * builds the overlay, loads the first video, and binds keyboard /
   * postMessage listeners.
   */
  function init() {
    if (videos.length === 0) {
      overlay = document.createElement('div');
      overlay.id = 'bikbok-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;';
      var msg = document.createElement('div');
      msg.className = 'bikbok-message';
      msg.textContent = 'No recommended videos found \u{1F615}';
      overlay.appendChild(msg);
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKeyDown, true);
      return;
    }

    hidePage();
    createOverlay();
    loadVideo(0);

    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('message', onMessage);
  }

  var toggleBtn = document.createElement('button');
  toggleBtn.id = 'bikbok-toggle-btn';
  toggleBtn.textContent = 'TikTok Mode';
  toggleBtn.addEventListener('click', function () {
    toggleBtn.style.display = 'none';
    init();
  });
  document.body.appendChild(toggleBtn);
})();
