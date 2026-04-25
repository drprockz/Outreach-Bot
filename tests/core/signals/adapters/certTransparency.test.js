import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import * as adapter from '../../../../src/core/signals/adapters/certTransparency.js';
import axios from 'axios';

const recent = (daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 86400_000);
  return d.toISOString().slice(0, 19); // crt.sh uses "YYYY-MM-DDTHH:mm:ss"
};

describe('certTransparency adapter', () => {
  beforeEach(() => axios.get.mockReset());

  it('exposes name + timeoutMs', () => {
    expect(adapter.name).toBe('cert_transparency');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns empty when websiteUrl is missing', async () => {
    const res = await adapter.fetch({ id: 1, websiteUrl: null });
    expect(res.signals).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('emits one subdomain signal per unique recent subdomain (last 90 days)', async () => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: [
        { name_value: 'example.com\nwww.example.com', entry_timestamp: recent(10) },
        { name_value: 'api.example.com',              entry_timestamp: recent(20) },
        { name_value: 'staging.example.com',          entry_timestamp: recent(200) }, // too old
        { name_value: 'api.example.com',              entry_timestamp: recent(5) },   // dup
      ],
    });
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://example.com' });
    const subdomains = res.signals.map(s => s.payload.subdomain).sort();
    expect(subdomains).toEqual(['api.example.com', 'www.example.com']);
    expect(res.signals[0].signalType).toBe('subdomain');
    expect(res.signals[0].confidence).toBeCloseTo(0.6, 1);
  });

  it('skips wildcard certs', async () => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: [
        { name_value: '*.example.com', entry_timestamp: recent(5) },
        { name_value: 'app.example.com', entry_timestamp: recent(5) },
      ],
    });
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://example.com' });
    expect(res.signals.map(s => s.payload.subdomain)).toEqual(['app.example.com']);
  });

  it('skips the apex domain itself', async () => {
    axios.get.mockResolvedValueOnce({
      status: 200,
      data: [{ name_value: 'example.com', entry_timestamp: recent(5) }],
    });
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://example.com' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty on crt.sh failure', async () => {
    // Use resolved 500 instead of rejection — vitest's unhandled-rejection
    // detection fires from mockRejectedValue even when await catches it.
    axios.get.mockResolvedValue({ status: 500, data: 'server error' });
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://example.com' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty when API returns non-array (e.g. HTML error page)', async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: '<html>oops</html>' });
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://example.com' });
    expect(res.signals).toEqual([]);
  });
});
