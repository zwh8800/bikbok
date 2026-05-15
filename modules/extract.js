/**
 * bikbok — 视频提取模块
 *
 * 从 B 站首页 DOM 中提取视频信息（BV 号 + 标题），支持视频池 refill
 * 和「换一换」按钮点击，确保 TikTok 模式下有源源不断的视频可供播放。
 *
 * @module modules/extract
 * @requires window.__bikbok
 */
(function (api) {
  'use strict';

  /**
   * 从 B 站首页 DOM 中提取视频卡片信息
   *
   * 遍历所有匹配 .feed-card a[href*="/video/BV"] 的链接元素，
   * 通过正则提取 BV 号，Set 去重后返回 {bvid, title} 数组。
   * 标题通过 api.inferTitle() 进行 5 级回退推断。
   *
   * @returns {Array<{bvid: string, title: string}>} 提取到的视频列表
   */
  api.extractVideoCards = function () {
    const links = document.querySelectorAll('.feed-card a[href*="/video/BV"]');
    if (!links || links.length === 0) return [];
    const bvPattern = /\/video\/(BV[a-zA-Z0-9]+)/; // BV 号格式: /video/BV 后跟 10 位字母数字
    const seen = new Set(); // Set 去重，防止同一视频多次出现
    const videos = [];
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      const match = href.match(bvPattern);
      if (!match) continue;
      const bvid = match[1];
      if (seen.has(bvid)) continue;
      seen.add(bvid);
      videos.push({ bvid, title: api.inferTitle(link, bvid) });
    }
    return videos;
  };

  /**
   * 增量提取新视频并追加到 videos 数组
   *
   * 调用 extractVideoCards() 重新扫描 DOM，仅添加未见过的 BV 号
   * （通过 seenBvids Set 去重），同时更新 seenBvids。
   *
   * @returns {number} 新添加的视频数量
   */
  api.refillVideos = function () {
    var fresh = api.extractVideoCards();
    var added = 0; // 只添加未见过的视频，去重
    for (var i = 0; i < fresh.length; i++) {
      if (!api.seenBvids.has(fresh[i].bvid)) {
        api.seenBvids.add(fresh[i].bvid);
        api.videos.push(fresh[i]);
        added++;
      }
    }
    return added;
  };

  /**
   * 点击 B 站首页「换一换」按钮并轮询等待新视频出现
   *
   * 点击 button.roll-btn 触发页面刷新推荐内容，然后每 500ms 调用
   * refillVideos() 检测新视频，最多等待 15 秒。
   *
   * @returns {Promise<number>} 解析为新添加的视频数量
   */
  api.clickRefreshButton = function () {
    return new Promise(function (resolve) {
      var btn = document.querySelector('button.roll-btn'); // B 站首页「换一换」按钮
      if (!btn) { resolve(0); return; }
      btn.click();
      var start = Date.now();
      var timer = setInterval(function () { // 每 500ms 检查是否有新视频，最多等待 15s
        var count = api.refillVideos();
        if (count > 0) { clearInterval(timer); resolve(count); return; }
        if (Date.now() - start >= 15000) { clearInterval(timer); resolve(0); } // 超过 15 秒放弃等待
      }, 500);
    });
  };

  /**
   * 确保视频池中有足够视频可用（主 Refill 编排器）
   *
   * 三级策略：① DOM 增量提取（refillVideos）→ ② 点击「换一换」按钮
   * （clickRefreshButton）→ ③ 递归重试（最多 MAX_REFRESH_ATTEMPTS 次）。
   * 使用 refillPromise 防止并发重复触发，函数返回 Promise。
   *
   * @returns {Promise<number>} 解析为总共新添加的视频数量
   */
  api.ensureVideosAvailable = function () {
    if (api.refillPromise !== null) return api.refillPromise; // 已有 refill 在进行中，防止重复触发
    api.refillPromise = (function () {
      var totalAdded = 0;
      var attempts = 0;
      function tryRefill() {
        if (attempts >= api.MAX_REFRESH_ATTEMPTS) return Promise.resolve(totalAdded); // 达到最大重试次数，不再递归
        attempts++;
        api.refreshAttempts++;
        var fromDOM = api.refillVideos();
        if (fromDOM > 0) { totalAdded += fromDOM; return Promise.resolve(totalAdded); }
        return api.clickRefreshButton().then(function (fromRefresh) { // 递归重试：DOM 提取 → 换一换 → 最多 3 次
          totalAdded += fromRefresh;
          if (fromRefresh > 0) return totalAdded;
          return tryRefill();
        });
      }
      return tryRefill().then(function (result) {
        api.refillPromise = null;
        if (result > 0) api.refreshAttempts = 0;
        return result;
      });
    })();
    return api.refillPromise;
  };

  /**
   * 从视频链接元素推断视频标题（5 级回退链）
   *
   * 按优先级依次尝试：
   *   1. img[alt] 属性 — B 站视频标题主要存储位置
   *   2. <a> 的 title 属性
   *   3. <a> 的 textContent（长度 1-200 时才认为有效）
   *   4. 父级卡片容器内的 h3/h4/[class*="title"] 等元素
   *   5. 父元素的 textContent（去重后）
   *   6. 回退到 BV 号本身
   *
   * @param {Element} link - 视频链接 DOM 元素（<a> 标签）
   * @param {string} bvid - BV 号（回退值）
   * @returns {string} 推断出的视频标题
   */
  api.inferTitle = function (link, bvid) {
    // 1. img[alt] — B 站标题主要存储位置
    var img = link.querySelector('img[alt]');
    if (img) { var alt = (img.getAttribute('alt') || '').trim(); if (alt.length > 1) return api.truncateTitle(alt); }
    // 2. title 属性
    var attrTitle = (link.getAttribute('title') || '').trim();
    if (attrTitle.length > 1) return api.truncateTitle(attrTitle);
    // 3. 直接 textContent
    var directText = (link.textContent || '').trim();
    if (directText.length > 1 && directText.length < 200) return directText;
    // 4. 卡片容器内的标题元素
    const card = link.closest('.bili-video-card, .video-card, .feed-card, [class*="card"], [class*="Card"]');
    if (card) {
      const headings = card.querySelectorAll('h3, h4, [class*="title"], [class*="tit"], [class*="headline"], [class*="name"], p, span[title]');
      for (const h of headings) {
        const t = (h.textContent || '').trim();
        if (t.length > 1 && t.length < 200 && t !== directText) return t;
      }
    }
    // 5. 父元素文本
    const parent = link.parentElement;
    if (parent) {
      const parentText = (parent.textContent || '').trim();
      const linkOwn = (link.textContent || '').trim();
      if (parentText !== linkOwn && parentText.length > 1 && parentText.length < 200) return parentText;
    }
    // 6. 回退到 BV 号
    return bvid;
  };

  /**
   * 截断过长标题
   *
   * 超过 120 字符时截取前 117 字符并追加 '...'
   *
   * @param {string} text - 原始标题文本
   * @returns {string} 截断后的标题
   */
  api.truncateTitle = function (text) {
    return text.length > 120 ? text.slice(0, 117) + '...' : text;
  };

})(window.__bikbok);
