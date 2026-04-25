import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import * as adapter from '../../../../src/core/signals/adapters/github.js';
import axios from 'axios';

const recent = (daysAgo) => new Date(Date.now() - daysAgo * 86400_000).toISOString();

describe('github adapter', () => {
  beforeEach(() => axios.get.mockReset());

  it('exposes name + timeoutMs', () => {
    expect(adapter.name).toBe('github');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns empty when category is not tech-adjacent', async () => {
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', category: 'real_estate' });
    expect(res.signals).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns empty when businessName is missing', async () => {
    const res = await adapter.fetch({ id: 1, businessName: null, category: 'saas' });
    expect(res.signals).toEqual([]);
  });

  it('emits github_activity at 0.7 when org has recent push events (last 30 days)', async () => {
    // org lookup → 200
    axios.get.mockResolvedValueOnce({ status: 200, data: { login: 'acme', public_repos: 12 } });
    // events → recent push + PR
    axios.get.mockResolvedValueOnce({ status: 200, data: [
      { type: 'PushEvent',         created_at: recent(2),  repo: { name: 'acme/api' } },
      { type: 'PullRequestEvent',  created_at: recent(5),  repo: { name: 'acme/web' } },
      { type: 'WatchEvent',        created_at: recent(40), repo: { name: 'acme/old' } },
    ]});
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', category: 'saas' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].signalType).toBe('github_activity');
    expect(res.signals[0].confidence).toBeCloseTo(0.7, 1);
    expect(res.signals[0].payload.recentPushCount).toBeGreaterThan(0);
  });

  it('returns empty when org does not exist (404)', async () => {
    axios.get.mockResolvedValueOnce({ status: 404, data: { message: 'Not Found' } });
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', category: 'agency' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty when no recent activity', async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: { login: 'acme' } });
    axios.get.mockResolvedValueOnce({ status: 200, data: [
      { type: 'PushEvent', created_at: recent(60), repo: { name: 'acme/api' } },
    ]});
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', category: 'saas' });
    expect(res.signals).toEqual([]);
  });

  it('slugifies businessName for org lookup (lowercase, no spaces, no special chars)', async () => {
    axios.get.mockResolvedValueOnce({ status: 404, data: {} });
    await adapter.fetch({ id: 1, businessName: 'Acme & Co. Pvt Ltd!', category: 'saas' });
    const orgUrl = axios.get.mock.calls[0][0];
    expect(orgUrl).toMatch(/\/orgs\/acmeco/);
  });

  it('accepts tech, saas, software, agency categories (case-insensitive)', async () => {
    for (const cat of ['Tech', 'SaaS', 'software', 'AGENCY']) {
      axios.get.mockReset();
      axios.get.mockResolvedValueOnce({ status: 404, data: {} });
      await adapter.fetch({ id: 1, businessName: 'Acme', category: cat });
      expect(axios.get).toHaveBeenCalled();
    }
  });
});
