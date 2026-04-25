import axios from 'axios';

export const name = 'product_hunt';
export const timeoutMs = 10000;

const FRESH_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
const ENDPOINT = 'https://api.producthunt.com/v2/api/graphql';

const QUERY = `
  query SearchPosts($q: String!) {
    posts(first: 5, order: NEWEST, postedBefore: null, topic: null) {
      edges { node { name tagline url createdAt } }
    }
  }
`;
// Note: the actual PH schema uses `featured` and other filters; this minimal query
// returns the latest posts whose name/tagline can match locally. Schema details may
// drift — adapter is built to fail soft.

export async function fetch(lead) {
  if (!lead.businessName) return { source: name, signals: [], error: null, durationMs: 0 };
  const token = process.env.PRODUCTHUNT_TOKEN;
  if (!token) return { source: name, signals: [], error: null, durationMs: 0 };

  let resp;
  try {
    resp = await axios.post(
      ENDPOINT,
      { query: QUERY, variables: { q: lead.businessName } },
      { timeout: timeoutMs - 500, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );
  } catch {
    return { source: name, signals: [], error: null, durationMs: 0 };
  }
  if (resp.status !== 200) return { source: name, signals: [], error: null, durationMs: 0 };

  const edges = resp.data?.data?.posts?.edges || [];
  const needle = lead.businessName.toLowerCase();
  const cutoff = Date.now() - FRESH_WINDOW_MS;

  const matches = edges
    .map(e => e.node)
    .filter(n => n && (n.name?.toLowerCase().includes(needle) || n.tagline?.toLowerCase().includes(needle)))
    .map(n => ({ ...n, _ts: Date.parse(n.createdAt || '') }))
    .filter(n => n._ts && n._ts >= cutoff)
    .sort((a, b) => b._ts - a._ts);

  if (matches.length === 0) return { source: name, signals: [], error: null, durationMs: 0 };

  const top = matches[0];
  return {
    source: name,
    signals: [{
      signalType: 'launch',
      headline: `Product Hunt launch: ${top.name} — ${top.tagline || ''}`.slice(0, 120),
      url: top.url,
      payload: { name: top.name, tagline: top.tagline, createdAt: top.createdAt },
      confidence: 0.9,
      signalDate: new Date(top._ts).toISOString(),
    }],
    error: null,
    durationMs: 0,
  };
}
