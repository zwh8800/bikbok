/**
 * bikbok — B 站 TikTok 模式 Chrome 扩展（Content Script）
 * 
 * 将 B 站首页改造为类似抖音的全屏短视频播放器。
 * 通过隐藏原始页面内容并创建全屏覆盖层，用 iframe 嵌入 B 站播放器，
 * 支持键盘上下切换、视频播完自动跳转下一集。
 * 
 * 整体流程：
 * 1. 从首页 DOM 中提取推荐视频列表（BV 编号 + 标题）
 * 2. 用户点击右下角「TikTok Mode」按钮进入全屏模式
 * 3. Arrow Up/Down/Left/Right 切换视频，Escape 退出
 * 4. 监听播放器 postMessage 实现视频播完自动前进
 * 5. 视频池耗尽时自动从 DOM 重新提取，若仍无新视频则点击「换一换」按钮刷新推荐
 */
(function () {
  'use strict';

  // ── 全局配置 ──────────────────────────────────────────────
  const DEBOUNCE_MS = 300;               // 键盘导航防抖间隔（毫秒）
  const LOADING_TIMEOUT_MS = 15000;      // 播放器加载超时（毫秒），超过则强制隐藏加载动画
  const AUTO_ADVANCE_FALLBACK_MS = 300000; // 自动前进回退计时（毫秒），若未收到 postMessage 则 5 分钟后自动切
  const PLAYER_ORIGIN = 'https://www.bilibili.com'; // 播放器 postMessage 来源，必须精确匹配
  const HOME_PAGE_PATHS = new Set(['/', '/index.html']); // 仅在首页生效的路径集合
  const WEBFULLSCREEN_POLL_INTERVAL = 200;    // 轮询检测播放器是否就绪的间隔（毫秒）
  const WEBFULLSCREEN_TIMEOUT_MS = 10000;     // 等待播放器就绪最大时长（毫秒），超时则降级
  // iframe 内需隐藏的 B 站页面无关元素
  const IFRAME_HIDE_SELECTORS = [
    '.bili-header',
    '.recommend-list',
    '.video-toolbar',
    '#comment',
    '.bili-footer',
    '.left-container .video-pod',
    '.video-page-special',
  ];

  // 仅在 B 站首页执行，其他页面直接退出
  if (!HOME_PAGE_PATHS.has(window.location.pathname)) {
    return;
  }

  /**
   * 从 B 站首页 DOM 中提取推荐视频列表
   * 
   * 遍历页面上所有包含 "/video/BV" 的链接元素，通过正则提取 BV 编号，
   * 使用 Set 去重（同一视频可能被多个卡片引荐），
   * 同时调用 inferTitle() 从链接周围的 DOM 结构中推断视频标题。
   * 
   * @returns {Array<{bvid: string, title: string}>} 视频列表，每个元素包含 bvid（BV 编号）和 title（视频标题）
   */
  function extractVideoCards() {
    // 选中页面上所有包含 "/video/BV" 的 <a> 标签
    const links = document.querySelectorAll('.feed-card a[href*="/video/BV"]');
    if (!links || links.length === 0) return [];

    const bvPattern = /\/video\/(BV[a-zA-Z0-9]+)/; // BV 编号正则
    const seen = new Set(); // 已处理的 BV 编号集合，用于去重
    /** @type {Array<{bvid: string, title: string}>} */
    const videos = [];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;

      const match = href.match(bvPattern);
      if (!match) continue;

      const bvid = match[1]; // 提取 BV 编号
      if (seen.has(bvid)) continue; // 跳过重复视频
      seen.add(bvid);

      videos.push({ bvid, title: inferTitle(link, bvid) });
    }

    return videos;
  }

  /**
   * 从 DOM 中重新提取视频并追加到播放池
   * 
   * 调用 extractVideoCards() 获取当前 DOM 中所有视频，
   * 通过 seenBvids 集合过滤掉已加入 pool 的视频，
   * 将新视频追加到 videos 数组并记录其 BV 编号。
   * 
   * @returns {number} 本次新添加的视频数量
   */
  function refillVideos() {
    var fresh = extractVideoCards();
    var added = 0;
    for (var i = 0; i < fresh.length; i++) {
      if (!seenBvids.has(fresh[i].bvid)) {
        seenBvids.add(fresh[i].bvid);
        videos.push(fresh[i]);
        added++;
      }
    }
    return added;
  }

  /**
   * 点击页面「换一换」按钮并等待 DOM 更新后提取新视频
   * 
   * 查找 B 站首页推荐区的「换一换」按钮（selector: button.roll-btn），
   * 点击后每 500ms 轮询 refillVideos()，一旦有新视频加入则立即返回。
   * 最多等待 15 秒，超时返回 0。
   * 按钮在 display:none 状态下点击依然有效（DOM 事件不受 CSS 影响）。
   * 
   * @returns {Promise<number>} 解析为本次新添加的视频数量
   */
  function clickRefreshButton() {
    return new Promise(function (resolve) {
      var btn = document.querySelector('button.roll-btn');
      if (!btn) {
        resolve(0);
        return;
      }
      btn.click();
      var start = Date.now();
      var timer = setInterval(function () {
        var count = refillVideos();
        if (count > 0) {
          clearInterval(timer);
          resolve(count);
          return;
        }
        if (Date.now() - start >= 15000) {
          clearInterval(timer);
          resolve(0);
        }
      }, 500);
    });
  }

  /**
   * 确保视频池中有足够的视频可供播放
   * 
   * 编排 refill → refresh 重试循环：
   * 1. 首先尝试从当前 DOM 提取新视频（refillVideos）
   * 2. 若无新视频则点击「换一换」按钮刷新推荐（clickRefreshButton）
   * 3. 最多重试 MAX_REFRESH_ATTEMPTS 次
   * 4. 并发调用去重：若已有 refill 正在进行中，返回同一个 Promise
   * 
   * @returns {Promise<number>} 解析为本次总共新添加的视频数量
   */
  function ensureVideosAvailable() {
    if (refillPromise !== null) {
      return refillPromise;
    }

    refillPromise = (function () {
      var totalAdded = 0;
      var attempts = 0;

      function tryRefill() {
        if (attempts >= MAX_REFRESH_ATTEMPTS) {
          return Promise.resolve(totalAdded);
        }
        attempts++;
        refreshAttempts++;

        var fromDOM = refillVideos();
        if (fromDOM > 0) {
          totalAdded += fromDOM;
          return Promise.resolve(totalAdded);
        }

        return clickRefreshButton().then(function (fromRefresh) {
          totalAdded += fromRefresh;
          if (fromRefresh > 0) {
            return totalAdded;
          }
          return tryRefill();
        });
      }

      return tryRefill().then(function (result) {
        refillPromise = null;
        return result;
      });
    })();

    return refillPromise;
  }

  /**
   * 从链接元素推断可读的视频标题
   * 
   * 采用 5 级回退链，按优先级依次尝试：
   * 1. <img alt="..."> 属性 — B 站标题主要存储在这里
   * 2. <a title="..."> 属性
   * 3. <a> 标签自身的 textContent
   * 4. 父级卡片内查找标题元素（h3/h4/含 title/name 的 class）
   * 5. 父元素的 textContent（排除链接自身文本）
   * 
   * 若以上全部失败，返回 BV 编号作为兜底标题。
   * 
   * @param {HTMLAnchorElement} link — 视频链接元素
   * @param {string} bvid — BV 编号（兜底用）
   * @returns {string} 推断出的视频标题
   */
  function inferTitle(link, bvid) {
    // 第 1 级：从 <img alt> 获取标题
    var img = link.querySelector('img[alt]');
    if (img) {
      var alt = (img.getAttribute('alt') || '').trim();
      if (alt.length > 1) return truncateTitle(alt);
    }

    // 第 2 级：从 <a title> 获取标题
    var attrTitle = (link.getAttribute('title') || '').trim();
    if (attrTitle.length > 1) return truncateTitle(attrTitle);

    // 第 3 级：链接自身文本内容
    var directText = (link.textContent || '').trim();
    if (directText.length > 1 && directText.length < 200) return directText;

    // 第 4 级：从父级卡片中查找标题元素
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

    // 第 5 级：父元素文本内容
    const parent = link.parentElement;
    if (parent) {
      const parentText = (parent.textContent || '').trim();
      const linkOwn = (link.textContent || '').trim();
      if (parentText !== linkOwn && parentText.length > 1 && parentText.length < 200) {
        return parentText;
      }
    }

    // 兜底：返回 BV 编号
    return bvid;
  }

  /**
   * 截断过长标题
   * 
   * 限制标题最大长度为 120 字符，超出部分用 "..." 替换末尾 3 个字符。
   * 此处不使用 CSS text-overflow，因为标题需要作为文字内容显示。
   * 
   * @param {string} text — 原始标题文本
   * @returns {string} 截断后的标题
   */
  function truncateTitle(text) {
    return text.length > 120 ? text.slice(0, 117) + '...' : text;
  }

  /**
   * 隐藏/恢复页面时保存的元素信息列表
   * 每个元素记录其原始 display 值，用于恢复时正确还原（而非简单设回 'block'）。
   * 使用 var 声明以兼容影子作用域。
   * @type {Array<{el: HTMLElement, display: string}>}
   */
  var hiddenElements = [];

  /**
   * 隐藏 B 站原始页面内容
   * 
   * 遍历预设选择器列表，将所有匹配的可见元素隐藏（display: none），
   * 同时保存各元素原始的 display 值到 hiddenElements 数组，
   * 以便 showPage() 恢复时正确还原。
   * 同时也设置 html/body 的 overflow 防止底层页面滚动。
   */
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
        // 只隐藏可见的 HTMLElement，跳过已隐藏的元素
        if (node instanceof HTMLElement && node.style.display !== 'none') {
          hiddenElements.push({ el: node, display: node.style.display });
          node.style.display = 'none';
        }
      }
    }
  }

  /**
   * 恢复 B 站原始页面内容
   * 
   * 遍历 hiddenElements 数组，将每个元素恢复其原始 display 值，
   * 然后清空数组。只有隐藏过的元素才会被恢复。
   */
  function showPage() {
    for (var i = 0; i < hiddenElements.length; i++) {
      hiddenElements[i].el.style.display = hiddenElements[i].display;
    }
    hiddenElements.length = 0;
  }

  // ── 全局状态 ──────────────────────────────────────────────
  let videos = extractVideoCards(); // 从 DOM 提取的视频列表（动态 pool，元素为 {bvid, title}）
  const seenBvids = new Set();     // 已加入 pool 的 BV 编号集合，跨提取去重

  let currentIndex = 0;     // 当前播放视频的索引（0-based）
  let lastNavTime = 0;      // 上次导航时间戳，用于键盘防抖
  let hintsHidden = false;  // 键盘提示是否已被隐藏
  let isTransitioning = false; // 是否正在切换视频（防止并发加载）
  let autoAdvanceTimer = null;  // 自动前进回退计时器 ID

  let refillPromise = null;     // 正在进行的异步 refill Promise（并发去重）
  let refreshAttempts = 0;      // 「换一换」按钮已点击次数（重试上限内）
  const REFILL_THRESHOLD = 3;   // 剩余 ≤3 个视频时触发 refill
  const MAX_REFRESH_ATTEMPTS = 3; // 「换一换」最多重试次数

  let iframeLoadGen = 0;          // Generation counter to cancel stale async setups
  let loadingTimeoutId = null;    // Track loading timeout for cleanup
  let setupTimerId = null;        // Track polling interval for cleanup

  // ── DOM 引用（进入全屏模式后初始化） ──────────────────────
  let overlay = null;    // 全屏覆盖层容器（#bikbok-overlay）
  let iframe = null;     // B 站播放器 iframe
  let titleEl = null;    // 视频标题显示元素
  let counterEl = null;  // 视频计数显示元素（"N / M"）
  let hintsEl = null;    // 键盘提示文字元素
  let loadingEl = null;  // 加载动画元素

  /**
   * 创建全屏覆盖层及所有子 UI 元素
   * 
   * 结构层级（从下到上）：
   *   #bikbok-overlay (position:fixed, z-index:999999)
   *   ├── .bikbok-loading (加载旋转动画, z-index:3)
   *   ├── iframe (B 站播放器嵌入)
   *   ├── .bikbok-title (底部视频标题)
   *   ├── .bikbok-counter (右上角计数)
   *   └── .bikbok-hints (键盘操作提示)
   * 
   * 样式由 content.css 定义，此处仅设置 iframe 的结构内联样式。
   * z-index: 999999 确保覆盖层高于 B 站所有元素。
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
   * 加载指定索引的视频
   * 
   * 核心流程：
   * 1. 并发保护：若正在切换视频则忽略（isTransitioning 防抖）
   * 2. 清除上一次的自动前进计时器
   * 3. 显示加载动画，隐藏 iframe
   * 4. 设置 iframe.src 为 B 站播放器 URL（带 autoplay=1&danmaku=0 参数）
   * 5. 更新 UI（标题 + 计数）
   * 6. 启动加载超时保护（LOADING_TIMEOUT_MS 后强制隐藏加载动画）
   * 7. 启动自动前进回退计时器（AUTO_ADVANCE_FALLBACK_MS 后自动切到下一集）
   * 
   * @param {number} index — 要加载的视频在 videos 数组中的索引（0-based）
   */
  function loadVideo(index) {
    if (isTransitioning) return;
    isTransitioning = true;
    iframeLoadGen++;
    var loadGen = iframeLoadGen;

    const video = videos[index];
    if (!video) {
      isTransitioning = false;
      return;
    }

    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
    if (loadingTimeoutId !== null) {
      clearTimeout(loadingTimeoutId);
      loadingTimeoutId = null;
    }
    if (setupTimerId !== null) {
      clearInterval(setupTimerId);
      setupTimerId = null;
    }

    loadingEl.classList.remove('bikbok-loading-hidden');
    iframe.style.opacity = '0';

    // 通过修改 src 加载视频
    iframe.src = 'https://www.bilibili.com/video/' + encodeURIComponent(video.bvid) + '/';

    // 更新标题和计数显示
    updateUI(index);

    // 加载超时保护：超过 LOADING_TIMEOUT_MS 仍无响应则强制隐藏加载动画
    loadingTimeoutId = setTimeout(function () {
      loadingTimeoutId = null;
      if (loadGen === iframeLoadGen && loadingEl && !loadingEl.classList.contains('bikbok-loading-hidden')) {
        finishLoad();
      }
    }, LOADING_TIMEOUT_MS);

    // 自动前进回退：超过 AUTO_ADVANCE_FALLBACK_MS 则自动切到下一集
    autoAdvanceTimer = setTimeout(function () {
      if (currentIndex < videos.length - 1) {
        currentIndex++;
        loadVideo(currentIndex);
      }
    }, AUTO_ADVANCE_FALLBACK_MS);

    isTransitioning = false;
  }

  /**
   * iframe 加载成功回调
   * 委托 setupPlayerInIframe 处理播放器初始化（全屏、隐藏无关元素、监听结束事件）。
   * 使用 generation counter 防止过时的回调污染当前视频。
   */
  function onIframeLoad() {
    var gen = iframeLoadGen;
    setupPlayerInIframe(gen);
  }

  /**
   * 完成加载：隐藏 loading 动画并显示 iframe
   */
  function finishLoad() {
    if (loadingEl) loadingEl.classList.add('bikbok-loading-hidden');
    if (iframe) iframe.style.opacity = '1';
  }

  /**
   * 向 iframe 内部的 document 注入样式，隐藏 B 站页面无关元素（头部、评论区、推荐列表等）
   * 同时设置背景色为黑色、禁止溢出滚动。
   * @param {Document} doc — iframe.contentDocument
   */
  function injectIframeHideStyles(doc) {
    if (!doc || !doc.body) return;
    doc.body.style.background = '#000';
    doc.documentElement.style.overflow = 'hidden';
    for (var i = 0; i < IFRAME_HIDE_SELECTORS.length; i++) {
      var els = doc.querySelectorAll(IFRAME_HIDE_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) {
        els[j].style.setProperty('display', 'none', 'important');
      }
    }
  }

  /**
   * 视频播放结束处理器（供 video.ended 事件使用）
   * 清除自动前进计时器并切换到下一个视频。
   */
  function onVideoEndedInIframe() {
    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
    if (currentIndex < videos.length - 1) {
      nextVideo();
    }
  }

  /**
   * 向 iframe 内部 <video> 元素绑定 ended 事件监听
   * 若 video 元素未立即就绪，则轮询等待最多 5 秒。
   * 使用 gen 参数防止过时的监听器响应。
   * @param {Document} doc — iframe.contentDocument
   * @param {number} gen — 当前加载代数
   */
  function attachVideoEndedListener(doc, gen) {
    if (!doc) return;
    var video = doc.querySelector('video');
    if (video) {
      video.addEventListener('ended', function videoEndHandler() {
        if (gen === iframeLoadGen) {
          onVideoEndedInIframe();
        }
      }, { once: false });
      return;
    }
    // 轮询等待 video 元素出现
    var attempts = 0;
    var maxAttempts = Math.floor(5000 / 500);
    var pollTimer = setInterval(function () {
      if (gen !== iframeLoadGen) {
        clearInterval(pollTimer);
        return;
      }
      attempts++;
      var v = doc.querySelector('video');
      if (v) {
        v.addEventListener('ended', function videoEndHandler() {
          if (gen === iframeLoadGen) {
            onVideoEndedInIframe();
          }
        }, { once: false });
        clearInterval(pollTimer);
      } else if (attempts >= maxAttempts) {
        clearInterval(pollTimer);
      }
    }, 500);
  }

  /**
   * 在 iframe 内部设置播放器：触发网页全屏、隐藏无关元素、绑定视频结束事件
   * 轮询检测 .bpx-player-ctrl-web 按钮是否就绪，就绪后点击触发网页全屏。
   * 超时后降级：仍注入样式并绑定结束监听，但不触发全屏。
   * 使用 gen 参数防止过时回调污染当前视频。
   * @param {number} gen — 当前加载代数
   */
  function setupPlayerInIframe(gen) {
    if (!iframe || !iframe.contentDocument) {
      injectIframeHideStyles(iframe && iframe.contentDocument);
      finishLoad();
      return;
    }

    var doc = iframe.contentDocument;
    // 在 iframe 内部捕获键盘事件并通过 postMessage 转发到父窗口
    // 解决同一源 iframe 抢走键盘焦点导致父文档 keydown 监听失效的问题
    doc.addEventListener('keydown', function (e) {
      var navKeys = ['Escape', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
      if (navKeys.indexOf(e.key) !== -1) {
        window.postMessage({ type: 'bikbok-key', key: e.key }, '*');
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    var pollCount = 0;
    var maxPolls = Math.floor(WEBFULLSCREEN_TIMEOUT_MS / WEBFULLSCREEN_POLL_INTERVAL);

    setupTimerId = setInterval(function () {
      if (gen !== iframeLoadGen) {
        clearInterval(setupTimerId);
        setupTimerId = null;
        return;
      }

      pollCount++;
      var currentDoc = iframe && iframe.contentDocument;
      if (!currentDoc) {
        clearInterval(setupTimerId);
        setupTimerId = null;
        return;
      }

      var wideBtn = currentDoc.querySelector('.bpx-player-ctrl-web');

      if (wideBtn) {
        clearInterval(setupTimerId);
        setupTimerId = null;

        if (!wideBtn.classList.contains('bpx-state-entered')) {
          wideBtn.click();
        }

        injectIframeHideStyles(currentDoc);
        attachVideoEndedListener(currentDoc, gen);
        finishLoad();
      } else if (pollCount >= maxPolls) {
        clearInterval(setupTimerId);
        setupTimerId = null;
        injectIframeHideStyles(currentDoc);
        attachVideoEndedListener(currentDoc, gen);
        finishLoad();
      }
    }, WEBFULLSCREEN_POLL_INTERVAL);
  }

  /**
   * iframe 加载失败回调
   * 隐藏加载动画，保持播放器不可见，显示错误消息和重试按钮。
   */
  function onIframeError() {
    if (loadingEl) loadingEl.classList.add('bikbok-loading-hidden');
    if (iframe) iframe.style.opacity = '0';
    showMessage('Failed to load video', true);
  }

  /**
   * 更新视频标题和计数显示
   * 
   * 计数格式 "N / M"（1-based），仅当多于 1 个视频时显示。
   * 
   * @param {number} index — 当前视频索引
   */
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

  /**
   * 在覆盖层上显示消息提示
   * 
   * 先移除已有的 .bikbok-message 元素，再创建新消息。
   * 可选显示重试按钮，点击后重新加载当前视频。
   * 
   * @param {string} text — 消息文本
   * @param {boolean} showRetry — 是否显示重试按钮
   */
  function showMessage(text, showRetry) {
    if (!overlay) return;

    // 移除已有的消息元素，避免重复显示
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

  /**
   * 切换到下一个视频
   * 
   * 三级处理逻辑：
   * 1. 已到达池末尾且 refill 进行中 → 显示 "Loading more..."
   * 2. 已到达池末尾且重试次数已耗尽 → 显示 "End of recommendations"
   * 3. 已到达池末尾 → 触发异步 refill，显示 "Loading more..."
   * 4. 接近池末尾（剩余 ≤ REFILL_THRESHOLD）→ 后台异步 refill，正常前进
   * 5. 正常 → 前进到下一个视频
   */
  function nextVideo() {
    if (currentIndex >= videos.length - 1) {
      if (refillPromise !== null) {
        showEndMessage('Loading more...');
        return;
      }
      if (refreshAttempts >= MAX_REFRESH_ATTEMPTS) {
        showEndMessage();
        return;
      }
      showEndMessage('Loading more...');
      refillPromise = ensureVideosAvailable();
      refillPromise.then(function (added) {
        refillPromise = null;
        removeEndMessage();
        updateUI(currentIndex);
        if (currentIndex < videos.length - 1) {
          currentIndex++;
          loadVideo(currentIndex);
        } else {
          showEndMessage();
        }
      });
      return;
    }

    var remaining = videos.length - currentIndex - 1;
    if (remaining <= REFILL_THRESHOLD
        && refillPromise === null
        && refreshAttempts < MAX_REFRESH_ATTEMPTS) {
      refillPromise = ensureVideosAvailable();
      refillPromise.then(function (added) {
        refillPromise = null;
        updateUI(currentIndex);
        removeEndMessage();
      });
    }

    currentIndex++;
    loadVideo(currentIndex);
    hideHints();
  }

  /**
   * 切换到上一个视频
   * 若已是第一个视频，不做任何操作。
   */
  function prevVideo() {
    if (currentIndex <= 0) return;
    currentIndex--;
    loadVideo(currentIndex);
    hideHints();
  }

  /**
   * 显示推荐列表结束提示
   * 
   * @param {string} [text] — 自定义提示文本，默认为 "End of recommendations ✨"
   */
  function showEndMessage(text) {
    if (!overlay) return;
    var existing = overlay.querySelector('.bikbok-end');
    if (existing) existing.remove();
    var msg = document.createElement('div');
    msg.className = 'bikbok-end';
    msg.textContent = typeof text === 'string' ? text : 'End of recommendations \u2728';
    overlay.appendChild(msg);
  }

  /**
   * 移除结束提示（refill 完成后调用）
   */
  function removeEndMessage() {
    if (!overlay) return;
    var el = overlay.querySelector('.bikbok-end');
    if (el) el.remove();
  }

  /**
   * 隐藏键盘操作提示
   * 在用户首次进行键盘导航后调用，之后不再显示。
   */
  function hideHints() {
    if (!hintsHidden && hintsEl) {
      hintsHidden = true;
      hintsEl.classList.add('bikbok-hints-hidden');
    }
  }

  /**
   * 全局键盘事件处理（capture 阶段捕获）
   * 
   * 按键映射：
   *   Escape      — 退出全屏模式，恢复 B 站原始页面
   *   Space       — 不拦截，透传给 iframe 中的播放器（播放/暂停）
   *   Arrow Down  — 下一个视频
   *   Arrow Right — 下一个视频
   *   Arrow Up    — 上一个视频
   *   Arrow Left  — 上一个视频
   * 
   * 防抖：300ms 内重复按键仅触发一次导航。
   * 空格键特殊处理：必须 return 而非 preventDefault，否则播放器无法切换播放状态。
   * 
   * @param {KeyboardEvent} e
   */
  function onKeyDown(e) {
    // Escape：退出全屏模式
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      return;
    }

    // 空格：透传给播放器
    if (e.key === ' ') {
      return;
    }

    // 防抖检查
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
   * 监听 B 站播放器 postMessage 事件
   * 
   * B 站嵌入播放器在视频播放结束时通过 postMessage 发送事件。
   * 来源必须精确匹配 player.bilibili.com（=== 而非 startsWith）。
   * 
   * 支持的消息格式（任一匹配即视为播放结束）：
   *   {type: 'video_ended'}    — 播放器 type 字段
   *   {type: 'ended'}          — 备用 type
   *   {event: 'video_ended'}   — 播放器 event 字段
   *   {event: 'ended'}         — 备用 event
   *   {info: 'ended'}          — 备用 info 字段
   * 
   * 收到结束事件后立即清除自动前进回退计时器，并切换到下一个视频。
   * 
   * @param {MessageEvent} e
   */
  function onMessage(e) {
    // 严格校验来源
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

  /**
   * 处理来自 iframe 内部转发的键盘事件
   * iframe 内部捕获键事件后通过 postMessage 转发到父窗口，
   * 解决同一源 iframe 抢走键盘焦点导致父文档无法捕获 keydown 的问题。
   * @param {MessageEvent} e
   */
  function onBikbokKey(e) {
    if (e.data && e.data.type === 'bikbok-key') {
      onKeyDown({
        key: e.data.key,
        preventDefault: function () {},
        stopPropagation: function () {}
      });
    }
  }

  /**
   * 清理资源，退出全屏模式
   * 
   * 按顺序执行：
   * 1. 清除自动前进计时器
   * 2. 从 DOM 中移除全屏覆盖层
   * 3. 恢复 B 站原始页面内容（还原 display 值）
   * 4. 恢复 html/body 的 overflow
   * 5. 移除键盘和 postMessage 事件监听
   * 6. 恢复模式切换按钮的显示
   */
  function cleanup() {
    if (setupTimerId !== null) {
      clearInterval(setupTimerId);
      setupTimerId = null;
    }
    if (loadingTimeoutId !== null) {
      clearTimeout(loadingTimeoutId);
      loadingTimeoutId = null;
    }
    iframeLoadGen++; // Abort any pending setups

    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }

    if (overlay && overlay.parentNode) {
      // Exit web fullscreen if active
      if (iframe && iframe.contentDocument) {
        var wideBtn = iframe.contentDocument.querySelector('.bpx-player-ctrl-web');
        if (wideBtn && wideBtn.classList.contains('bpx-state-entered')) {
          wideBtn.click();
        }
      }
      overlay.parentNode.removeChild(overlay);
      overlay = null;
    }

    showPage();

    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';

    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('message', onBikbokKey);

    if (toggleBtn) toggleBtn.style.display = '';
  }

  /**
   * 入口函数：进入 TikTok 全屏模式
   * 
   * 两种处理路径：
   * 1. 无推荐视频（videos.length === 0）：显示"未找到推荐视频"的消息覆盖层，
   *    用户仍可通过 Escape 键关闭
   * 2. 有推荐视频：隐藏 B 站页面 → 创建全屏覆盖层 → 加载第一个视频 →
   *    绑定键盘导航和 postMessage 监听
   */
  function init() {
    // 初始化/重置 refill 相关状态
    seenBvids.clear();
    videos.forEach(function (v) { seenBvids.add(v.bvid); });
    refillPromise = null;
    refreshAttempts = 0;
    loadingTimeoutId = null;
    setupTimerId = null;
    iframeLoadGen = 0;

    if (videos.length === 0) {
      // 空状态：创建覆盖层显示未找到视频的消息
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
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('message', onMessage);
    window.addEventListener('message', onBikbokKey);
  }

  // ── 模式切换按钮 ───────────────────────────────────────────
  // 固定在页面右下角的粉色按钮，点击后进入 TikTok 全屏模式
  // 按钮通过 display 控制显隐，全程保持在 DOM 中（不 remove/重新创建）
  var toggleBtn = document.createElement('button');
  toggleBtn.id = 'bikbok-toggle-btn';
  toggleBtn.textContent = 'TikTok Mode';
  toggleBtn.addEventListener('click', function () {
    toggleBtn.style.display = 'none';
    init();
  });
  document.body.appendChild(toggleBtn);
})();
