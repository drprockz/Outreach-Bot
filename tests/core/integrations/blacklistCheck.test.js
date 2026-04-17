import { describe, it, expect, vi } from 'vitest';
import dns from 'dns';

vi.mock('dns', async () => {
  const actual = await vi.importActual('dns');
  return {
    ...actual,
    default: {
      ...actual,
      promises: {
        ...actual.promises,
        resolve: vi.fn()
      }
    },
    promises: {
      ...actual.promises,
      resolve: vi.fn()
    }
  };
});

import { checkDomain } from '../../../src/core/integrations/blacklistCheck.js';

describe('blacklistCheck', () => {
  it('returns clean=true when all DNS lookups fail (NXDOMAIN = not listed)', async () => {
    dns.promises.resolve.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await checkDomain('example.com');
    expect(result.clean).toBe(true);
    expect(result.zones).toEqual([]);
  });

  it('returns clean=false when DNS lookup resolves (listed)', async () => {
    dns.promises.resolve.mockResolvedValueOnce(['127.0.0.2']);
    dns.promises.resolve.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await checkDomain('spammy.com');
    expect(result.clean).toBe(false);
    expect(result.zones.length).toBeGreaterThan(0);
  });
});
