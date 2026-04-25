import axios from 'axios';

export const name = 'cert_transparency';
export const timeoutMs = 10000;

const FRESH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function apexOf(websiteUrl) {
  try { return new URL(websiteUrl).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

export async function fetch(lead) {
  if (!lead.websiteUrl) return { source: name, signals: [], error: null, durationMs: 0 };
  const apex = apexOf(lead.websiteUrl);
  if (!apex) return { source: name, signals: [], error: null, durationMs: 0 };

  let resp;
  try {
    resp = await axios.get(`https://crt.sh/?q=${encodeURIComponent(apex)}&output=json`, {
      timeout: timeoutMs - 500,
      headers: { 'User-Agent': 'radar-signals/1.0' },
    });
  } catch {
    return { source: name, signals: [], error: null, durationMs: 0 };
  }
  if (!Array.isArray(resp.data)) return { source: name, signals: [], error: null, durationMs: 0 };

  const cutoff = Date.now() - FRESH_WINDOW_MS;
  const seen = new Map(); // subdomain -> earliest entry_timestamp
  for (const row of resp.data) {
    const ts = row.entry_timestamp ? Date.parse(row.entry_timestamp + 'Z') : 0;
    if (!ts || ts < cutoff) continue;
    const names = String(row.name_value || '').split('\n').map(s => s.trim().toLowerCase());
    for (const n of names) {
      if (!n || n.startsWith('*')) continue;
      if (n === apex) continue;
      if (!n.endsWith('.' + apex)) continue;
      if (!seen.has(n) || seen.get(n) > ts) seen.set(n, ts);
    }
  }

  const signals = [...seen.entries()].map(([sub, ts]) => ({
    signalType: 'subdomain',
    headline: `New subdomain detected: ${sub}`,
    url: `https://${sub}`,
    payload: { subdomain: sub, apex },
    confidence: 0.6,
    signalDate: new Date(ts).toISOString(),
  }));

  return { source: name, signals, error: null, durationMs: 0 };
}
