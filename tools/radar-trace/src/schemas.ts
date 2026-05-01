import { z } from 'zod';
import type { ModuleName } from './types.js';

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
  costMeta: z.object({
    apifyResults: z.number().int().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional(),
  }).optional(),
});

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
export const SignalSummarySchema = z.union([z.null(), z.record(z.unknown())]);

export const RadarTraceDossierSchema = z.object({
  radarTraceVersion: z.string(),
  company: CompanySchema,
  tracedAt: z.string(),
  totalCostInr: z.number().nonnegative(),
  totalCostBreakdown: TotalCostBreakdownSchema,
  totalDurationMs: z.number().int().nonnegative(),
  adapters: z.record(z.string(), AdapterResultSchema),
  modules: ModulesSchema,
  signalSummary: SignalSummarySchema,
});

export type RadarTraceDossier = z.infer<typeof RadarTraceDossierSchema>;
