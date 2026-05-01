import { z } from 'zod';
import * as dnsPromises from 'node:dns/promises';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';
import { toHttpsUrl, normalizeDomain } from '../lib/domainUtils.js';
import { detectTechStack } from '../fingerprints/techstack.js';

const TechSchema = z.object({
  name: z.string(),
  category: z.string(),
  confidence: z.number(),
});

export const OperationalPayloadSchema = z.object({
  techStack: z.array(TechSchema),
  emailProvider: z.string().nullable(),
  knownSaaSVerifications: z.array(z.string()),
  subdomains: z.array(z.string()),
  notableSubdomains: z.array(z.string()),
});

export type OperationalPayload = z.infer<typeof OperationalPayloadSchema>;

export interface DnsResolver {
  resolveMx: (host: string) => Promise<Array<{ exchange: string; priority: number }>>;
  resolveTxt: (host: string) => Promise<string[][]>;
}

const NOTABLE_SUBDOMAIN_RE = /^(app|api|dashboard|admin|beta|staging|portal|console|metrics|grafana|status)\./i;

export function makeOperationalAdapter(dns: DnsResolver): Adapter<OperationalPayload> {
  return {
    name: 'operational',
    version: '0.1.0',
    estimatedCostPaise: 0,
    requiredEnv: [],
    schema: OperationalPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<OperationalPayload>> {
      const t0 = Date.now();
      const errors: string[] = [];

      const homepage = await ctx.http(toHttpsUrl(ctx.input.domain, '/'), { signal: ctx.signal })
        .then((r) => r.ok ? r.text() : null)
        .catch((err) => { errors.push(`homepage: ${(err as Error).message}`); return null; });

      const techStack = homepage ? detectTechStack(homepage) : [];

      const domain = normalizeDomain(ctx.input.domain);
      let emailProvider: string | null = null;
      let knownSaaSVerifications: string[] = [];
      try {
        const mx = await dns.resolveMx(domain);
        emailProvider = inferEmailProvider(mx);
      } catch (err) {
        errors.push(`dns mx: ${(err as Error).message}`);
      }
      try {
        const txt = await dns.resolveTxt(domain);
        knownSaaSVerifications = inferSaasVerifications(txt);
      } catch (err) {
        errors.push(`dns txt: ${(err as Error).message}`);
      }

      let subdomains: string[] = [];
      try {
        subdomains = await fetchCrtSh(ctx, domain);
      } catch (err) {
        errors.push(`crt.sh: ${(err as Error).message}`);
      }
      const notableSubdomains = subdomains.filter((s) => NOTABLE_SUBDOMAIN_RE.test(s));

      const haveAnything = techStack.length > 0 || emailProvider !== null || knownSaaSVerifications.length > 0 || subdomains.length > 0;
      if (!haveAnything) {
        return {
          source: 'operational', fetchedAt: new Date().toISOString(),
          status: 'error', payload: null,
          errors, costPaise: 0, durationMs: Date.now() - t0,
        };
      }

      const status = errors.length > 0 ? 'partial' : 'ok';
      return {
        source: 'operational',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { techStack, emailProvider, knownSaaSVerifications, subdomains, notableSubdomains },
        errors: errors.length > 0 ? errors : undefined,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    },
  };
}

function inferEmailProvider(mx: Array<{ exchange: string; priority: number }>): string | null {
  if (mx.length === 0) return null;
  const lowest = [...mx].sort((a, b) => a.priority - b.priority)[0]!.exchange.toLowerCase();
  if (lowest.includes('google.com') || lowest.includes('googlemail')) return 'Google';
  if (lowest.includes('outlook.com') || lowest.includes('protection.outlook')) return 'Microsoft 365';
  if (lowest.includes('zoho')) return 'Zoho';
  if (lowest.includes('amazonses')) return 'Amazon SES';
  if (lowest.includes('mailgun')) return 'Mailgun';
  if (lowest.includes('postmark')) return 'Postmark';
  if (lowest.includes('sendgrid')) return 'SendGrid';
  return lowest;
}

function inferSaasVerifications(txt: string[][]): string[] {
  const flat = txt.flat().join(' ').toLowerCase();
  const out = new Set<string>();
  if (flat.includes('intercom-domain')) out.add('intercom');
  if (flat.includes('atlassian-domain')) out.add('atlassian');
  if (flat.includes('zendesk-verification')) out.add('zendesk');
  if (flat.includes('hubspot-domain-verification')) out.add('hubspot');
  if (flat.includes('mailchimp')) out.add('mailchimp');
  if (flat.includes('apple-domain-verification')) out.add('apple');
  if (flat.includes('facebook-domain-verification')) out.add('facebook');
  if (flat.includes('stripe')) out.add('stripe');
  return [...out];
}

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

// Default export uses the real DNS resolver
export const operationalAdapter: Adapter<OperationalPayload> = makeOperationalAdapter(dnsPromises);
