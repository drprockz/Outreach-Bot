import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

let mockFeedItems = [];
vi.mock('rss-parser', () => {
  const Parser = vi.fn().mockImplementation(() => ({
    parseString: async () => ({ items: mockFeedItems }),
  }));
  return { default: Parser };
});

import * as adapter from '../../../../src/core/signals/adapters/companyBlog.js';
import axios from 'axios';

function xmlResp(body = '<rss/>') {
  return { status: 200, headers: { 'content-type': 'application/rss+xml' }, data: body };
}
function notFound() {
  const err = new Error('404');
  err.response = { status: 404 };
  throw err;
}

const recent = () => new Date(Date.now() - 14 * 86400_000).toUTCString();
const stale  = () => new Date(Date.now() - 200 * 86400_000).toUTCString();

describe('companyBlog adapter', () => {
  beforeEach(() => {
    axios.get.mockReset();
    mockFeedItems = [];
  });

  it('exposes name and timeoutMs', () => {
    expect(adapter.name).toBe('company_blog');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns empty when websiteUrl is missing', async () => {
    const res = await adapter.fetch({ id: 1, websiteUrl: null });
    expect(res.signals).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('emits a fresh blog_post signal at confidence ~0.7 when item is < 90 days old', async () => {
    axios.get.mockResolvedValueOnce(xmlResp());
    mockFeedItems = [
      { title: 'Older post', link: 'https://x.com/a', pubDate: stale() },
      { title: 'New launch announcement', link: 'https://x.com/b', pubDate: recent() },
    ];
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].signalType).toBe('blog_post');
    expect(res.signals[0].headline).toBe('New launch announcement');
    expect(res.signals[0].confidence).toBeCloseTo(0.7, 1);
  });

  it('emits a stale blog_post signal at confidence ~0.3 when newest item is > 90 days old', async () => {
    axios.get.mockResolvedValueOnce(xmlResp());
    mockFeedItems = [
      { title: 'Old post 1', link: 'https://x.com/a', pubDate: stale() },
    ];
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].confidence).toBeCloseTo(0.3, 1);
  });

  it('probes feed paths in order and stops at first 200', async () => {
    // 1st probe (/feed) 404, 2nd probe (/rss) succeeds
    axios.get.mockImplementationOnce(notFound);
    axios.get.mockResolvedValueOnce(xmlResp());
    mockFeedItems = [{ title: 'Hello', link: 'https://x.com/a', pubDate: recent() }];
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get.mock.calls[0][0]).toMatch(/\/feed$/);
    expect(axios.get.mock.calls[1][0]).toMatch(/\/rss$/);
  });

  it('returns empty when all feed paths 404', async () => {
    axios.get.mockImplementation(notFound);
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty when feed found but contains no items', async () => {
    axios.get.mockResolvedValueOnce(xmlResp());
    mockFeedItems = [];
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });
});
