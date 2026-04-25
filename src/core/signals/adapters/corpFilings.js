// EXPERIMENTAL: Tofler scrape for Indian company filings.
// Scrapes a public web page; expect anti-bot pushback (403) on real traffic.
// Designed to silent-fail. Re-evaluate inclusion in default registry after Chunk 3 smoke test.
import axios from 'axios';
import * as cheerio from 'cheerio';

export const name = 'corp_filings';
export const timeoutMs = 12000;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseToflerPage(html) {
  const $ = cheerio.load(html);
  let paidUpCapital = null;
  const directors = [];

  // Tofler renders filings as a <th>label</th><td>value</td> table — pair each th with its sibling td.
  $('th').each((_, th) => {
    const label = $(th).text().trim().toLowerCase();
    const value = $(th).next('td').text().replace(/\s+/g, ' ').trim();
    if (!value) return;
    if (/paid[-\s]?up capital/.test(label)) paidUpCapital = value;
    if (/directors?/.test(label)) {
      value.split(',').forEach(s => {
        const name = s.trim();
        if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/.test(name)) directors.push(name);
      });
    }
  });

  return { paidUpCapital, directors };
}

export async function fetch(lead) {
  if (!lead.businessName) return { source: name, signals: [], error: null, durationMs: 0 };
  if ((lead.country || 'IN').toUpperCase() !== 'IN') return { source: name, signals: [], error: null, durationMs: 0 };

  const slug = slugify(lead.businessName);
  if (!slug) return { source: name, signals: [], error: null, durationMs: 0 };

  let resp;
  try {
    resp = await axios.get(`https://www.tofler.in/${slug}/company`, {
      timeout: timeoutMs - 1000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; radar-signals/1.0)' },
    });
  } catch {
    return { source: name, signals: [], error: null, durationMs: 0 };
  }
  if (resp.status !== 200 || typeof resp.data !== 'string') {
    return { source: name, signals: [], error: null, durationMs: 0 };
  }

  const { paidUpCapital, directors } = parseToflerPage(resp.data);
  if (!paidUpCapital && directors.length === 0) {
    return { source: name, signals: [], error: null, durationMs: 0 };
  }

  return {
    source: name,
    signals: [{
      signalType: 'filings',
      headline: `MCA filings: ${directors.length} director${directors.length === 1 ? '' : 's'}${paidUpCapital ? `, paid-up ${paidUpCapital}` : ''}`,
      url: `https://www.tofler.in/${slug}/company`,
      payload: { paidUpCapital, directors },
      confidence: 0.6,
      signalDate: null,
    }],
    error: null,
    durationMs: 0,
  };
}
