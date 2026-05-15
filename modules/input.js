/**
 * bikbok — 输入处理模块
 *
 * 处理所有用户输入事件：
 *   - onKeyDown(): 键盘事件（↑↓ 导航 / ← → 进度 + 标题 / Enter 主动播放暂停 + 标题 / Space 播放暂停 + 标题 / I O 倍速 + 标题 / F 全屏 / B 退出 / Escape 关闭）
 *   - onMessage(): postMessage 事件（监听 B 站播放器发出的 video_ended）
 *   - onBikbokKey(): postMessage 转发（iframe 内按键通过 postMessage 传递到父窗口）
 *   - toggleFullscreen(): 浏览器全屏切换
 *
 * 通过 api.navigation 注册表间接调用 content.js 的导航函数，避免循环依赖。
 *
 * @module modules/input
 * @requires window.__bikbok (state.js, content.js via navigation registry)
 */
(function (api) {
  'use strict';

  /**
   * 切换浏览器全屏模式
   *
   * 目标元素为 #bikbok-overlay。如果当前已全屏则退出，否则请求全屏。
   * 注意：macOS Safari 可能不支持 requestFullscreen，使用 .catch() 静默处理。
   *
   * @returns {void}
   */
  api.toggleFullscreen = function () {
    if (!api.overlay) return;
    if (document.fullscreenElement && document.fullscreenElement === api.overlay) {
      document.exitFullscreen();
    } else if (api.overlay.requestFullscreen) {
      api.overlay.requestFullscreen().catch(function () {});
    }
  };

  /**
   * 全局键盘事件处理器
   *
   * 按键处理顺序（按优先级）：
   *   1. Escape — 退出 TikTok 模式（全屏状态时先退出全屏再退出覆盖层）
   *   2. F / Shift+F — 切换浏览器全屏
   *   3. I — 降低倍速（-0.25x）+ 显示倍速指示器 + 显示标题
   *   4. O — 提高倍速（+0.25x）+ 显示倍速指示器 + 显示标题
   *   5. B — 全局切换（退出 TikTok 模式）
   *   6. ← → — 快进快退 + 显示标题 + 延迟 200ms 显示进度指示器
   *   7. Enter — 主动切换播放/暂停（阻止默认）+ 显示标题
   *   8. Space — 播放/暂停（透传给 B 站播放器）+ 显示标题
   *   9. ↑ — 上一个视频（300ms 防抖）
   *  10. ↓ — 下一个视频（300ms 防抖）
   *
   * @param {KeyboardEvent} e - 键盘事件对象
   * @returns {void}
   */
  api.onKeyDown = function (e) {
    // Escape 优先级最高：全屏状态下只退出全屏，非全屏才退出模式
    if (e.key === 'Escape') {
      if (document.fullscreenElement && document.fullscreenElement === api.overlay) return;
      e.preventDefault();
      e.stopPropagation();
      api.navigation.cleanup();
      return;
    }
    // F 键：切换浏览器全屏（目标为外层 #bikbok-overlay，非 iframe 内部）
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      e.stopPropagation();
      api.toggleFullscreen();
      return;
    }
    // I 键：降低倍速 0.25x
    if (e.key === 'i' || e.key === 'I') {
      if (!api.overlay) return;
      e.preventDefault();
      e.stopPropagation();
      var slower = api.adjustSpeed(-api.SPEED_STEP);
      api.showSpeedIndicator(slower);
      api.showTitleBriefly();
      return;
    }
    // O 键：提高倍速 0.25x
    if (e.key === 'o' || e.key === 'O') {
      if (!api.overlay) return;
      e.preventDefault();
      e.stopPropagation();
      var faster = api.adjustSpeed(api.SPEED_STEP);
      api.showSpeedIndicator(faster);
      api.showTitleBriefly();
      return;
    }
    // B 键：全局切换，退出 TikTok 模式
    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      e.stopPropagation();
      api.navigation.cleanup();
      return;
    }
    // ← → 键：postMessage 异步到达后 B 站播放器 seek 尚未完成，延迟 200ms 确保读取到 seek 后的时间
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!api.overlay) return;
      api.showTitleBriefly();
      setTimeout(function () {
        var activeIfr = api.getActiveIframe();
        if (!activeIfr || !activeIfr.contentDocument) return;
        var video = activeIfr.contentDocument.querySelector('video');
        if (video) api.showProgressIndicator(video.currentTime, video.duration);
      }, 200);
      return;
    }
    // Enter 键：主动切换 iframe 内视频的播放/暂停，阻止默认行为防止页面滚动
    if (e.key === 'Enter') {
      if (!api.overlay) return;
      e.preventDefault();
      e.stopPropagation();
      var activeIfr = api.getActiveIframe();
      if (activeIfr && activeIfr.contentDocument) {
        var video = activeIfr.contentDocument.querySelector('video');
        if (video) {
          if (video.paused) { video.play().catch(function () {}); }
          else { video.pause(); }
        }
      }
      api.showTitleBriefly();
      return;
    }
     // Space 键：透传给 B 站播放器处理播放/暂停，同时显示标题
     if (e.key === ' ') {
       if (api.overlay) api.showTitleBriefly();
       return;
     }
     // Z 键：点赞
     if (e.key === 'z' || e.key === 'Z') {
       if (!api.overlay) return;
       e.preventDefault();
       e.stopPropagation();
       var activeIfr = api.getActiveIframe();
       if (activeIfr && activeIfr.contentDocument) {
         var likeBtn = activeIfr.contentDocument.querySelector('.video-like.video-toolbar-left-item');
         if (likeBtn) likeBtn.click();
       }
       api.showLikeIndicator();
       return;
     }
     // C 键：收藏
     if (e.key === 'c' || e.key === 'C') {
       if (!api.overlay) return;
       e.preventDefault();
       e.stopPropagation();
       var activeIfr = api.getActiveIframe();
       if (activeIfr && activeIfr.contentDocument) {
         var favBtn = activeIfr.contentDocument.querySelector('.video-fav.video-toolbar-left-item');
         if (favBtn) favBtn.click();
       }
       return;
     }
     // 300ms 防抖：防止快速连续按键导致视频切换过猛
    const now = Date.now();
    if (now - api.lastNavTime < api.DEBOUNCE_MS) return;
    // ↑ ↓ 键：300ms 防抖，通过 navigation 注册表调用导航函数
    let handled = false;
    switch (e.key) {
      case 'ArrowDown': api.lastNavTime = now; api.navigation.nextVideo(); handled = true; break; // ↓ 键：下一个视频
      case 'ArrowUp': api.lastNavTime = now; api.navigation.prevVideo(); handled = true; break;   // ↑ 键：上一个视频
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  /**
   * postMessage 事件处理器（监听 B 站播放器的视频结束事件）
   *
   * 安全校验：
   *   1. e.origin 严格匹配（===）PLAYER_ORIGIN（不仅是 startsWith）
   *   2. e.source 必须匹配当前活动 iframe 的 contentWindow
   *   3. data 必须是 object 类型
   *
   * 灵活识别多种 ended 消息格式（type/event/info 字段均可为 'video_ended' 或 'ended'）。
   * 收到 ended 后触发 nextVideo()。
   *
   * @param {MessageEvent} e - postMessage 事件对象
   * @returns {void}
   */
  api.onMessage = function (e) {
    // 严格的 origin 检查（===，非 startsWith），防止恶意页面伪造消息
    if (e.origin !== api.PLAYER_ORIGIN) return;
    // source 必须匹配当前活动 iframe
    var activeIfr = api.getActiveIframe();
    if (!activeIfr || e.source !== activeIfr.contentWindow) return;
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    // 灵活匹配多种 ended 通知格式：B 站播放器可能发送 type/event/info 字段为 'video_ended' 或 'ended'
    const isEnded = data.type === 'video_ended' || data.type === 'ended' || data.event === 'video_ended' || data.event === 'ended' || data.info === 'ended';
    if (isEnded && api.currentIndex < api.videos.length - 1) {
      api.navigation.nextVideo();
    }
  };

  /**
   * postMessage 键盘转发处理器
   *
   * 接收 iframe 内 setupPlayerInIframe() 通过 postMessage 发出的 bikbok-key 消息，
   * 构造假的 KeyboardEvent 对象并转发给 onKeyDown() 处理。
   * 这样 iframe 内的按键操作也能触发父窗口的导航逻辑。
   *
   * @param {MessageEvent} e - postMessage 事件对象，data.type 须为 'bikbok-key'
   * @returns {void}
   */
  api.onBikbokKey = function (e) {
    if (e.data && e.data.type === 'bikbok-key') {
      // 构造最小化 KeyboardEvent 对象（仅含 key、preventDefault、stopPropagation）
      api.onKeyDown({ key: e.data.key, preventDefault: function () {}, stopPropagation: function () {} });
    }
  };

})(window.__bikbok);
