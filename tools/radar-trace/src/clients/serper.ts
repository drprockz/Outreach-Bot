export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
}

export interface SerperNewsResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;
}

export interface SerperSearchResponse {
  organic: SerperOrganicResult[];
  costPaise: number;
}

export interface SerperNewsResponse {
  news: SerperNewsResult[];
  costPaise: number;
}

export interface SerperClient {
  search(opts: { q: string; gl?: string; hl?: string; num?: number; signal?: AbortSignal }): Promise<SerperSearchResponse>;
  newsSearch(opts: { q: string; gl?: string; signal?: AbortSignal }): Promise<SerperNewsResponse>;
}

export interface CreateSerperClientOptions {
  apiKey: string;
  http?: typeof fetch;
  /** Cost per call in paise. Default 3 (≈ ₹0.03 / call, slightly conservative). */
  costPerCallPaise?: number;
}

export function createSerperClient(opts: CreateSerperClientOptions): SerperClient {
  const http = opts.http ?? globalThis.fetch;
  const costPaise = opts.costPerCallPaise ?? 3;
  return {
    async search({ q, gl = 'in', hl = 'en', num = 10, signal }) {
      const res = await http('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ q, gl, hl, num }),
        signal,
      });
      if (!res.ok) throw new Error(`serper ${res.status}: ${await res.text().catch(() => '')}`);
      const json = await res.json() as { organic?: SerperOrganicResult[] };
      return { organic: json.organic ?? [], costPaise };
    },
    async newsSearch({ q, gl = 'in', signal }) {
      const res = await http('https://google.serper.dev/news', {
        method: 'POST',
        headers: { 'x-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ q, gl }),
        signal,
      });
      if (!res.ok) throw new Error(`serper ${res.status}: ${await res.text().catch(() => '')}`);
      const json = await res.json() as { news?: SerperNewsResult[] };
      return { news: json.news ?? [], costPaise };
    },
  };
}
