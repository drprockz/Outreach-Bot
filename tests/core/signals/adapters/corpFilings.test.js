import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import * as adapter from '../../../../src/core/signals/adapters/corpFilings.js';
import axios from 'axios';

const TOFLER_HTML = `
  <html><body>
    <div class="company-info">
      <h1>Acme Industries Pvt Ltd</h1>
      <table>
        <tr><th>Paid-up Capital</th><td>₹ 5,00,00,000</td></tr>
        <tr><th>Directors</th><td>Anil Sharma, Priya Patel</td></tr>
      </table>
    </div>
  </body></html>
`;

describe('corpFilings adapter (experimental)', () => {
  beforeEach(() => axios.get.mockReset());

  it('exposes name + timeoutMs', () => {
    expect(adapter.name).toBe('corp_filings');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns empty when country is not IN', async () => {
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', country: 'US' });
    expect(res.signals).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns empty when businessName is missing', async () => {
    const res = await adapter.fetch({ id: 1, businessName: null, country: 'IN' });
    expect(res.signals).toEqual([]);
  });

  it('silent-fails on 403 anti-bot block', async () => {
    axios.get.mockResolvedValueOnce({ status: 403, data: 'forbidden' });
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', country: 'IN' });
    expect(res.signals).toEqual([]);
  });

  it('emits filings signal at 0.6 confidence when directors + capital parse successfully', async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: TOFLER_HTML });
    const res = await adapter.fetch({ id: 1, businessName: 'Acme Industries', country: 'IN' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].signalType).toBe('filings');
    expect(res.signals[0].confidence).toBeCloseTo(0.6, 2);
    expect(res.signals[0].payload.paidUpCapital).toMatch(/5,00,00,000/);
    expect(res.signals[0].payload.directors).toContain('Anil Sharma');
  });

  it('returns empty when page contains no parseable filings data', async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: '<html><body>Page not found</body></html>' });
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', country: 'IN' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty on network error (silent-fail)', async () => {
    axios.get.mockResolvedValue({ status: 500, data: '' });
    const res = await adapter.fetch({ id: 1, businessName: 'Acme', country: 'IN' });
    expect(res.signals).toEqual([]);
  });
});
