import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import * as adapter from '../../../../src/core/signals/adapters/pagespeed.js';
import axios from 'axios';

function psiResponse(lcpMs, cls) {
  return {
    status: 200,
    data: {
      lighthouseResult: {
        audits: {
          'largest-contentful-paint': { numericValue: lcpMs, displayValue: `${(lcpMs/1000).toFixed(1)} s` },
          'cumulative-layout-shift':  { numericValue: cls,   displayValue: String(cls) },
        },
      },
    },
  };
}

describe('pagespeed adapter', () => {
  beforeEach(() => axios.get.mockReset());

  it('exposes name + timeoutMs', () => {
    expect(adapter.name).toBe('pagespeed');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns empty when websiteUrl is missing', async () => {
    const res = await adapter.fetch({ id: 1, websiteUrl: null });
    expect(res.signals).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('emits performance signal at 0.7 confidence when LCP > 4s (pain)', async () => {
    axios.get.mockResolvedValueOnce(psiResponse(5200, 0.05));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].signalType).toBe('performance');
    expect(res.signals[0].confidence).toBeCloseTo(0.7, 1);
    expect(res.signals[0].payload.lcpMs).toBe(5200);
    expect(res.signals[0].payload.cls).toBe(0.05);
  });

  it('emits performance signal at 0.3 confidence when LCP <= 4s (healthy)', async () => {
    axios.get.mockResolvedValueOnce(psiResponse(2100, 0.02));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].confidence).toBeCloseTo(0.3, 1);
  });

  it('builds the PSI mobile URL with the lead website encoded', async () => {
    axios.get.mockResolvedValueOnce(psiResponse(2000, 0.01));
    await adapter.fetch({ id: 1, websiteUrl: 'https://x.com/path?q=1' });
    const calledUrl = axios.get.mock.calls[0][0];
    expect(calledUrl).toContain('pagespeedonline');
    expect(calledUrl).toContain('strategy=mobile');
    expect(calledUrl).toContain(encodeURIComponent('https://x.com/path?q=1'));
  });

  it('returns empty on PSI failure', async () => {
    axios.get.mockResolvedValue({ status: 500, data: { error: 'oops' } });
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty when LCP missing from response', async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: { lighthouseResult: { audits: {} } } });
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });
});
