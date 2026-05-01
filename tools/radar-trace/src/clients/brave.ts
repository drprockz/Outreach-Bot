export interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  age: string;
  page_age: string;
  profile?: { name: string };
}

export interface BraveNewsResponse {
  results: BraveNewsResult[];
  costPaise: number;
}

export interface BraveClient {
  newsSearch(opts: { q: string; count?: number; signal?: AbortSignal }): Promise<BraveNewsResponse>;
}

export interface CreateBraveClientOptions {
  apiKey: string;
  http?: typeof fetch;
  /** Cost per call in paise. Default 50 (≈ ₹0.50 / call). */
  costPerCallPaise?: number;
}

export function createBraveClient(opts: CreateBraveClientOptions): BraveClient {
  const http = opts.http ?? globalThis.fetch;
  const costPaise = opts.costPerCallPaise ?? 50;
  return {
    async newsSearch({ q, count = 10, signal }) {
      const url = new URL('https://api.search.brave.com/res/v1/news/search');
      url.searchParams.set('q', q);
      url.searchParams.set('count', String(count));
      const res = await http(url.toString(), {
        method: 'GET',
        headers: {
          'X-Subscription-Token': opts.apiKey,
          'Accept': 'application/json',
        },
        signal,
      });
      if (!res.ok) throw new Error(`brave ${res.status}: ${await res.text().catch(() => '')}`);
      const json = await res.json() as { results?: BraveNewsResult[] };
      return { results: json.results ?? [], costPaise };
    },
  };
}
