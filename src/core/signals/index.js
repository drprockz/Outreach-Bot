import { getEnabledAdapters } from './registry.js';
import { upsertSignals } from './persistence.js';
import { logAdapterFailure } from './errors.js';

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function runAdapter(adapter, lead) {
  const started = Date.now();
  try {
    const res = await withTimeout(adapter.fetch(lead), adapter.timeoutMs);
    return { ...res, durationMs: Date.now() - started };
  } catch (err) {
    logAdapterFailure(adapter.name, err);
    return { source: adapter.name, signals: [], error: err.message, durationMs: Date.now() - started };
  }
}

// Test-only entrypoint — pure function form. Production callers should use collectSignals.
export async function _test_collectSignals(lead, adapters, { persistFn }) {
  if (adapters.length === 0) return [];
  const results = await Promise.allSettled(adapters.map(a => runAdapter(a, lead)));
  const signals = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { source, signals: s } = r.value;
    for (const sig of s) signals.push(sig);
    await persistFn(lead.id, source, s);
  }
  return signals.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Production entrypoint — pulls enabled adapters from env and persists via Prisma.
 * Use when the lead already has a DB id at the time of collection.
 * @param {{id: number}} lead
 * @param {{prisma: import('@prisma/client').PrismaClient}} deps
 */
export async function collectSignals(lead, { prisma }) {
  const adapters = getEnabledAdapters();
  if (adapters.length === 0) return [];
  return _test_collectSignals(
    lead,
    adapters,
    { persistFn: (leadId, source, signals) => upsertSignals(prisma, leadId, source, signals) }
  );
}

/**
 * Gather signals without persisting. Use when the lead doesn't have a DB id yet
 * (e.g. mid-pipeline, before insertLead). Returns both the sorted-by-confidence
 * flat list AND per-source breakdown for later persistence.
 * @param {{id?: number, businessName?: string|null, websiteUrl?: string|null, ...}} lead
 * @returns {Promise<{signals: import('./types.js').Signal[], bySource: Array<{source: string, signals: import('./types.js').Signal[]}>}>}
 */
export async function gatherSignals(lead) {
  const adapters = getEnabledAdapters();
  if (adapters.length === 0) return { signals: [], bySource: [] };
  const results = await Promise.allSettled(adapters.map(a => runAdapter(a, lead)));
  const flat = [];
  const bySource = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { source, signals: s } = r.value;
    bySource.push({ source, signals: s });
    for (const sig of s) flat.push(sig);
  }
  return { signals: flat.sort((a, b) => b.confidence - a.confidence), bySource };
}

/**
 * Persist signals previously gathered via gatherSignals.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} leadId
 * @param {Array<{source: string, signals: import('./types.js').Signal[]}>} bySource
 */
export async function persistSignals(prisma, leadId, bySource) {
  for (const { source, signals } of bySource) {
    await upsertSignals(prisma, leadId, source, signals);
  }
}
