export interface HttpOptions {
  /** The fetch implementation to wrap. Defaults to globalThis.fetch. Override in tests. */
  underlying?: typeof fetch;
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** User-Agent header value. */
  userAgent?: string;
}

const DEFAULT_UA = 'radar-enrich/0.1 (+https://radar.simpleinc.cloud)';

/**
 * Returns a fetch-compatible function with timeout, single retry on 5xx, and a
 * User-Agent header. Composes with externally-provided AbortSignals — if either
 * signal fires, the request aborts.
 */
export function createHttp(opts: HttpOptions = {}): typeof fetch {
  const underlying = opts.underlying ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const ua = opts.userAgent ?? DEFAULT_UA;

  const wrapped: typeof fetch = async (input, init) => {
    const attempt = async (): Promise<Response> => {
      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
      const composed = init?.signal
        ? composeSignals([init.signal, timeoutCtrl.signal])
        : timeoutCtrl.signal;
      const headers = new Headers(init?.headers);
      if (!headers.has('user-agent')) headers.set('user-agent', ua);
      try {
        return await underlying(input, { ...init, signal: composed, headers });
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const first = await attempt();
    if (first.status >= 500 && first.status < 600) {
      // Cancel the first response body so we don't leak the underlying stream.
      await first.body?.cancel().catch(() => {});
      return attempt();
    }
    return first;
  };

  return wrapped;
}

/** Returns a single AbortSignal that fires when ANY of the given signals fires. */
function composeSignals(signals: AbortSignal[]): AbortSignal {
  // Node 20+ has AbortSignal.any; fall back to manual composition for safety.
  const anyCtor = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyCtor === 'function') return anyCtor(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort();
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}
