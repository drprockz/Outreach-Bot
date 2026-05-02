import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../../types.js';
import { toHttpsUrl } from '../../lib/domainUtils.js';

export const OperationalRobotsTxtPayloadSchema = z.object({
  raw: z.string(),
  userAgents: z.array(z.string()),
  disallows: z.array(z.string()),
  stackHints: z.array(z.string()),
  hasSitemap: z.boolean(),
});

export type OperationalRobotsTxtPayload = z.infer<typeof OperationalRobotsTxtPayloadSchema>;

const MAX_RAW_BYTES = 5 * 1024; // 5KB

interface StackHintPattern {
  name: string;
  patterns: RegExp[];
}

const STACK_HINT_PATTERNS: StackHintPattern[] = [
  {
    name: 'wordpress',
    patterns: [/\/wp-admin/i, /\/wp-includes/i, /\/wp-content/i],
  },
  {
    name: 'shopify',
    patterns: [/\/checkout/i, /\/cart/i, /\/collections/i, /\/products\//i],
  },
  {
    name: 'wix',
    patterns: [/\/_partials/i, /\/wix-/i, /\/pages\//i],
  },
  {
    name: 'webflow',
    patterns: [/webflow\.com/i, /\/webflow-/i],
  },
  {
    name: 'admin',
    patterns: [/\/admin\//i, /\/administrator\//i, /\/backend\//i],
  },
];

function detectStackHints(disallows: string[]): string[] {
  const hints = new Set<string>();
  for (const pattern of STACK_HINT_PATTERNS) {
    for (const disallow of disallows) {
      if (pattern.patterns.some((re) => re.test(disallow))) {
        hints.add(pattern.name);
        break;
      }
    }
  }
  return [...hints].sort();
}

function parseRobotsTxt(raw: string): {
  userAgents: string[];
  disallows: string[];
  hasSitemap: boolean;
} {
  const lines = raw.split('\n').map((l) => l.trim());
  const userAgents = new Set<string>();
  const disallows = new Set<string>();
  let hasSitemap = false;

  for (const line of lines) {
    if (line.startsWith('#') || !line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'user-agent' && value) {
      userAgents.add(value);
    } else if (key === 'disallow' && value) {
      disallows.add(value);
    } else if (key === 'sitemap' && value) {
      hasSitemap = true;
    }
  }

  return {
    userAgents: [...userAgents].sort(),
    disallows: [...disallows].sort(),
    hasSitemap,
  };
}

export const operationalRobotsTxtAdapter: Adapter<OperationalRobotsTxtPayload> = {
  name: 'operational.robots_txt',
  module: 'operational',
  version: '0.1.0',
  estimatedCostInr: 0,
  requiredEnv: [],
  schema: OperationalRobotsTxtPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<OperationalRobotsTxtPayload>> {
    const t0 = Date.now();
    try {
      const url = toHttpsUrl(ctx.input.domain, '/robots.txt');
      const res = await ctx.http(url, { signal: ctx.signal });

      if (!res.ok) {
        return {
          source: 'operational.robots_txt',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { raw: '', userAgents: [], disallows: [], stackHints: [], hasSitemap: false },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }

      const fullText = await res.text();
      // Reject HTML served for unknown paths (e.g. index.php catch-all).
      // A real robots.txt must contain at least one of the standard directives.
      const looksLikeRobots = fullText.includes('User-agent:') ||
        fullText.includes('Disallow:') ||
        fullText.includes('Sitemap:');
      if (!looksLikeRobots) {
        return {
          source: 'operational.robots_txt',
          fetchedAt: new Date().toISOString(),
          status: 'empty',
          payload: { raw: '', userAgents: [], disallows: [], stackHints: [], hasSitemap: false },
          costPaise: 0,
          durationMs: Date.now() - t0,
        };
      }
      const raw = fullText.slice(0, MAX_RAW_BYTES);
      const { userAgents, disallows, hasSitemap } = parseRobotsTxt(raw);
      const stackHints = detectStackHints(disallows);

      return {
        source: 'operational.robots_txt',
        fetchedAt: new Date().toISOString(),
        status: 'ok',
        payload: { raw, userAgents, disallows, stackHints, hasSitemap },
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        source: 'operational.robots_txt',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors: [`robots_txt: ${(err as Error).message}`],
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }
  },
};
