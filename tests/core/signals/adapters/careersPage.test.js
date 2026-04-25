import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import * as adapter from '../../../../src/core/signals/adapters/careersPage.js';
import axios from 'axios';

function htmlOk(body) {
  return { status: 200, headers: { 'content-type': 'text/html' }, data: body };
}
function fail404() {
  const err = new Error('404');
  err.response = { status: 404 };
  throw err;
}

const HTML_5_JOBS = `
  <html><body><ul>
    <li><a href="/jobs/1">Senior Frontend Engineer</a></li>
    <li><a href="/jobs/2">Backend Engineer</a></li>
    <li><a href="/jobs/3">Product Designer</a></li>
    <li><a href="/jobs/4">Engineering Manager</a></li>
    <li><a href="/jobs/5">Tech Lead</a></li>
    <li><a href="/jobs/6">Office Admin</a></li>
  </ul></body></html>
`;

const HTML_2_JOBS = `
  <html><body>
    <h2>Senior Engineer</h2>
    <h3>Designer</h3>
    <p>About us page text mentioning engineer offhandedly</p>
  </body></html>
`;

const HTML_NO_JOBS = `<html><body><p>We're not hiring right now.</p></body></html>`;

describe('careersPage adapter', () => {
  beforeEach(() => axios.get.mockReset());

  it('exposes name + timeoutMs', () => {
    expect(adapter.name).toBe('careers_page');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns empty when websiteUrl is missing', async () => {
    const res = await adapter.fetch({ id: 1, websiteUrl: null });
    expect(res.signals).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('emits hiring at 0.85 when 5+ job titles found', async () => {
    axios.get.mockResolvedValueOnce(htmlOk(HTML_5_JOBS));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].signalType).toBe('hiring');
    expect(res.signals[0].confidence).toBeCloseTo(0.85, 2);
    expect(res.signals[0].payload.count).toBeGreaterThanOrEqual(5);
  });

  it('emits hiring at 0.6 when 1–4 job titles found', async () => {
    axios.get.mockResolvedValueOnce(htmlOk(HTML_2_JOBS));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0].confidence).toBeCloseTo(0.6, 2);
    expect(res.signals[0].payload.count).toBeGreaterThanOrEqual(1);
    expect(res.signals[0].payload.count).toBeLessThanOrEqual(4);
  });

  it('returns empty when zero job titles found on the page', async () => {
    axios.get.mockResolvedValueOnce(htmlOk(HTML_NO_JOBS));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });

  it('probes paths in order and stops at first 200', async () => {
    axios.get.mockImplementationOnce(fail404); // /careers
    axios.get.mockResolvedValueOnce(htmlOk(HTML_5_JOBS)); // /jobs
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get.mock.calls[0][0]).toMatch(/\/careers$/);
    expect(axios.get.mock.calls[1][0]).toMatch(/\/jobs$/);
  });

  it('returns empty when all probe paths 404', async () => {
    // axios with validateStatus default throws on 4xx/5xx; return 404 with no html body
    axios.get.mockResolvedValue({ status: 404, headers: { 'content-type': 'text/html' }, data: '' });
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });

  it('payload includes pageUrl + first few titles', async () => {
    axios.get.mockResolvedValueOnce(htmlOk(HTML_5_JOBS));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals[0].payload.pageUrl).toMatch(/\/careers$/);
    expect(Array.isArray(res.signals[0].payload.titles)).toBe(true);
    expect(res.signals[0].payload.titles.length).toBeGreaterThan(0);
  });
});
