import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';

export const OperationalWhoisPayloadSchema = z.object({
  domain: z.string(),
  registrar: z.string().nullable(),
  registeredOn: z.string().nullable(),
  expiresOn: z.string().nullable(),
  ageDays: z.number().int().nullable(),
  status: z.array(z.string()),
  nameservers: z.array(z.string()),
});

export type OperationalWhoisPayload = z.infer<typeof OperationalWhoisPayloadSchema>;

// 30 days — registration data changes rarely
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type RdapEvent = {
  eventAction?: string;
  eventDate?: string;
};

type RdapEntity = {
  roles?: string[];
  vcardArray?: [string, Array<[string, Record<string, unknown>, string, string]>];
};

type RdapResponse = {
  ldhName?: string;
  status?: string[];
  events?: RdapEvent[];
  nameservers?: Array<{ ldhName?: string }>;
  entities?: RdapEntity[];
};

function extractRegistrar(entities: RdapEntity[]): string | null {
  for (const entity of entities) {
    if (!entity.roles?.includes('registrar')) continue;
    if (!entity.vcardArray) continue;
    const vcard = entity.vcardArray[1];
    for (const field of vcard) {
      if (field[0] === 'fn' && field[3]) {
        return field[3];
      }
    }
  }
  return null;
}

function getEventDate(events: RdapEvent[], action: string): string | null {
  const event = events.find((e) => e.eventAction === action);
  if (!event?.eventDate) return null;
  // Normalize to ISO string
  try {
    return new Date(event.eventDate).toISOString();
  } catch {
    return event.eventDate;
  }
}

function computeAgeDays(registeredOn: string | null): number | null {
  if (!registeredOn) return null;
  try {
    const reg = new Date(registeredOn).getTime();
    if (isNaN(reg)) return null;
    return Math.floor((Date.now() - reg) / 86400000);
  } catch {
    return null;
  }
}

export const operationalWhoisAdapter: Adapter<OperationalWhoisPayload> = {
  name: 'operational.whois',
  module: 'operational',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  cacheTtlMs: CACHE_TTL_MS,
  schema: OperationalWhoisPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<OperationalWhoisPayload>> {
    const t0 = Date.now();
    try {
      const domain = ctx.input.domain.replace(/^www\./, '').toLowerCase();
      const url = `https://rdap.org/domain/${domain}`;
      const res = await ctx.http(url, { signal: ctx.signal });

      if (!res.ok) {
        return {
          source: 'operational.whois',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`whois: rdap http ${res.status}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      const json = await res.json() as RdapResponse;
      const events = json.events ?? [];
      const entities = json.entities ?? [];
      const registeredOn = getEventDate(events, 'registration');
      const expiresOn = getEventDate(events, 'expiration');
      const ageDays = computeAgeDays(registeredOn);

      const payload: OperationalWhoisPayload = {
        domain: json.ldhName?.toLowerCase() ?? domain,
        registrar: extractRegistrar(entities),
        registeredOn,
        expiresOn,
        ageDays,
        status: json.status ?? [],
        nameservers: (json.nameservers ?? [])
          .map((ns) => ns.ldhName?.toLowerCase())
          .filter((ns): ns is string => !!ns),
      };

      return {
        source: 'operational.whois',
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        payload,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'operational.whois',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`whois: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
