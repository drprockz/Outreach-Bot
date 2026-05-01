import { z } from 'zod';
import * as dnsPromises from 'node:dns/promises';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { normalizeDomain } from '../../lib/domainUtils.js';

export interface DnsResolver {
  resolveMx: (host: string) => Promise<Array<{ exchange: string; priority: number }>>;
  resolveTxt: (host: string) => Promise<string[][]>;
}

export const OperationalDnsPayloadSchema = z.object({
  emailProvider: z.string().nullable(),
  knownSaaSVerifications: z.array(z.string()),
});

export type OperationalDnsPayload = z.infer<typeof OperationalDnsPayloadSchema>;

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

export function makeOperationalDnsAdapter(dnsResolver: DnsResolver): Adapter<OperationalDnsPayload> {
  return {
    name: 'operational.dns',
    module: 'operational',
    version: '0.1.0',
    estimatedCostInr: 0,
    estimatedCostPaise: 0,
    requiredEnv: [],
    schema: OperationalDnsPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<OperationalDnsPayload>> {
      const t0 = Date.now();
      const domain = normalizeDomain(ctx.input.domain);
      const errors: string[] = [];

      const [mxRes, txtRes] = await Promise.allSettled([
        dnsResolver.resolveMx(domain),
        dnsResolver.resolveTxt(domain),
      ]);

      let emailProvider: string | null = null;
      if (mxRes.status === 'fulfilled') emailProvider = inferEmailProvider(mxRes.value);
      else errors.push(`dns mx: ${(mxRes.reason as Error).message}`);

      let knownSaaSVerifications: string[] = [];
      if (txtRes.status === 'fulfilled') knownSaaSVerifications = inferSaasVerifications(txtRes.value);
      else errors.push(`dns txt: ${(txtRes.reason as Error).message}`);

      const haveAnything = emailProvider !== null || knownSaaSVerifications.length > 0;
      if (!haveAnything && errors.length > 0) {
        return {
          source: 'operational.dns',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors,
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      const status = errors.length > 0 ? 'partial' : 'ok';
      return {
        source: 'operational.dns',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { emailProvider, knownSaaSVerifications },
        errors: errors.length > 0 ? errors : undefined,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    },
  };
}

// Default export uses the real DNS resolver
export const operationalDnsAdapter: Adapter<OperationalDnsPayload> = makeOperationalDnsAdapter(dnsPromises);
