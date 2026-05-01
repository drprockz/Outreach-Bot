/**
 * directories.zaubacorp — Tofler India MCA/ZaubaCorp company filings scrape.
 *
 * Scrapes https://www.tofler.in/{slug}/company to extract MCA-registered data:
 * CIN, incorporation date, capital, directors, registered address.
 *
 * Anti-bot note: Tofler uses Cloudflare. On production traffic you will see
 * frequent 403/429 responses. The adapter returns status:'error' in that case —
 * this is expected and non-fatal. Data is cached for 7 days to reduce rate-limit
 * pressure.
 *
 * This adapter is India-only; `country` is hardcoded to 'India'.
 * `directories.glassdoor_apify` uses `payload.country !== 'India'` as its gate
 * predicate — Tofler's presence in the dossier confirms the company is Indian.
 *
 * Ported from src/core/signals/adapters/corpFilings.js (legacy signal adapter).
 */
import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';

const DirectorSchema = z.object({
  name: z.string(),
  din: z.string().nullable(),
  appointedOn: z.string().nullable(),
});

export const ZaubacorpPayloadSchema = z.object({
  toflerUrl: z.string().url().nullable(),
  cin: z.string().nullable(),
  registeredOn: z.string().nullable(),
  registrar: z.string().nullable(),
  status: z.string().nullable(),
  paidUpCapitalInr: z.number().nullable(),
  authorizedCapitalInr: z.number().nullable(),
  directors: z.array(DirectorSchema),
  registeredAddress: z.string().nullable(),
  country: z.literal('India'),
});

export type ZaubacorpPayload = z.infer<typeof ZaubacorpPayloadSchema>;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Parse an Indian capital string like "Rs. 10,00,000" → number (10_00_000 = 1000000). */
function parseCapitalInr(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9]/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

/** Try to normalise dates like "15 Mar 2018" → "2018-03-15". Falls back to raw string. */
function normaliseDate(raw: string): string | null {
  if (!raw.trim()) return null;
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) {
    const [, day, mon, year] = m;
    const mm = months[mon!.toLowerCase()];
    if (mm) return `${year}-${mm}-${day!.padStart(2, '0')}`;
  }
  return raw.trim() || null;
}

export function parseToflerPage(html: string, toflerUrl: string): ZaubacorpPayload {
  const $ = cheerio.load(html);

  let cin: string | null = null;
  let registeredOn: string | null = null;
  let registrar: string | null = null;
  let status: string | null = null;
  let paidUpCapitalInr: number | null = null;
  let authorizedCapitalInr: number | null = null;
  let registeredAddress: string | null = null;

  // Tofler renders a <th>label</th><td>value</td> table pattern
  $('th, td').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag !== 'th') return;
    const label = $(el).text().trim().toLowerCase();
    const value = $(el).next('td').text().replace(/\s+/g, ' ').trim();
    if (!value) return;

    if (/^cin$/.test(label)) {
      cin = value;
    } else if (/date of incorporation/.test(label)) {
      registeredOn = normaliseDate(value);
    } else if (/registrar of companies/.test(label)) {
      registrar = value;
    } else if (/company status/.test(label)) {
      status = value;
    } else if (/authorized capital/.test(label)) {
      authorizedCapitalInr = parseCapitalInr(value);
    } else if (/paid.?up capital/.test(label)) {
      paidUpCapitalInr = parseCapitalInr(value);
    } else if (/registered address/.test(label)) {
      registeredAddress = value;
    }
  });

  // Directors table: rows with .director-name, .director-din, .director-appointed
  const directors: ZaubacorpPayload['directors'] = [];
  $('table').each((_, table) => {
    $(table).find('tr').each((_, row) => {
      const nameEl = $(row).find('.director-name');
      if (!nameEl.length) return;
      const name = nameEl.text().trim();
      if (!name) return;
      const din = $(row).find('.director-din').text().trim() || null;
      const rawAppointed = $(row).find('.director-appointed').text().trim();
      directors.push({
        name,
        din: din || null,
        appointedOn: rawAppointed ? normaliseDate(rawAppointed) : null,
      });
    });
  });

  return {
    toflerUrl,
    cin,
    registeredOn,
    registrar,
    status,
    paidUpCapitalInr,
    authorizedCapitalInr,
    directors,
    registeredAddress,
    country: 'India',
  };
}

export const zaubacorpAdapter: Adapter<ZaubacorpPayload> = {
  name: 'directories.zaubacorp',
  module: 'directories',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  cacheTtlMs: 7 * 86_400_000,
  schema: ZaubacorpPayloadSchema,

  async run(ctx: AdapterContext): Promise<AdapterResult<ZaubacorpPayload>> {
    const t0 = Date.now();
    const slug = slugify(ctx.input.name);
    const toflerUrl = `https://www.tofler.in/${slug}/company`;

    try {
      const res = await ctx.http(toflerUrl, {
        signal: ctx.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; radar-trace/1.0)' },
      });

      if (res.status === 403 || res.status === 429) {
        return {
          source: 'directories.zaubacorp',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`zaubacorp: Tofler anti-bot block (HTTP ${res.status}) — expected on production traffic`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      if (!res.ok) {
        return {
          source: 'directories.zaubacorp',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`zaubacorp: HTTP ${res.status}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      const html = await res.text();
      const payload = parseToflerPage(html, toflerUrl);

      const hasData = payload.cin || payload.directors.length > 0 || payload.status;
      return {
        source: 'directories.zaubacorp',
        fetchedAt: new Date().toISOString(),
        status: hasData ? 'ok' : 'empty',
        payload,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'directories.zaubacorp',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`zaubacorp: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
