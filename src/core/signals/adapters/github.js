import axios from 'axios';

export const name = 'github';
export const timeoutMs = 8000;

const ELIGIBLE_CATEGORIES = new Set(['tech', 'saas', 'software', 'agency']);
const FRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function slugify(name) {
  return name.toLowerCase().replace(/\b(pvt|ltd|inc|llc)\b/g, '').replace(/[^a-z0-9]/g, '').slice(0, 39);
}

async function ghGet(url) {
  try {
    const headers = { 'User-Agent': 'radar-signals/1.0', Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const resp = await axios.get(url, { timeout: timeoutMs - 1000, headers });
    return resp;
  } catch {
    return null;
  }
}

export async function fetch(lead) {
  if (!lead.businessName || !lead.category) return { source: name, signals: [], error: null, durationMs: 0 };
  if (!ELIGIBLE_CATEGORIES.has(lead.category.toLowerCase())) return { source: name, signals: [], error: null, durationMs: 0 };

  const org = slugify(lead.businessName);
  if (!org) return { source: name, signals: [], error: null, durationMs: 0 };

  const orgResp = await ghGet(`https://api.github.com/orgs/${org}`);
  if (!orgResp || orgResp.status !== 200) return { source: name, signals: [], error: null, durationMs: 0 };

  const eventsResp = await ghGet(`https://api.github.com/orgs/${org}/events?per_page=30`);
  if (!eventsResp || eventsResp.status !== 200 || !Array.isArray(eventsResp.data)) {
    return { source: name, signals: [], error: null, durationMs: 0 };
  }

  const cutoff = Date.now() - FRESH_WINDOW_MS;
  const recent = eventsResp.data.filter(e => Date.parse(e.created_at) >= cutoff);
  if (recent.length === 0) return { source: name, signals: [], error: null, durationMs: 0 };

  const recentPushCount = recent.filter(e => e.type === 'PushEvent').length;
  const recentPrCount   = recent.filter(e => e.type === 'PullRequestEvent').length;
  const repos = [...new Set(recent.map(e => e.repo?.name).filter(Boolean))];

  return {
    source: name,
    signals: [{
      signalType: 'github_activity',
      headline: `Active engineering: ${recentPushCount} push${recentPushCount === 1 ? '' : 'es'} + ${recentPrCount} PR${recentPrCount === 1 ? '' : 's'} in last 30d across ${repos.length} repo${repos.length === 1 ? '' : 's'}`,
      url: `https://github.com/${org}`,
      payload: { org, recentPushCount, recentPrCount, repos: repos.slice(0, 10) },
      confidence: 0.7,
      signalDate: recent[0].created_at,
    }],
    error: null,
    durationMs: 0,
  };
}
