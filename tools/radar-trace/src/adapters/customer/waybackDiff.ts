/**
 * customer.wayback_diff — diffs logos, pricing, and hero copy against a 90-day-old
 * Wayback Machine snapshot.
 *
 * Note: both logos_current and wayback_diff call findCustomersPage independently.
 * The redundancy is acceptable for Phase 1A — both adapters cache, so on a second run
 * within 24h only one network fetch happens (first populates cache, second hits it).
 * wayback_diff could read its sibling's cached payload, but that creates Wave 1/Wave 2
 * ordering concerns we want to avoid.
 */
import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';
import { findCustomersPage, extractLogos } from './logosCurrent.js';

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

export const CustomerWaybackDiffPayloadSchema = z.object({
  snapshotsAnalyzed: z.array(SnapshotSchema),
  addedLogosLast90d: z.array(z.string()),
  removedLogosLast90d: z.array(z.string()),
  pricingChanges: z.array(PricingChangeSchema),
  heroChanges: z.array(HeroChangeSchema),
});

export type CustomerWaybackDiffPayload = z.infer<typeof CustomerWaybackDiffPayloadSchema>;
type Snapshot = z.infer<typeof SnapshotSchema>;
type PricingChange = z.infer<typeof PricingChangeSchema>;
type HeroChange = z.infer<typeof HeroChangeSchema>;

function formatYYYYMMDDhhmmss(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}${m}${day}${hh}${mm}${ss}`;
}

async function waybackLookup(ctx: AdapterContext, url: string, timestamp: string): Promise<Snapshot | null> {
  const lookup = `http://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${timestamp}`;
  const res = await ctx.http(lookup, { signal: ctx.signal });
  if (!res.ok) return null;
  const json = await res.json() as { archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } } };
  const closest = json.archived_snapshots?.closest;
  if (!closest?.available || !closest.url) return null;
  return { url, timestamp: closest.timestamp ?? timestamp, waybackUrl: closest.url };
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

async function diffPricing(ctx: AdapterContext): Promise<PricingChange[]> {
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

async function diffHero(ctx: AdapterContext): Promise<HeroChange[]> {
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

export const customerWaybackDiffAdapter: Adapter<CustomerWaybackDiffPayload> = {
  name: 'customer.wayback_diff',
  module: 'customer',
  version: '0.1.0',
  estimatedCostInr: 0,
  cacheTtlMs: 7 * 24 * 60 * 60 * 1000,  // 7 days per spec
  requiredEnv: [],
  schema: CustomerWaybackDiffPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<CustomerWaybackDiffPayload>> {
    const t0 = Date.now();
    const errors: string[] = [];

    const customersPage = await findCustomersPage(ctx).catch((err) => {
      errors.push(`customers: ${(err as Error).message}`);
      return null;
    });

    const snapshotsAnalyzed: Snapshot[] = [];
    let addedLogosLast90d: string[] = [];
    let removedLogosLast90d: string[] = [];

    if (customersPage) {
      const currentLogos = extractLogos(customersPage.html);
      const ninetyDaysAgo = formatYYYYMMDDhhmmss(new Date(Date.now() - 90 * 86400000));
      const snapshot = await waybackLookup(ctx, customersPage.url, ninetyDaysAgo).catch(() => null);
      if (snapshot) {
        snapshotsAnalyzed.push(snapshot);
        const oldHtml = await ctx.http(snapshot.waybackUrl, { signal: ctx.signal })
          .then((r) => r.ok ? r.text() : null)
          .catch(() => null);
        if (oldHtml) {
          const oldLogos = extractLogos(oldHtml);
          // Case-insensitive diff so "Acme" (current alt) and "acme" (old filename stem)
          // don't surface as a spurious add/remove pair.
          const oldLower = new Set(oldLogos.map((l) => l.toLowerCase()));
          const currentLower = new Set(currentLogos.map((l) => l.toLowerCase()));
          addedLogosLast90d = currentLogos.filter((l) => !oldLower.has(l.toLowerCase()));
          removedLogosLast90d = oldLogos.filter((l) => !currentLower.has(l.toLowerCase()));
        }
      }
    }

    const pricingChanges = await diffPricing(ctx).catch(() => [] as PricingChange[]);
    const heroChanges = await diffHero(ctx).catch(() => [] as HeroChange[]);

    const haveAnything =
      customersPage !== null ||
      pricingChanges.length > 0 ||
      heroChanges.length > 0;

    if (!haveAnything) {
      return {
        source: 'customer.wayback_diff',
        fetchedAt: new Date().toISOString(),
        status: 'empty',
        payload: { snapshotsAnalyzed: [], addedLogosLast90d: [], removedLogosLast90d: [], pricingChanges: [], heroChanges: [] },
        errors: errors.length > 0 ? errors : undefined,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }

    const status = errors.length > 0 ? 'partial' : 'ok';
    return {
      source: 'customer.wayback_diff',
      fetchedAt: new Date().toISOString(),
      status,
      payload: { snapshotsAnalyzed, addedLogosLast90d, removedLogosLast90d, pricingChanges, heroChanges },
      errors: errors.length > 0 ? errors : undefined,
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};
