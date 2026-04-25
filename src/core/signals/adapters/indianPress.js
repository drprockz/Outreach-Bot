import Parser from 'rss-parser';
import axios from 'axios';

export const name = 'indian_press';
export const timeoutMs = 10000;

const SOURCES = [
  { url: 'https://inc42.com/feed/',     host: 'inc42.com',         fundingPrefers: true  },
  { url: 'https://yourstory.com/feed',  host: 'yourstory.com',     fundingPrefers: false },
  { url: 'https://entrackr.com/feed',   host: 'entrackr.com',      fundingPrefers: false },
  { url: 'https://www.vccircle.com/rss', host: 'www.vccircle.com', fundingPrefers: true  },
];

const FUNDING_RE = /\b(raises?|raised|funding|series [a-z]|seed round|led by|bags? \$|secures? \$)\b/i;

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function buildMatchers(lead) {
  const needles = [];
  if (lead.businessName) needles.push(lead.businessName.toLowerCase());
  const host = hostnameOf(lead.websiteUrl);
  if (host) needles.push(host);
  return needles;
}

function itemMatches(item, needles) {
  const hay = `${item.title || ''} ${item.contentSnippet || ''}`.toLowerCase();
  return needles.some(n => hay.includes(n));
}

async function fetchFeed(source) {
  try {
    const resp = await axios.get(source.url, { timeout: timeoutMs - 1000, responseType: 'text' });
    const feed = await new Parser().parseString(resp.data);
    return { source, items: feed.items || [] };
  } catch {
    return { source, items: [] };
  }
}

export async function fetch(lead) {
  const needles = buildMatchers(lead);
  if (needles.length === 0) return { source: name, signals: [], error: null, durationMs: 0 };

  const results = await Promise.all(SOURCES.map(fetchFeed));

  const signals = [];
  for (const { source, items } of results) {
    for (const item of items) {
      if (!itemMatches(item, needles)) continue;
      const isFunding = source.fundingPrefers && FUNDING_RE.test(`${item.title || ''} ${item.contentSnippet || ''}`);
      signals.push({
        signalType: isFunding ? 'funding' : 'press',
        headline: (item.title || '').slice(0, 120),
        url: item.link || null,
        payload: { source: source.host, pubDate: item.pubDate || null },
        confidence: 0.95,
        signalDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      });
    }
  }

  return { source: name, signals, error: null, durationMs: 0 };
}
