/**
 * bikbok — UI 模块
 *
 * 负责所有 UI 元素的创建和更新：
 *   - createOverlay(): 构建全屏覆盖层 + 三槽位 iframe + 标题 + 提示
 *   - updateUI(): 更新视频标题（计数器已注释保留）
 *   - 消息提示：showMessage/showEndMessage/removeEndMessage
 *   - 指示器：showProgressIndicator（← → 进度）/ showSpeedIndicator（I O 倍速）
 *   - 标题显示：showTitleBriefly（3 秒后自动渐隐）
 *
 * @module modules/ui
 * @requires window.__bikbok (state.js)
 */
(function (api) {
  'use strict';

  /**
   * 构建 #bikbok-overlay 全屏覆盖层 DOM 结构
   *
   * DOM 层级（按添加顺序）：
   *   1. #bikbok-overlay 容器（position:fixed, inset:0, z-index:999999）
   *   2. .bikbok-loading 加载动画
   *   3. 三个 iframe 槽位（slot 0 为 .bikbok-player-active，其余为 .bikbok-player-preload）
   *   4. .bikbok-title 视频标题
   *   5. .bikbok-counter 视频计数器（当前已注释不显示）
   *   6. .bikbok-hints 键盘操作提示
   *
   * @returns {void}
   */
  api.createOverlay = function () {
    api.overlay = document.createElement('div');
    api.overlay.id = 'bikbok-overlay';
    api.overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;';
    api.loadingEl = document.createElement('div');
    api.loadingEl.className = 'bikbok-loading';
    api.overlay.appendChild(api.loadingEl);
    for (var slot = 0; slot < 3; slot++) {
      var ifr = document.createElement('iframe');
      // activeSlot 槽位使用 bikbok-player-active 类（可见 + 最高 z-index）
      // 其他槽位使用 bikbok-player-preload 类（visibility:hidden，保留 contentDocument 可访问）
      ifr.className = slot === api.activeSlot ? 'bikbok-player bikbok-player-active' : 'bikbok-player bikbok-player-preload';
      // 允许 iframe 自动播放和全屏
      ifr.setAttribute('allow', 'autoplay; fullscreen');
      api.iframes[slot] = ifr;
      api.overlay.appendChild(ifr);
    }
    api.iframe = api.getActiveIframe();
    api.titleEl = document.createElement('div');
    api.titleEl.className = 'bikbok-title';
    api.overlay.appendChild(api.titleEl);
    api.counterEl = document.createElement('div');
    api.counterEl.className = 'bikbok-counter';
    api.overlay.appendChild(api.counterEl);
    api.hintsEl = document.createElement('div');
    api.hintsEl.className = 'bikbok-hints';
     api.hintsEl.textContent = '↑ ↓ 切换视频\n← → 快进快退\nSpace 播放/暂停\nF 全屏\nI O 倍速\nZ 点赞 · C 收藏\nEsc 退出';
    api.overlay.appendChild(api.hintsEl);
    document.body.appendChild(api.overlay);
  };

  /**
   * 更新覆盖层 UI（标题 + 计数器 "N / M"）
   *
   * 更新标题（通过 textContent 防止 XSS）和右上角计数指示器（仅视频数 > 1 时显示）。
   *
   * @param {number} index - 当前视频在 videos 数组中的索引
   * @returns {void}
   */
  api.updateUI = function (index) {
    const video = api.videos[index];
    if (!video) return;
    if (api.titleEl) api.titleEl.textContent = video.title;
    if (api.counterEl) {
      if (api.videos.length > 1) {
        api.counterEl.textContent = `${index + 1} / ${api.videos.length}`;
        api.counterEl.style.display = '';
      } else {
        api.counterEl.style.display = 'none';
      }
    }
  };

  /**
   * 在覆盖层中央显示消息提示
   *
   * 先移除已有消息，再创建新的 .bikbok-message 元素。
   * 如果 showRetry 为 true，附加一个「Retry」按钮。
   *
   * @param {string} text - 消息文本
   * @param {boolean} [showRetry=false] - 是否显示重试按钮
   * @param {Function} [retryCallback] - 点击重试按钮时的回调
   * @returns {void}
   */
  api.showMessage = function (text, showRetry, retryCallback) {
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
      btn.addEventListener('click', function () { msg.remove(); if (retryCallback) retryCallback(); });
      msg.appendChild(btn);
    }
    api.overlay.appendChild(msg);
  };

  /**
   * 显示「推荐列表结束」消息
   *
   * 默认文案为 'End of recommendations ✨'，可通过参数自定义。
   *
   * @param {string} [text] - 自定义消息，默认使用内置文案
   * @returns {void}
   */
  api.showEndMessage = function (text) {
    if (!api.overlay) return;
    var existing = api.overlay.querySelector('.bikbok-end');
    if (existing) existing.remove();
    var msg = document.createElement('div');
    msg.className = 'bikbok-end';
    msg.textContent = typeof text === 'string' ? text : 'End of recommendations \u2728';
    api.overlay.appendChild(msg);
  };

  /**
   * 移除推荐列表结束消息
   *
   * 当 refill 成功后调用，移除之前显示的 .bikbok-end 元素。
   *
   * @returns {void}
   */
  api.removeEndMessage = function () {
    if (!api.overlay) return;
    var el = api.overlay.querySelector('.bikbok-end');
    if (el) el.remove();
  };

  /**
   * 隐藏键盘操作提示
   *
   * 添加 .bikbok-hints-hidden 类触发 opacity 过渡渐隐，
   * 通过 hintsHidden 标志防止重复操作（仅执行一次）。
   *
   * @returns {void}
   */
  api.hideHints = function () {
    if (!api.hintsHidden && api.hintsEl) {
      api.hintsHidden = true;
      api.hintsEl.classList.add('bikbok-hints-hidden');
    }
  };

  /**
   * 在覆盖层中央显示播放进度指示器（← → 键触发）
   *
   * 格式：MM:SS / MM:SS，当总时长 ≥ 60 分钟时自动切换为 HH:MM:SS。
   * 指示器显示 1.5 秒后自动移除。
   *
   * @param {number} currentTime - 当前播放位置（秒）
   * @param {number} duration - 视频总时长（秒）
   * @returns {void}
   */
  api.showProgressIndicator = function (currentTime, duration) {
    if (!api.overlay) return;
    // 先移除已有指示器，避免堆叠
    var prev = api.overlay.querySelector('.bikbok-progress-indicator');
    if (prev) prev.remove();
    // 清除旧定时器，重启 1.5s 倒计时
    clearTimeout(api.progressIndicatorTimer);
    var el = document.createElement('div');
    el.className = 'bikbok-progress-indicator';
    // 时间格式化函数：根据 showHours 选择 HH:MM:SS 或 MM:SS
    function fmt(sec, showHours) {
      if (!isFinite(sec) || sec < 0) return '--:--';
      var h = showHours ? Math.floor(sec / 3600) : 0;
      var m = Math.floor((sec % 3600) / 60);
      var s = Math.floor(sec % 60);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return showHours ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
    }
    // 总时长 ≥ 3600 秒（60 分钟）时显示小时
    var hasHours = isFinite(duration) && duration >= 3600;
    el.textContent = fmt(currentTime, hasHours) + ' / ' + fmt(duration, hasHours);
    api.overlay.appendChild(el);
    // 1.5s 后自动移除
    api.progressIndicatorTimer = setTimeout(function () { if (el.parentNode) el.remove(); }, 1500);
  };

  /**
   * 在覆盖层中央显示倍速指示器（I O 键触发）
   *
   * 显示格式："{speed}x"，1.5 秒后自动移除。
   *
   * @param {number} speed - 当前播放速率
   * @returns {void}
   */
   api.showSpeedIndicator = function (speed) {
     if (!api.overlay) return;
     var prev = api.overlay.querySelector('.bikbok-speed-indicator');
     if (prev) prev.remove();
     clearTimeout(api.speedIndicatorTimer);
     var el = document.createElement('div');
     el.className = 'bikbok-speed-indicator';
     el.textContent = speed + 'x';
     api.overlay.appendChild(el);
     api.speedIndicatorTimer = setTimeout(function () { if (el.parentNode) el.remove(); }, 1500);
   };

   /**
    * 在覆盖层中央显示点赞动效（Z 键触发）
    *
    * 显示格式："❤️ 已点赞"，1.5 秒后自动移除。
    *
    * @returns {void}
    */
   api.showLikeIndicator = function () {
     if (!api.overlay) return;
     var prev = api.overlay.querySelector('.bikbok-like-indicator');
     if (prev) prev.remove();
     var el = document.createElement('div');
     el.className = 'bikbok-like-indicator';
     el.textContent = '❤️ 已点赞';
     api.overlay.appendChild(el);
     setTimeout(function () { if (el.parentNode) el.remove(); }, 1500);
   };

  /**
   * 短暂显示视频标题（视频切换后触发）
   *
   * 移除 .bikbok-title-hidden 类使标题恢复可见，
   * 3 秒后自动添加该类触发 opacity 渐隐。
   *
   * @returns {void}
   */
  api.showTitleBriefly = function () {
    if (!api.titleEl) return;
    clearTimeout(api.titleTimerId);
    api.titleEl.classList.remove('bikbok-title-hidden');
    api.titleTimerId = setTimeout(function () {
      if (api.titleEl) api.titleEl.classList.add('bikbok-title-hidden');
    }, 3000);
  };

})(window.__bikbok);
