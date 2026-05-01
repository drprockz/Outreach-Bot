/**
 * ApifyClient — thin wrapper around Apify's run-sync-get-dataset-items API.
 *
 * POST https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token={TOKEN}
 *
 * Apify holds the HTTP connection open until the run completes (typically 5–90s).
 * The response body is a JSON array of dataset rows — exactly what we need, no
 * polling required.
 *
 * Cost accounting: the caller passes `costPerResultUsd`; we multiply by the number
 * of items we kept (after slicing to `maxResults`). A `truncated` flag is set when
 * the actor returned more than `maxResults`, so callers know the dataset was capped.
 */

export interface ApifyClient {
  runActor<T>(opts: {
    actor: string;                   // e.g. 'apimaestro/linkedin-profile-posts'
    input: Record<string, unknown>;  // actor-specific input JSON
    costPerResultUsd: number;        // e.g. 0.005 for $5/1000 results
    maxResults?: number;             // safety cap; default 100
    signal?: AbortSignal;
    timeoutMs?: number;              // default 90000 ms
  }): Promise<{ items: T[]; costUsd: number; truncated: boolean }>;
}

export interface CreateApifyClientOptions {
  token: string;
  http?: typeof fetch;
}

export function createApifyClient(opts: CreateApifyClientOptions): ApifyClient {
  const http = opts.http ?? globalThis.fetch;

  return {
    async runActor<T>({ actor, input, costPerResultUsd, maxResults = 100, signal, timeoutMs = 90_000 }) {
      // Build URL with token in query string (Apify standard auth mechanism)
      const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${encodeURIComponent(opts.token)}`;

      // Use caller-provided signal or create one from timeoutMs
      let abortCtrl: AbortController | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let effectiveSignal = signal;

      if (!signal) {
        abortCtrl = new AbortController();
        timer = setTimeout(() => abortCtrl!.abort(new Error(`Apify timeout after ${timeoutMs}ms`)), timeoutMs);
        effectiveSignal = abortCtrl.signal;
      }

      let res: Response;
      try {
        res = await http(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: effectiveSignal,
        });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`apify ${res.status}: ${text}`);
      }

      const raw = await res.json() as unknown[];

      const truncated = raw.length > maxResults;
      const items = (truncated ? raw.slice(0, maxResults) : raw) as T[];
      const costUsd = items.length * costPerResultUsd;

      return { items, costUsd, truncated };
    },
  };
}
