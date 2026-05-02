import { describe, it, expect, vi } from 'vitest';
import { discoverAnchors } from '../../src/lib/anchors.js';
import type { GeminiClient } from '../../src/lib/ai/gemini.js';
import type { Env } from '../../src/types.js';

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

const HOMEPAGE_HTML = `<!doctype html>
<html><body>
<header><h1>Acme Inc</h1></header>
<footer>
  <a href="https://www.linkedin.com/company/acme-inc">LinkedIn</a>
  <a href="https://twitter.com/acme">Twitter</a>
  <a href="https://github.com/acme">GitHub</a>
  <a href="https://www.crunchbase.com/organization/acme-inc">Crunchbase</a>
</footer>
</body></html>`;

const ABOUT_HTML = `<!doctype html>
<html><body>
<h2>About Acme</h2>
<p>Acme Inc builds developer tooling for B2B SaaS teams.</p>
<h3>Team</h3>
<p>Founded by Jane Doe. <a href="https://www.linkedin.com/in/jane-doe-acme">Jane on LinkedIn</a>.</p>
</body></html>`;

function makeHttp(map: Record<string, Response>): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const u = typeof url === 'string' ? url : (url instanceof URL ? url.toString() : url.url);
    if (map[u]) return map[u]!;
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

function fakeGemini(payload: unknown): GeminiClient {
  return {
    call: vi.fn(async () => ({
      text: typeof payload === 'string' ? payload : JSON.stringify(payload),
      costUsd: 0.0003,
      inputTokens: 800,
      outputTokens: 80,
    })),
  };
}

const env: Env = { GEMINI_API_KEY: 'fake' };

describe('discoverAnchors', () => {
  it('extracts canonical URLs from regex when LLM is disabled', async () => {
    const http = makeHttp({
      'https://acme.com/': htmlResponse(HOMEPAGE_HTML),
      'https://acme.com/about': htmlResponse(ABOUT_HTML),
    });
    const r = await discoverAnchors({
      domain: 'acme.com',
      companyName: 'Acme Inc',
      env: {},
      http,
      useLlm: false,
    });
    expect(r.linkedinCompanyUrl).toBe('https://www.linkedin.com/company/acme-inc');
    expect(r.twitterUrl).toBe('https://twitter.com/acme');
    expect(r.githubOrgUrl).toBe('https://github.com/acme');
    expect(r.crunchbaseUrl).toBe('https://www.crunchbase.com/organization/acme-inc');
    expect(r.discoveredVia).toBe('regex');
    expect(r.costPaise).toBe(0);
    expect(r.pagesFetched).toContain('https://acme.com/');
  });

  it('merges LLM-derived founders and description with regex URLs', async () => {
    const http = makeHttp({
      'https://acme.com/': htmlResponse(HOMEPAGE_HTML),
      'https://acme.com/about': htmlResponse(ABOUT_HTML),
    });
    const gemini = fakeGemini({
      linkedinCompanyUrl: 'https://www.linkedin.com/company/acme-inc',
      twitterUrl: null,
      youtubeChannelUrl: null,
      githubOrgUrl: 'https://github.com/acme',
      crunchbaseUrl: null,
      instagramUrl: null,
      facebookUrl: null,
      founders: [
        { name: 'Jane Doe', title: 'Founder', linkedinUrl: 'https://www.linkedin.com/in/jane-doe-acme' },
      ],
      companyDescription: 'Acme Inc builds developer tooling for B2B SaaS teams.',
      primaryProductOrService: 'Developer tooling',
      industryOneLiner: 'Devtools for SaaS teams',
    });
    const r = await discoverAnchors({
      domain: 'acme.com',
      companyName: 'Acme Inc',
      env,
      http,
      gemini,
    });
    expect(r.discoveredVia).toBe('mixed');
    expect(r.companyDescription).toContain('developer tooling');
    expect(r.founders).toHaveLength(1);
    expect(r.founders[0]!.linkedinUrl).toBe('https://www.linkedin.com/in/jane-doe-acme');
    expect(r.linkedinCompanyUrl).toBe('https://www.linkedin.com/company/acme-inc');
    expect(r.twitterUrl).toBe('https://twitter.com/acme'); // regex won; LLM had null
  });

  it('falls back to regex when Gemini returns invalid JSON, surfaces error in errors[]', async () => {
    const http = makeHttp({
      'https://acme.com/': htmlResponse(HOMEPAGE_HTML),
    });
    const gemini = fakeGemini('not even json');
    const r = await discoverAnchors({
      domain: 'acme.com',
      companyName: 'Acme Inc',
      env,
      http,
      gemini,
    });
    expect(r.discoveredVia).toBe('regex');
    expect(r.errors.some((e) => e.startsWith('gemini:'))).toBe(true);
    expect(r.linkedinCompanyUrl).toBe('https://www.linkedin.com/company/acme-inc');
  });

  it('returns "none" when no pages are fetched', async () => {
    const http = makeHttp({});
    const r = await discoverAnchors({
      domain: 'acme.com',
      companyName: 'Acme Inc',
      env: {},
      http,
      useLlm: false,
    });
    expect(r.discoveredVia).toBe('none');
    expect(r.linkedinCompanyUrl).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects invented URLs from the LLM (validates URL format)', async () => {
    const http = makeHttp({ 'https://acme.com/': htmlResponse('<html><body>nothing</body></html>') });
    const gemini = fakeGemini({
      linkedinCompanyUrl: 'not a url',
      twitterUrl: null,
      youtubeChannelUrl: null,
      githubOrgUrl: null,
      crunchbaseUrl: null,
      instagramUrl: null,
      facebookUrl: null,
      founders: [{ name: 'Bob', title: null, linkedinUrl: 'also-not-a-url' }],
      companyDescription: 'desc',
      primaryProductOrService: null,
      industryOneLiner: null,
    });
    const r = await discoverAnchors({
      domain: 'acme.com',
      companyName: 'Acme Inc',
      env,
      http,
      gemini,
    });
    expect(r.linkedinCompanyUrl).toBeNull();
    expect(r.founders[0]!.linkedinUrl).toBeNull();
  });

  it('surfaces YouTube /@handle URLs from raw HTML even when extractSocialLinks skips them', async () => {
    const html = `<html><body>
      <a href="https://www.youtube.com/@AcmeInc">YouTube</a>
    </body></html>`;
    const http = makeHttp({ 'https://acme.com/': htmlResponse(html) });
    const r = await discoverAnchors({
      domain: 'acme.com',
      companyName: 'Acme Inc',
      env: {},
      http,
      useLlm: false,
    });
    expect(r.youtubeChannelUrl).toBe('https://www.youtube.com/@AcmeInc');
  });
});
