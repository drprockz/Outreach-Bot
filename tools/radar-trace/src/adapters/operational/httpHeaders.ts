import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';

export const OperationalHttpHeadersPayloadSchema = z.object({
  server: z.string().nullable(),
  xPoweredBy: z.string().nullable(),
  contentSecurityPolicy: z.string().nullable(),
  strictTransportSecurity: z.string().nullable(),
  xFrameOptions: z.string().nullable(),
  xContentTypeOptions: z.string().nullable(),
  referrerPolicy: z.string().nullable(),
  permissionsPolicy: z.string().nullable(),
  cacheControl: z.string().nullable(),
});

export type OperationalHttpHeadersPayload = z.infer<typeof OperationalHttpHeadersPayloadSchema>;

function extractHeaders(headers: Headers): OperationalHttpHeadersPayload {
  return {
    server: headers.get('server'),
    xPoweredBy: headers.get('x-powered-by'),
    contentSecurityPolicy: headers.get('content-security-policy'),
    strictTransportSecurity: headers.get('strict-transport-security'),
    xFrameOptions: headers.get('x-frame-options'),
    xContentTypeOptions: headers.get('x-content-type-options'),
    referrerPolicy: headers.get('referrer-policy'),
    permissionsPolicy: headers.get('permissions-policy'),
    cacheControl: headers.get('cache-control'),
  };
}

export const operationalHttpHeadersAdapter: Adapter<OperationalHttpHeadersPayload> = {
  name: 'operational.http_headers',
  module: 'operational',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: OperationalHttpHeadersPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<OperationalHttpHeadersPayload>> {
    const t0 = Date.now();
    try {
      const url = toHttpsUrl(ctx.input.domain, '/');

      // Try HEAD first; fall back to GET if 405 Method Not Allowed
      let res = await ctx.http(url, { method: 'HEAD', signal: ctx.signal });
      if (res.status === 405) {
        res = await ctx.http(url, { method: 'GET', signal: ctx.signal });
      }

      if (!res.ok && res.status !== 405) {
        // Even on non-2xx we may still get useful headers; only bail on complete failure
        if (res.status >= 500) {
          return {
            source: 'operational.http_headers',
            fetchedAt: new Date().toISOString(),
            status: 'error',
            payload: null,
            errors: [`http_headers: http ${res.status}`],
            costPaise: 0,
            durationMs: Date.now() - t0,
          };
        }
      }

      const payload = extractHeaders(res.headers);

      return {
        source: 'operational.http_headers',
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        payload,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'operational.http_headers',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`http_headers: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
