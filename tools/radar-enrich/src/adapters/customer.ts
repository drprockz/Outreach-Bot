import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';
import { toHttpsUrl } from '../lib/domainUtils.js';

const SnapshotSchema = z.object({
  url: z.string(),
  timestamp: z.string(),
  waybackUrl: z.string(),
});

const PricingChangeSchema = z.object({
  detectedAt: z.string(),
  previousSnapshotUrl: z.string(),
  currentSnapshotUrl: z.string(),
  changeSummary: z.string(),
});

const HeroChangeSchema = z.object({
  detectedAt: z.string(),
  previousH1: z.string().nullable(),
  currentH1: z.string().nullable(),
  previousFirstParagraph: z.string().nullable(),
  currentFirstParagraph: z.string().nullable(),
});

export const CustomerPayloadSchema = z.object({
  customersPageUrl: z.string().nullable(),
  currentLogos: z.array(z.string()).nullable(),
  snapshotsAnalyzed: z.array(SnapshotSchema),
  addedLogosLast90d: z.array(z.string()),
  removedLogosLast90d: z.array(z.string()),
  pricingChanges: z.array(PricingChangeSchema),
  heroChanges: z.array(HeroChangeSchema),
});

export type CustomerPayload = z.infer<typeof CustomerPayloadSchema>;

export const customerAdapter: Adapter<CustomerPayload> = {
  name: 'customer',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: [],
  schema: CustomerPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<CustomerPayload>> {
    const t0 = Date.now();
    const errors: string[] = [];

    const customersPage = await findCustomersPage(ctx).catch((err) => {
      errors.push(`customers: ${(err as Error).message}`);
      return null;
    });

    let currentLogos: string[] | null = null;
    const snapshotsAnalyzed: CustomerPayload['snapshotsAnalyzed'] = [];
    let addedLogosLast90d: string[] = [];
    let removedLogosLast90d: string[] = [];

    if (customersPage) {
      currentLogos = extractLogos(customersPage.html);
      // Wayback snapshot 90 days back, diff against current
      const ninetyDaysAgo = formatYYYYMMDDhhmmss(new Date(Date.now() - 90 * 86400000));
      const snapshot = await waybackLookup(ctx, customersPage.url, ninetyDaysAgo).catch(() => null);
      if (snapshot) {
        snapshotsAnalyzed.push(snapshot);
        const oldHtml = await ctx.http(snapshot.waybackUrl, { signal: ctx.signal })
          .then((r) => r.ok ? r.text() : null)
          .catch(() => null);
        if (oldHtml) {
          const oldLogos = extractLogos(oldHtml);
          addedLogosLast90d = currentLogos.filter((l) => !oldLogos.includes(l));
          removedLogosLast90d = oldLogos.filter((l) => !currentLogos!.includes(l));
        }
      }
    }

    const pricingChanges = await diffPricing(ctx).catch(() => [] as CustomerPayload['pricingChanges']);
    const heroChanges = await diffHero(ctx).catch(() => [] as CustomerPayload['heroChanges']);

    const haveAnything =
      customersPage !== null ||
      pricingChanges.length > 0 ||
      heroChanges.length > 0;

    if (!haveAnything) {
      return {
        source: 'customer', fetchedAt: new Date().toISOString(),
        status: 'empty', payload: null, errors: errors.length > 0 ? errors : undefined,
        costPaise: 0, durationMs: Date.now() - t0,
      };
    }

    const status = errors.length > 0 ? 'partial' : 'ok';
    return {
      source: 'customer',
      fetchedAt: new Date().toISOString(),
      status,
      payload: {
        customersPageUrl: customersPage?.url ?? null,
        currentLogos,
        snapshotsAnalyzed,
        addedLogosLast90d,
        removedLogosLast90d,
        pricingChanges,
        heroChanges,
      },
      errors: errors.length > 0 ? errors : undefined,
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};

async function findCustomersPage(ctx: AdapterContext): Promise<{ url: string; html: string } | null> {
  const candidates = ['/customers', '/clients', '/case-studies', '/our-customers'];
  for (const path of candidates) {
    const url = toHttpsUrl(ctx.input.domain, path);
    try {
      const res = await ctx.http(url, { signal: ctx.signal });
      if (res.ok) return { url, html: await res.text() };
    } catch { /* try next */ }
  }
  return null;
}

function extractLogos(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  $('img').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').trim();
    const src = $(el).attr('src') ?? '';
    if (alt && alt.length > 1 && alt.length < 80) {
      seen.add(alt);
    } else if (src) {
      // derive from filename: /logos/acme.svg → "acme"
      const name = src.split('/').pop()?.replace(/\.(svg|png|jpe?g|webp)$/i, '');
      if (name && name.length > 1 && name.length < 60) seen.add(name);
    }
  });
  return [...seen];
}

async function waybackLookup(ctx: AdapterContext, url: string, timestamp: string): Promise<CustomerPayload['snapshotsAnalyzed'][number] | null> {
  const lookup = `http://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${timestamp}`;
  const res = await ctx.http(lookup, { signal: ctx.signal });
  if (!res.ok) return null;
  const json = await res.json() as { archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } } };
  const closest = json.archived_snapshots?.closest;
  if (!closest?.available || !closest.url) return null;
  return { url, timestamp: closest.timestamp ?? timestamp, waybackUrl: closest.url };
}

async function diffPricing(ctx: AdapterContext): Promise<CustomerPayload['pricingChanges']> {
  const url = toHttpsUrl(ctx.input.domain, '/pricing');
  const currentRes = await ctx.http(url, { signal: ctx.signal });
  if (!currentRes.ok) return [];
  const currentText = stripText(await currentRes.text());
  const ninetyDaysAgo = formatYYYYMMDDhhmmss(new Date(Date.now() - 90 * 86400000));
  const snap = await waybackLookup(ctx, url, ninetyDaysAgo);
  if (!snap) return [];
  const oldRes = await ctx.http(snap.waybackUrl, { signal: ctx.signal });
  if (!oldRes.ok) return [];
  const oldText = stripText(await oldRes.text());
  if (currentText === oldText) return [];
  return [{
    detectedAt: new Date().toISOString(),
    previousSnapshotUrl: snap.waybackUrl,
    currentSnapshotUrl: url,
    changeSummary: summarizePricingDiff(oldText, currentText),
  }];
}

async function diffHero(ctx: AdapterContext): Promise<CustomerPayload['heroChanges']> {
  const url = toHttpsUrl(ctx.input.domain, '/');
  const currentRes = await ctx.http(url, { signal: ctx.signal });
  if (!currentRes.ok) return [];
  const current = extractHero(await currentRes.text());
  const ninetyDaysAgo = formatYYYYMMDDhhmmss(new Date(Date.now() - 90 * 86400000));
  const snap = await waybackLookup(ctx, url, ninetyDaysAgo);
  if (!snap) return [];
  const oldRes = await ctx.http(snap.waybackUrl, { signal: ctx.signal });
  if (!oldRes.ok) return [];
  const old = extractHero(await oldRes.text());
  if (current.h1 === old.h1 && current.firstParagraph === old.firstParagraph) return [];
  return [{
    detectedAt: new Date().toISOString(),
    previousH1: old.h1, currentH1: current.h1,
    previousFirstParagraph: old.firstParagraph, currentFirstParagraph: current.firstParagraph,
  }];
}

function extractHero(html: string): { h1: string | null; firstParagraph: string | null } {
  const $ = cheerio.load(html);
  const h1 = $('h1').first().text().trim() || null;
  const firstParagraph = $('p').first().text().trim() || null;
  return { h1, firstParagraph };
}

function stripText(html: string): string {
  return cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
}

function summarizePricingDiff(oldText: string, newText: string): string {
  const re = /[$₹]\s?[\d,]+/g;
  const oldPrices = new Set(oldText.match(re) ?? []);
  const newPrices = new Set(newText.match(re) ?? []);
  const added = [...newPrices].filter((p) => !oldPrices.has(p));
  const removed = [...oldPrices].filter((p) => !newPrices.has(p));
  if (added.length === 0 && removed.length === 0) return 'pricing copy changed (no price tokens differ)';
  return `prices changed — added: [${added.join(', ')}], removed: [${removed.join(', ')}]`;
}

function formatYYYYMMDDhhmmss(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}${m}${day}${hh}${mm}${ss}`;
}
