import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { normalizeDomain } from '../../lib/domainUtils.js';

const NOTABLE_SUBDOMAIN_RE = /^(app|api|dashboard|admin|beta|staging|portal|console|metrics|grafana|status)\./i;

export const OperationalCrtshPayloadSchema = z.object({
  subdomains: z.array(z.string()),
  notableSubdomains: z.array(z.string()),
});

export type OperationalCrtshPayload = z.infer<typeof OperationalCrtshPayloadSchema>;

async function fetchCrtSh(ctx: AdapterContext, domain: string): Promise<string[]> {
  const url = `https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`;
  const res = await ctx.http(url, { signal: ctx.signal });
  if (!res.ok) throw new Error(`crt.sh http ${res.status}`);
  const json = await res.json() as Array<{ name_value: string }>;
  const set = new Set<string>();
  for (const row of json) {
    for (const name of row.name_value.split('\n')) {
      const trimmed = name.trim().toLowerCase();
      if (trimmed && !trimmed.startsWith('*') && trimmed.endsWith(domain)) set.add(trimmed);
    }
  }
  return [...set];
}

export const operationalCrtshAdapter: Adapter<OperationalCrtshPayload> = {
  name: 'operational.crtsh',
  module: 'operational',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  // crt.sh is slow from India (25–50s typical); override global 30s default
  timeoutMs: 60_000,
  schema: OperationalCrtshPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<OperationalCrtshPayload>> {
    const t0 = Date.now();
    const domain = normalizeDomain(ctx.input.domain);
    try {
      const subdomains = await fetchCrtSh(ctx, domain);
      const notableSubdomains = subdomains.filter((s) => NOTABLE_SUBDOMAIN_RE.test(s));
      return {
        source: 'operational.crtsh',
        fetchedAt: new Date().toISOString(),
        status: subdomains.length === 0 ? 'empty' : 'ok',
        payload: { subdomains, notableSubdomains },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'operational.crtsh',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`crtsh: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
