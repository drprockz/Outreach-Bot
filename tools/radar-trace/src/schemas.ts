import { z } from 'zod';
import type { ModuleName } from './types.js';

export const AdapterStatusSchema = z.enum(['ok', 'partial', 'empty', 'error']);

export const AdapterVerificationSchema = z.object({
  method: z.enum(['anchor', 'llm', 'none']),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  droppedCandidates: z.number().int().nonnegative().optional(),
});

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
  verification: AdapterVerificationSchema.optional(),
});

export const AnchorFounderSchema = z.object({
  name: z.string(),
  title: z.string().nullable(),
  linkedinUrl: z.string().url().nullable(),
});

export const CanonicalAnchorsSchema = z.object({
  linkedinCompanyUrl: z.string().url().nullable(),
  twitterUrl: z.string().url().nullable(),
  youtubeChannelUrl: z.string().url().nullable(),
  githubOrgUrl: z.string().url().nullable(),
  crunchbaseUrl: z.string().url().nullable(),
  instagramUrl: z.string().url().nullable(),
  facebookUrl: z.string().url().nullable(),
  founders: z.array(AnchorFounderSchema),
  companyDescription: z.string().nullable(),
  primaryProductOrService: z.string().nullable(),
  industryOneLiner: z.string().nullable(),
  pagesFetched: z.array(z.string()),
  discoveredVia: z.enum(['gemini', 'regex', 'mixed', 'none']),
  costPaise: z.number().int().nonnegative(),
  errors: z.array(z.string()),
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
  geminiAnchorsInr: z.number().nonnegative(),
  haikuVerifyInr: z.number().nonnegative(),
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
  /** Canonical anchors discovered from the company's own website. Always present. */
  anchors: CanonicalAnchorsSchema,
  /**
   * `verified` when both anchor discovery (Gemini) and verification (Haiku)
   * had API keys available. `degraded` when one or both fell back to regex /
   * unverified output — the trace still completes but is more permissive.
   */
  traceMode: z.enum(['verified', 'degraded']),
});

export type RadarTraceDossier = z.infer<typeof RadarTraceDossierSchema>;
