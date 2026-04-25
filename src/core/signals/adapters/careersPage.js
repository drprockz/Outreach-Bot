import axios from 'axios';
import * as cheerio from 'cheerio';

export const name = 'careers_page';
export const timeoutMs = 8000;

const PROBE_PATHS = ['/careers', '/jobs', '/hiring', '/join-us', '/work-with-us'];
const ROLE_RE = /\b(engineer|developer|designer|manager|lead|architect|analyst)\b/i;

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

async function probePage(origin) {
  for (const path of PROBE_PATHS) {
    const url = origin + path;
    try {
      const resp = await axios.get(url, { timeout: timeoutMs - 500, responseType: 'text' });
      const ct = (resp.headers?.['content-type'] || '').toLowerCase();
      if (resp.status === 200 && ct.includes('html')) return { url, body: resp.data };
    } catch {
      // 404 or other failure — continue
    }
  }
  return null;
}

function extractTitles(html) {
  const $ = cheerio.load(html);
  const titles = new Set();
  $('a, h2, h3, h4, li').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text.length < 3 || text.length > 80) return;
    if (ROLE_RE.test(text)) titles.add(text);
  });
  return [...titles];
}

export async function fetch(lead) {
  if (!lead.websiteUrl) return { source: name, signals: [], error: null, durationMs: 0 };
  const origin = originOf(lead.websiteUrl);
  if (!origin) return { source: name, signals: [], error: null, durationMs: 0 };

  const page = await probePage(origin);
  if (!page) return { source: name, signals: [], error: null, durationMs: 0 };

  const titles = extractTitles(page.body);
  if (titles.length === 0) return { source: name, signals: [], error: null, durationMs: 0 };

  const confidence = titles.length >= 5 ? 0.85 : 0.6;

  return {
    source: name,
    signals: [{
      signalType: 'hiring',
      headline: `Hiring (${titles.length} roles): ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '…' : ''}`,
      url: page.url,
      payload: { count: titles.length, titles: titles.slice(0, 10), pageUrl: page.url },
      confidence,
      signalDate: null,
    }],
    error: null,
    durationMs: 0,
  };
}
