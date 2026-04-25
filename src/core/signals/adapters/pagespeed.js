import axios from 'axios';

export const name = 'pagespeed';
// PSI is slow — give it more headroom than other adapters.
export const timeoutMs = 30000;

const PAIN_LCP_MS = 4000;

export async function fetch(lead) {
  if (!lead.websiteUrl) return { source: name, signals: [], error: null, durationMs: 0 };

  const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(lead.websiteUrl)}&strategy=mobile`;
  let resp;
  try {
    resp = await axios.get(url, { timeout: timeoutMs - 1000 });
  } catch {
    return { source: name, signals: [], error: null, durationMs: 0 };
  }
  if (resp.status !== 200) return { source: name, signals: [], error: null, durationMs: 0 };

  const audits = resp.data?.lighthouseResult?.audits || {};
  const lcpMs = audits['largest-contentful-paint']?.numericValue;
  const cls   = audits['cumulative-layout-shift']?.numericValue;
  if (typeof lcpMs !== 'number') return { source: name, signals: [], error: null, durationMs: 0 };

  const isPain = lcpMs > PAIN_LCP_MS;
  const confidence = isPain ? 0.7 : 0.3;
  const lcpSec = (lcpMs / 1000).toFixed(1);

  return {
    source: name,
    signals: [{
      signalType: 'performance',
      headline: isPain
        ? `Slow site: LCP ${lcpSec}s (mobile) — UX pain signal`
        : `Healthy site: LCP ${lcpSec}s (mobile)`,
      url: null,
      payload: { lcpMs, cls: cls ?? null, strategy: 'mobile' },
      confidence,
      signalDate: null,
    }],
    error: null,
    durationMs: 0,
  };
}
