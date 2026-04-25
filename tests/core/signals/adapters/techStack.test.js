import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import * as adapter from '../../../../src/core/signals/adapters/techStack.js';

function lastFn(args) {
  const cb = args[args.length - 1];
  return typeof cb === 'function' ? cb : null;
}

function mockCliReturning(stdout) {
  execFile.mockImplementation((...args) => {
    const cb = lastFn(args);
    if (cb) setImmediate(() => cb(null, stdout, ''));
  });
}

function mockCliFailing(err) {
  execFile.mockImplementation((...args) => {
    const cb = lastFn(args);
    if (cb) setImmediate(() => cb(err, '', err.message));
  });
}

describe('techStack adapter', () => {
  beforeEach(() => execFile.mockReset());

  it('exposes name + timeoutMs', () => {
    expect(adapter.name).toBe('tech_stack');
    expect(typeof adapter.timeoutMs).toBe('number');
  });

  it('returns empty when websiteUrl is missing', async () => {
    const res = await adapter.fetch({ id: 1, websiteUrl: null });
    expect(res.signals).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('emits a single tech signal at 0.85 confidence with categories + technologies', async () => {
    mockCliReturning(JSON.stringify({
      urls: { 'https://x.com': {} },
      technologies: [
        { name: 'React',     categories: [{ name: 'JavaScript frameworks' }] },
        { name: 'Cloudflare', categories: [{ name: 'CDN' }] },
        { name: 'WordPress',  categories: [{ name: 'CMS' }, { name: 'Blogs' }] },
      ],
    }));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toHaveLength(1);
    const sig = res.signals[0];
    expect(sig.signalType).toBe('tech');
    expect(sig.confidence).toBeCloseTo(0.85, 2);
    expect(sig.payload.technologies).toEqual(['React', 'Cloudflare', 'WordPress']);
    expect(sig.payload.categories).toContain('JavaScript frameworks');
    expect(sig.payload.categories).toContain('CMS');
  });

  it('returns empty when CLI returns zero technologies', async () => {
    mockCliReturning(JSON.stringify({ technologies: [] }));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty when CLI fails (graceful degrade)', async () => {
    mockCliFailing(new Error('wappalyzer not installed'));
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });

  it('returns empty when CLI returns malformed JSON', async () => {
    mockCliReturning('not json {');
    const res = await adapter.fetch({ id: 1, websiteUrl: 'https://x.com' });
    expect(res.signals).toEqual([]);
  });
});
