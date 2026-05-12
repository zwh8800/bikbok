/**
 * bikbok — 视频提取模块
 */
(function (api) {
  'use strict';

  api.extractVideoCards = function () {
    const links = document.querySelectorAll('.feed-card a[href*="/video/BV"]');
    if (!links || links.length === 0) return [];
    const bvPattern = /\/video\/(BV[a-zA-Z0-9]+)/;
    const seen = new Set();
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

  api.refillVideos = function () {
    var fresh = api.extractVideoCards();
    var added = 0;
    for (var i = 0; i < fresh.length; i++) {
      if (!api.seenBvids.has(fresh[i].bvid)) {
        api.seenBvids.add(fresh[i].bvid);
        api.videos.push(fresh[i]);
        added++;
      }
    }
    return added;
  };

  api.clickRefreshButton = function () {
    return new Promise(function (resolve) {
      var btn = document.querySelector('button.roll-btn');
      if (!btn) { resolve(0); return; }
      btn.click();
      var start = Date.now();
      var timer = setInterval(function () {
        var count = api.refillVideos();
        if (count > 0) { clearInterval(timer); resolve(count); return; }
        if (Date.now() - start >= 15000) { clearInterval(timer); resolve(0); }
      }, 500);
    });
  };

  api.ensureVideosAvailable = function () {
    if (api.refillPromise !== null) return api.refillPromise;
    api.refillPromise = (function () {
      var totalAdded = 0;
      var attempts = 0;
      function tryRefill() {
        if (attempts >= api.MAX_REFRESH_ATTEMPTS) return Promise.resolve(totalAdded);
        attempts++;
        api.refreshAttempts++;
        var fromDOM = api.refillVideos();
        if (fromDOM > 0) { totalAdded += fromDOM; return Promise.resolve(totalAdded); }
        return api.clickRefreshButton().then(function (fromRefresh) {
          totalAdded += fromRefresh;
          if (fromRefresh > 0) return totalAdded;
          return tryRefill();
        });
      }
      return tryRefill().then(function (result) { api.refillPromise = null; return result; });
    })();
    return api.refillPromise;
  };

  api.inferTitle = function (link, bvid) {
    var img = link.querySelector('img[alt]');
    if (img) { var alt = (img.getAttribute('alt') || '').trim(); if (alt.length > 1) return api.truncateTitle(alt); }
    var attrTitle = (link.getAttribute('title') || '').trim();
    if (attrTitle.length > 1) return api.truncateTitle(attrTitle);
    var directText = (link.textContent || '').trim();
    if (directText.length > 1 && directText.length < 200) return directText;
    const card = link.closest('.bili-video-card, .video-card, .feed-card, [class*="card"], [class*="Card"]');
    if (card) {
      const headings = card.querySelectorAll('h3, h4, [class*="title"], [class*="tit"], [class*="headline"], [class*="name"], p, span[title]');
      for (const h of headings) {
        const t = (h.textContent || '').trim();
        if (t.length > 1 && t.length < 200 && t !== directText) return t;
      }
    }
    const parent = link.parentElement;
    if (parent) {
      const parentText = (parent.textContent || '').trim();
      const linkOwn = (link.textContent || '').trim();
      if (parentText !== linkOwn && parentText.length > 1 && parentText.length < 200) return parentText;
    }
    return bvid;
  };

  api.truncateTitle = function (text) {
    return text.length > 120 ? text.slice(0, 117) + '...' : text;
  };

})(window.__bikbok);
