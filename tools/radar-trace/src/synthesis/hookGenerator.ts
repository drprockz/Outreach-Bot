import { toStage10Signals, type SynthesizedContext } from './contextMapper.js';

export interface RegenerateHookResult {
  hook: string;
  costUsd: number;
  model: string;
  hookVariantId: 'A' | 'B';
}

export interface RegenerateHookFn {
  (lead: unknown, persona: unknown, signals: unknown): Promise<RegenerateHookResult>;
}

export interface HookGeneratorDeps {
  regenerateHook: RegenerateHookFn;
}

export interface HookGenerationResult {
  topSignals: string[];
  suggestedHooks: string[];
  totalCostUsd: number;
  errors?: string[];
}

/** Top 5 signals by confidence, formatted as "[signalType] headline". Deterministic. */
export function deriveTopSignals(ctx: SynthesizedContext): string[] {
  return ctx.signals.slice(0, 5).map((s) => `[${s.signalType}] ${s.headline}`);
}

/**
 * Calls Stage 10's regenerateHook 3 times in parallel, gathers candidates,
 * and derives topSignals deterministically. Tolerates per-call failures —
 * partial hook sets are surfaced with an errors[] note.
 */
export async function generateHooks(
  ctx: SynthesizedContext,
  deps: HookGeneratorDeps,
): Promise<HookGenerationResult> {
  const stage10Signals = toStage10Signals(ctx.signals);
  const calls = [0, 1, 2].map(() =>
    deps.regenerateHook(ctx.lead, ctx.persona, stage10Signals)
      .then((r) => ({ ok: true as const, r }))
      .catch((err: Error) => ({ ok: false as const, err })),
  );
  const settled = await Promise.all(calls);

  const suggestedHooks: string[] = [];
  const errors: string[] = [];
  let totalCostUsd = 0;
  for (const s of settled) {
    if (s.ok) {
      suggestedHooks.push(s.r.hook);
      totalCostUsd += s.r.costUsd;
    } else if (!s.ok) {
      errors.push(s.err.message);
    }
  }

  return {
    topSignals: deriveTopSignals(ctx),
    suggestedHooks,
    totalCostUsd,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Default factory that pulls in the real Stage 10 implementation.
 * Imported lazily so tests don't need to load the JS module's transitive deps
 * (Anthropic SDK, etc.) — tests inject a fake `regenerateHook` directly.
 *
 * Path note: Node ESM dynamic import() resolves relative to THIS module's URL
 * (not process.cwd()). From tools/radar-trace/src/synthesis/hookGenerator.ts
 * the relative path to src/core/pipeline/regenerateHook.js is 4 levels up:
 *   synthesis → src → radar-trace → tools → repo-root
 */
export async function loadRealRegenerateHook(): Promise<RegenerateHookFn> {
  const mod = await import('../../../../src/core/pipeline/regenerateHook.js');
  const fn = (mod as { regenerateHook: RegenerateHookFn }).regenerateHook;
  if (typeof fn !== 'function') throw new Error('regenerateHook not exported from src/core/pipeline/regenerateHook.js');
  return fn;
}
