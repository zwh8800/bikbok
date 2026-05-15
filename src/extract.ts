import type { BikbokAPI, VideoItem } from './types';

const api: BikbokAPI = window.__bikbok;

api.extractVideoCards = function (): VideoItem[] {
  const links = document.querySelectorAll<HTMLAnchorElement>('.feed-card a[href*="/video/BV"]');
  if (!links || links.length === 0) return [];
  const bvPattern = /\/video\/(BV[a-zA-Z0-9]+)/;
  const seen = new Set<string>();
  const videos: VideoItem[] = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
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

api.refillVideos = function (): number {
  const fresh = api.extractVideoCards();
  let added = 0;
  for (let i = 0; i < fresh.length; i++) {
    if (!api.seenBvids.has(fresh[i].bvid)) {
      api.seenBvids.add(fresh[i].bvid);
      api.videos.push(fresh[i]);
      added++;
    }
  }
  return added;
};

api.clickRefreshButton = function (): Promise<number> {
  return new Promise(function (resolve) {
    const btn = document.querySelector<HTMLButtonElement>('button.roll-btn');
    if (!btn) { resolve(0); return; }
    btn.click();
    const start = Date.now();
    const timer = setInterval(function () {
      const count = api.refillVideos();
      if (count > 0) { clearInterval(timer); resolve(count); return; }
      if (Date.now() - start >= 15000) { clearInterval(timer); resolve(0); }
    }, 500);
  });
};

api.ensureVideosAvailable = function (): Promise<number> {
  if (api.refillPromise !== null) return api.refillPromise;
  api.refillPromise = (function () {
    let totalAdded = 0;
    let attempts = 0;
    function tryRefill(): Promise<number> {
      if (attempts >= api.MAX_REFRESH_ATTEMPTS) return Promise.resolve(totalAdded);
      attempts++;
      api.refreshAttempts++;
      const fromDOM = api.refillVideos();
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

api.inferTitle = function (link: Element, bvid: string): string {
  const img = link.querySelector<HTMLImageElement>('img[alt]');
  if (img) {
    const alt = (img.getAttribute('alt') || '').trim();
    if (alt.length > 1) return api.truncateTitle(alt);
  }
  const attrTitle = (link.getAttribute('title') || '').trim();
  if (attrTitle.length > 1) return api.truncateTitle(attrTitle);
  const directText = (link.textContent || '').trim();
  if (directText.length > 1 && directText.length < 200) return directText;
  const card = link.closest('.bili-video-card, .video-card, .feed-card, [class*="card"], [class*="Card"]');
  if (card) {
    const headings = card.querySelectorAll('h3, h4, [class*="title"], [class*="tit"], [class*="headline"], [class*="name"], p, span[title]');
    for (let i = 0; i < headings.length; i++) {
      const t = (headings[i].textContent || '').trim();
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

api.truncateTitle = function (text: string): string {
  return text.length > 120 ? text.slice(0, 117) + '...' : text;
};
