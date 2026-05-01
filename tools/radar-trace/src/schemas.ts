import { z } from 'zod';

export const CompanyInputSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  location: z.string().optional(),
  founder: z.string().optional(),
});

export const AdapterStatusSchema = z.enum(['ok', 'partial', 'empty', 'error']);

/** Generic envelope — payload is z.unknown here; per-adapter schemas validate the inner shape separately. */
export const AdapterResultSchema = z.object({
  source: z.string(),
  fetchedAt: z.string(),
  status: AdapterStatusSchema,
  payload: z.unknown(),
  errors: z.array(z.string()).optional(),
  costPaise: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

const SynthesizedContextSchema = z.object({
  lead: z.object({
    business_name: z.string(),
    website_url: z.string(),
    manual_hook_note: z.string().nullable(),
  }),
  persona: z.object({ role: z.string() }),
  signals: z.array(z.object({
    signalType: z.string(),
    headline: z.string(),
    url: z.string().optional(),
  })),
});

export const SignalSummarySchema = z.object({
  topSignals: z.array(z.string()),
  suggestedHooks: z.array(z.string()),
  totalCostUsd: z.number().nonnegative(),
  _debug: z.object({
    synthesizedContext: SynthesizedContextSchema,
    stage10: z.object({ path: z.string(), gitSha: z.string() }),
  }).optional(),
});

export const ModulesBlockSchema = z.object({
  hiring:      AdapterResultSchema,
  product:     AdapterResultSchema,
  customer:    AdapterResultSchema,
  voice:       AdapterResultSchema,
  operational: AdapterResultSchema,
  positioning: AdapterResultSchema,
});

export const EnrichedDossierSchema = z.object({
  company: CompanyInputSchema,
  enrichedAt: z.string(),
  totalCostPaise: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  modules: ModulesBlockSchema,
  signalSummary: SignalSummarySchema,
});

export type EnrichedDossier = z.infer<typeof EnrichedDossierSchema>;
export type SignalSummary = z.infer<typeof SignalSummarySchema>;

// ========== NEW PHASE 1A EXPORTS (Chunk 1) ==========

import type { ModuleName } from './types.js';

export const ALL_MODULE_NAMES: readonly ModuleName[] = [
  'hiring', 'product', 'customer', 'voice', 'operational',
  'positioning', 'social', 'ads', 'directories',
] as const;

export const CompanySchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  location: z.string().optional(),
  founder: z.string().optional(),
  founderLinkedinUrl: z.string().url().optional(),
});

// Note: AdapterResultSchema already exists from Chunk 0 (radar-enrich). We add
// costMeta as an optional field via .extend() rather than replacing the export.
// In Chunk 2 we'll consolidate.
export const AdapterResultSchemaV2 = AdapterResultSchema.extend({
  costMeta: z.object({
    apifyResults: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
  }).optional(),
});

const TotalCostBreakdownSchema = z.object({
  serper: z.number().nonnegative(),
  brave: z.number().nonnegative(),
  listenNotes: z.number().nonnegative(),
  pagespeed: z.number().nonnegative(),
  apifyUsd: z.number().nonnegative(),
  apifyInr: z.number().nonnegative(),
});

const ModuleBlockSchema = z.object({
  adapters: z.array(z.string()),
});

const ModulesSchema = z.object(
  Object.fromEntries(ALL_MODULE_NAMES.map((n) => [n, ModuleBlockSchema])) as
    Record<ModuleName, typeof ModuleBlockSchema>,
);

/** Phase 2 deliverable; Phase 1A allows null. Accepts unknown object for forward-compat. */
const SignalSummarySchemaV2 = z.union([z.null(), z.record(z.unknown())]);

export const RadarTraceDossierSchema = z.object({
  radarTraceVersion: z.string(),
  company: CompanySchema,
  tracedAt: z.string(),
  totalCostInr: z.number().nonnegative(),
  totalCostBreakdown: TotalCostBreakdownSchema,
  totalDurationMs: z.number().int().nonnegative(),
  adapters: z.record(z.string(), AdapterResultSchemaV2),
  modules: ModulesSchema,
  signalSummary: SignalSummarySchemaV2,
});

export type RadarTraceDossier = z.infer<typeof RadarTraceDossierSchema>;
