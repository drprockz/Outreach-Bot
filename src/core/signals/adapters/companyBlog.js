import Parser from 'rss-parser';
import axios from 'axios';

export const name = 'company_blog';
export const timeoutMs = 8000;

const FEED_PATHS = ['/feed', '/rss', '/blog/rss.xml', '/feed.xml', '/atom.xml'];
const FRESH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function originOf(websiteUrl) {
  try { return new URL(websiteUrl).origin; } catch { return null; }
}

async function probeFeed(origin) {
  for (const path of FEED_PATHS) {
    const url = origin + path;
    try {
      const resp = await axios.get(url, { timeout: timeoutMs - 500, responseType: 'text' });
      const ct = (resp.headers?.['content-type'] || '').toLowerCase();
      if (resp.status === 200 && ct.includes('xml')) return { url, body: resp.data };
    } catch {
      // 404 or other failure — continue to next path
    }
  }
  return null;
}

export async function fetch(lead) {
  if (!lead.websiteUrl) return { source: name, signals: [], error: null, durationMs: 0 };
  const origin = originOf(lead.websiteUrl);
  if (!origin) return { source: name, signals: [], error: null, durationMs: 0 };

  const feed = await probeFeed(origin);
  if (!feed) return { source: name, signals: [], error: null, durationMs: 0 };

  const parsed = await new Parser().parseString(feed.body);
  const items = (parsed.items || [])
    .map(i => ({ ...i, _ts: i.pubDate ? Date.parse(i.pubDate) : 0 }))
    .filter(i => i._ts > 0)
    .sort((a, b) => b._ts - a._ts);

  if (items.length === 0) return { source: name, signals: [], error: null, durationMs: 0 };

  const top = items[0];
  const ageMs = Date.now() - top._ts;
  const confidence = ageMs <= FRESH_WINDOW_MS ? 0.7 : 0.3;

  return {
    source: name,
    signals: [{
      signalType: 'blog_post',
      headline: (top.title || '').slice(0, 120),
      url: top.link || feed.url,
      payload: { pubDate: top.pubDate, feedUrl: feed.url },
      confidence,
      signalDate: new Date(top._ts).toISOString(),
    }],
    error: null,
    durationMs: 0,
  };
}
