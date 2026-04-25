import Parser from 'rss-parser';
import axios from 'axios';

export const name = 'google_news';
export const timeoutMs = 8000;

const PATTERNS = [
  { type: 'funding',     regex: /\b(raises?|raised|funding|series [a-z]|seed round|led by)\b/i, confidence: 0.9 },
  { type: 'hiring',      regex: /\b(hiring|hires?|is recruiting|expands? team|engineering roles)\b/i, confidence: 0.8 },
  { type: 'launch',      regex: /\b(launch(es|ed)?|unveils?|debuts?|rolls? out)\b/i, confidence: 0.75 },
  { type: 'exec_change', regex: /\b(appoint(s|ed)?|new (ceo|cto|cfo|coo)|joins as)\b/i, confidence: 0.75 },
];

function classify(title) {
  for (const p of PATTERNS) if (p.regex.test(title)) return { type: p.type, confidence: p.confidence };
  return { type: 'press', confidence: 0.4 };
}

export async function fetch(lead) {
  if (!lead.businessName) return { source: name, signals: [], error: null, durationMs: 0 };
  const q = encodeURIComponent(`"${lead.businessName}"`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  const resp = await axios.get(url, { timeout: timeoutMs - 500, responseType: 'text' });
  const parser = new Parser();
  const feed = await parser.parseString(resp.data);
  const signals = (feed.items || []).slice(0, 10).map(item => {
    const { type, confidence } = classify(item.title || '');
    return {
      signalType: type,
      headline: (item.title || '').slice(0, 120),
      url: item.link || null,
      payload: { pubDate: item.pubDate || null },
      confidence,
      signalDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
    };
  });
  return { source: name, signals, error: null, durationMs: 0 };
}
