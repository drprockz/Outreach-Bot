import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

const feedsByUrl = new Map();
vi.mock('rss-parser', () => {
  const Parser = vi.fn().mockImplementation(() => ({
    parseString: async (body) => feedsByUrl.get(body) || { items: [] },
  }));
  return { default: Parser };
});

import * as adapter from '../../../../src/core/signals/adapters/indianPress.js';
import axios from 'axios';

function setupFeed(url, items) {
  // The adapter passes resp.data through to parseString; we use the URL as the body sentinel.
  const sentinel = `BODY:${url}`;
  feedsByUrl.set(sentinel, { items });
  return sentinel;
}

describe('indianPress adapter', () => {
  beforeEach(() => {
    feedsByUrl.clear();
    axios.get.mockReset();
    axios.get.mockImplementation(async (url) => ({
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
      data: `BODY:${url}`,
    }));
  });

  it('exposes name + timeoutMs', () => {
    expect(adapter.name).toBe('indian_press');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('fetches all 4 source feeds in parallel', async () => {
    await adapter.fetch({ id: 1, businessName: 'Flipkart', websiteUrl: 'https://flipkart.com' });
    const calledHosts = axios.get.mock.calls.map(c => new URL(c[0]).hostname);
    expect(calledHosts).toContain('inc42.com');
    expect(calledHosts).toContain('yourstory.com');
    expect(calledHosts).toContain('entrackr.com');
    expect(calledHosts).toContain('www.vccircle.com');
  });

  it('returns empty when neither businessName nor websiteUrl is present', async () => {
    const res = await adapter.fetch({ id: 1, businessName: null, websiteUrl: null });
    expect(res.signals).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('matches items mentioning businessName (case-insensitive) at confidence 0.95', async () => {
    setupFeed('https://yourstory.com/feed', [
      { title: 'Random unrelated startup news', link: 'https://yourstory.com/a', pubDate: '2026-04-15', contentSnippet: 'foo' },
      { title: 'flipkart hits 100M users', link: 'https://yourstory.com/b', pubDate: '2026-04-14', contentSnippet: 'milestone' },
    ]);
    const res = await adapter.fetch({ id: 1, businessName: 'Flipkart', websiteUrl: null });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].confidence).toBeCloseTo(0.95, 2);
    expect(res.signals[0].headline).toMatch(/flipkart/i);
  });

  it('matches items mentioning websiteUrl hostname', async () => {
    setupFeed('https://entrackr.com/feed', [
      { title: 'Some startup raises seed', link: 'https://entrackr.com/a', pubDate: '2026-04-15', contentSnippet: 'mentions example.io somewhere' },
    ]);
    const res = await adapter.fetch({ id: 1, businessName: null, websiteUrl: 'https://example.io' });
    expect(res.signals).toHaveLength(1);
  });

  it('tags Inc42 funding-keyword matches as "funding"', async () => {
    setupFeed('https://inc42.com/feed/', [
      { title: 'Acme raises Series A from Sequoia', link: 'https://inc42.com/a', pubDate: '2026-04-15', contentSnippet: '' },
    ]);
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', websiteUrl: null });
    expect(res.signals[0].signalType).toBe('funding');
  });

  it('tags VCCircle funding-keyword matches as "funding"', async () => {
    setupFeed('https://www.vccircle.com/rss', [
      { title: 'Acme bags $5M in seed round', link: 'https://vccircle.com/a', pubDate: '2026-04-15', contentSnippet: '' },
    ]);
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', websiteUrl: null });
    expect(res.signals[0].signalType).toBe('funding');
  });

  it('tags YourStory matches without funding keywords as "press"', async () => {
    setupFeed('https://yourstory.com/feed', [
      { title: 'Acme launches Mumbai pop-up', link: 'https://yourstory.com/a', pubDate: '2026-04-15', contentSnippet: '' },
    ]);
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', websiteUrl: null });
    expect(res.signals[0].signalType).toBe('press');
  });

  it('returns empty when no items match the lead', async () => {
    setupFeed('https://yourstory.com/feed', [
      { title: 'Some other company news', link: 'https://yourstory.com/a', pubDate: '2026-04-15', contentSnippet: '' },
    ]);
    const res = await adapter.fetch({ id: 1, businessName: 'Flipkart', websiteUrl: null });
    expect(res.signals).toEqual([]);
  });

  it('survives one failing feed and still returns matches from the others', async () => {
    axios.get.mockReset();
    axios.get.mockImplementation(async (url) => {
      if (url.includes('entrackr')) throw new Error('boom');
      return { status: 200, headers: { 'content-type': 'application/rss+xml' }, data: `BODY:${url}` };
    });
    setupFeed('https://yourstory.com/feed', [
      { title: 'Flipkart launches Mumbai hub', link: 'https://yourstory.com/a', pubDate: '2026-04-15', contentSnippet: '' },
    ]);
    const res = await adapter.fetch({ id: 1, businessName: 'Flipkart', websiteUrl: null });
    expect(res.signals).toHaveLength(1);
  });
});
