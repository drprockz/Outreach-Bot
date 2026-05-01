import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { socialLinksAdapter, extractSocialLinks } from '../../../src/adapters/social/links.js';
import type { AdapterContext } from '../../../src/types.js';

const homepageFixture = readFileSync(
  join(__dirname, '../../fixtures/social/homepage-with-social.html'),
  'utf8',
);

function makeCtx(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => makeCtx(http).logger },
    env: {},
    signal: new AbortController().signal,
  };
}

describe('socialLinksAdapter', () => {
  it('contract surface', () => {
    expect(socialLinksAdapter.name).toBe('social.links');
    expect(socialLinksAdapter.module).toBe('social');
    expect(socialLinksAdapter.estimatedCostInr).toBe(0);
    expect(socialLinksAdapter.requiredEnv).toHaveLength(0);
    expect(socialLinksAdapter.gate).toBeUndefined();
  });

  it('parses fixture with all 5 platforms and otherSocial', async () => {
    const http = (async () => new Response(homepageFixture, { status: 200 })) as typeof fetch;
    const result = await socialLinksAdapter.run(makeCtx(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.linkedinCompany).toBe('https://www.linkedin.com/company/acme-corp');
    // twitter picks the first match (twitter.com before x.com in HTML)
    expect(p.twitter).toContain('twitter.com/acmecorp');
    expect(p.instagram).toBe('https://www.instagram.com/acmecorp');
    expect(p.facebook).toBe('https://www.facebook.com/acmecorp');
    expect(p.youtube).toBe('https://www.youtube.com/channel/UCfakeChannelId');
    // GitHub is in otherSocial
    expect(p.otherSocial).toContain('https://github.com/acmecorp');
    // LinkedIn /in/ is NOT in linkedinCompany or otherSocial
    expect(p.linkedinCompany).not.toContain('/in/');
  });

  it('returns empty when no social links found', async () => {
    const noSocialHtml = '<html><body><a href="/about">About</a></body></html>';
    const http = (async () => new Response(noSocialHtml, { status: 200 })) as typeof fetch;
    const result = await socialLinksAdapter.run(makeCtx(http));
    expect(result.status).toBe('empty');
    expect(result.payload!.linkedinCompany).toBeNull();
    expect(result.payload!.twitter).toBeNull();
    expect(result.payload!.otherSocial).toHaveLength(0);
  });

  it('extractSocialLinks correctly skips /in/ LinkedIn and @handle YouTube', () => {
    const html = `<html><body>
      <a href="https://linkedin.com/in/janedoe">Jane</a>
      <a href="https://www.youtube.com/@AcmeCorp">YouTube Channel</a>
      <a href="https://linkedin.com/company/acme-corp">Company</a>
    </body></html>`;
    const result = extractSocialLinks(html);
    expect(result.linkedinCompany).toBe('https://linkedin.com/company/acme-corp');
    expect(result.youtube).toBeNull(); // @handle skipped
  });
});
