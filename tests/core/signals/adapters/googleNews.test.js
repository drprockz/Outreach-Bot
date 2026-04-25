import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn(async () => ({ data: '<rss/>' })) },
}));

vi.mock('rss-parser', () => {
  const Parser = vi.fn().mockImplementation(() => ({
    parseString: async () => ({
      items: [
        { title: 'Flipkart raises $500M Series H', link: 'https://news.example/a', pubDate: '2026-04-15' },
        { title: 'Flipkart hiring senior engineers',  link: 'https://news.example/b', pubDate: '2026-04-10' },
        { title: 'Flipkart launches new Mumbai hub',  link: 'https://news.example/c', pubDate: '2026-04-09' },
        { title: 'Flipkart appoints new CTO',         link: 'https://news.example/d', pubDate: '2026-04-08' },
        { title: 'Random celebrity mentions Flipkart', link: 'https://news.example/e', pubDate: '2026-04-07' },
      ],
    }),
  }));
  return { default: Parser };
});

import * as adapter from '../../../../src/core/signals/adapters/googleNews.js';
import axios from 'axios';

describe('googleNews adapter', () => {
  beforeEach(() => { axios.get.mockClear(); });

  it('exposes name and timeoutMs', () => {
    expect(adapter.name).toBe('google_news');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns signals tagged by heuristic type', async () => {
    const res = await adapter.fetch({ id: 1, businessName: 'Flipkart' });
    const types = res.signals.map(s => s.signalType);
    expect(types).toContain('funding');
    expect(types).toContain('hiring');
    expect(types).toContain('launch');
    expect(types).toContain('exec_change');
    expect(res.source).toBe('google_news');
  });

  it('assigns high confidence to funding matches', async () => {
    const res = await adapter.fetch({ id: 1, businessName: 'Flipkart' });
    const funding = res.signals.find(s => s.signalType === 'funding');
    expect(funding.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('falls back to "press" with low confidence for unmatched titles', async () => {
    const res = await adapter.fetch({ id: 1, businessName: 'Flipkart' });
    const press = res.signals.find(s => s.signalType === 'press');
    expect(press).toBeDefined();
    expect(press.confidence).toBeLessThan(0.5);
  });

  it('returns empty signals when businessName is missing', async () => {
    const res = await adapter.fetch({ id: 1, businessName: null });
    expect(res.signals).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('builds the Google News query URL with the quoted business name', async () => {
    await adapter.fetch({ id: 1, businessName: 'Flipkart' });
    const calledUrl = axios.get.mock.calls[0][0];
    expect(calledUrl).toContain('news.google.com/rss/search');
    expect(calledUrl).toContain(encodeURIComponent('"Flipkart"'));
  });
});
