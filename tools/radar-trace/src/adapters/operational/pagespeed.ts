import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';

const MetricsSchema = z.object({
  lcpMs: z.number().nullable(),
  fcpMs: z.number().nullable(),
  cls: z.number().nullable(),
  ttfbMs: z.number().nullable(),
  inpMs: z.number().nullable(),
});

export const OperationalPagespeedPayloadSchema = z.object({
  strategy: z.enum(['mobile', 'desktop']),
  performanceScore: z.number().min(0).max(100),
  metrics: MetricsSchema,
  fetchedFrom: z.enum(['lab', 'field']),
});

export type OperationalPagespeedPayload = z.infer<typeof OperationalPagespeedPayloadSchema>;

type PsiResponse = {
  lighthouseResult?: {
    categories?: {
      performance?: { score?: number };
    };
    audits?: {
      'largest-contentful-paint'?: { numericValue?: number };
      'first-contentful-paint'?: { numericValue?: number };
      'cumulative-layout-shift'?: { numericValue?: number };
      'server-response-time'?: { numericValue?: number };
      'interaction-to-next-paint'?: { numericValue?: number };
    };
  };
  loadingExperience?: Record<string, unknown>;
};

function numOrNull(val: number | undefined): number | null {
  return typeof val === 'number' && isFinite(val) ? val : null;
}

export const operationalPagespeedAdapter: Adapter<OperationalPagespeedPayload> = {
  name: 'operational.pagespeed',
  module: 'operational',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: OperationalPagespeedPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<OperationalPagespeedPayload>> {
    const t0 = Date.now();
    try {
      const targetUrl = toHttpsUrl(ctx.input.domain, '/');
      let apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=mobile&category=performance`;
      if (ctx.env.PAGESPEED_API_KEY) {
        apiUrl += `&key=${encodeURIComponent(ctx.env.PAGESPEED_API_KEY)}`;
      }

      const res = await ctx.http(apiUrl, { signal: ctx.signal });
      if (!res.ok) {
        return {
          source: 'operational.pagespeed',
          fetchedAt: new Date().toISOString(),
          status: 'error',
          payload: null,
          errors: [`pagespeed: http ${res.status}`],
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      const json = await res.json() as PsiResponse;
      const lhr = json.lighthouseResult;
      const audits = lhr?.audits ?? {};

      const rawScore = lhr?.categories?.performance?.score;
      const performanceScore = typeof rawScore === 'number' ? Math.round(rawScore * 100) : 0;

      const metrics = {
        lcpMs: numOrNull(audits['largest-contentful-paint']?.numericValue),
        fcpMs: numOrNull(audits['first-contentful-paint']?.numericValue),
        cls: numOrNull(audits['cumulative-layout-shift']?.numericValue),
        ttfbMs: numOrNull(audits['server-response-time']?.numericValue),
        inpMs: numOrNull(audits['interaction-to-next-paint']?.numericValue),
      };

      const fetchedFrom = json.loadingExperience ? 'field' : 'lab';

      // If all metrics are null, mark as partial
      const hasAnyMetric = Object.values(metrics).some((v) => v !== null);
      const status = hasAnyMetric ? 'ok' : 'partial';

      return {
        source: 'operational.pagespeed',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { strategy: 'mobile', performanceScore, metrics, fetchedFrom },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'operational.pagespeed',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`pagespeed: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
