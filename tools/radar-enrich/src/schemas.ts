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
