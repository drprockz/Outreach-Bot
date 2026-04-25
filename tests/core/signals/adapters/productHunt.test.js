import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

import * as adapter from '../../../../src/core/signals/adapters/productHunt.js';
import axios from 'axios';

function phResponse(posts) {
  return { status: 200, data: { data: { posts: { edges: posts.map(node => ({ node })) } } } };
}

const recent = (daysAgo) => new Date(Date.now() - daysAgo * 86400_000).toISOString();

describe('productHunt adapter', () => {
  beforeEach(() => {
    axios.post.mockReset();
    process.env.PRODUCTHUNT_TOKEN = 'fake-token';
  });

  it('exposes name + timeoutMs', () => {
    expect(adapter.name).toBe('product_hunt');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns empty when businessName is missing', async () => {
    const res = await adapter.fetch({ id: 1, businessName: null });
    expect(res.signals).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns empty when PRODUCTHUNT_TOKEN is unset (graceful skip)', async () => {
    delete process.env.PRODUCTHUNT_TOKEN;
    const res = await adapter.fetch({ id: 1, businessName: 'Acme' });
    expect(res.signals).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('emits a launch signal at 0.9 confidence for recent launches (< 180 days)', async () => {
    axios.post.mockResolvedValueOnce(phResponse([
      { name: 'Acme Mobile', tagline: 'on-the-go Acme', url: 'https://producthunt.com/posts/acme-mobile', createdAt: recent(60) },
      { name: 'Acme V1',     tagline: 'old version',    url: 'https://producthunt.com/posts/acme-v1',     createdAt: recent(400) },
    ]));
    const res = await adapter.fetch({ id: 1, businessName: 'Acme' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].signalType).toBe('launch');
    expect(res.signals[0].confidence).toBeCloseTo(0.9, 2);
    expect(res.signals[0].headline).toContain('Acme Mobile');
  });

  it('returns empty when search yields no posts', async () => {
    axios.post.mockResolvedValueOnce(phResponse([]));
    const res = await adapter.fetch({ id: 1, businessName: 'Acme' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty when newest post is older than 180 days', async () => {
    axios.post.mockResolvedValueOnce(phResponse([
      { name: 'Acme V0', tagline: 'ancient', url: 'https://producthunt.com/posts/acme-v0', createdAt: recent(400) },
    ]));
    const res = await adapter.fetch({ id: 1, businessName: 'Acme' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty on API failure', async () => {
    axios.post.mockResolvedValue({ status: 500, data: { error: 'oops' } });
    const res = await adapter.fetch({ id: 1, businessName: 'Acme' });
    expect(res.signals).toEqual([]);
  });

  it('sends Bearer auth header with token', async () => {
    axios.post.mockResolvedValueOnce(phResponse([
      { name: 'Acme', tagline: 't', url: 'https://producthunt.com/posts/acme', createdAt: recent(10) },
    ]));
    await adapter.fetch({ id: 1, businessName: 'Acme' });
    const opts = axios.post.mock.calls[0][2];
    expect(opts.headers.Authorization).toBe('Bearer fake-token');
  });
});
