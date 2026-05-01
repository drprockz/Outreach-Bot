import { describe, it, expect } from 'vitest';
import { normalizeDomain, toHttpsUrl, basePath } from '../../src/lib/domainUtils.js';

describe('normalizeDomain', () => {
  it.each([
    ['acme.com', 'acme.com'],
    ['ACME.COM', 'acme.com'],
    ['https://acme.com/', 'acme.com'],
    ['https://www.acme.com/path/', 'acme.com'],
    ['http://app.acme.com', 'app.acme.com'],
    ['  acme.com  ', 'acme.com'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it('throws on empty input', () => {
    expect(() => normalizeDomain('')).toThrow();
  });
});

describe('toHttpsUrl', () => {
  it('builds https://domain/path', () => {
    expect(toHttpsUrl('acme.com', '/careers')).toBe('https://acme.com/careers');
    expect(toHttpsUrl('acme.com')).toBe('https://acme.com/');
  });
});

describe('basePath', () => {
  it('returns the URL minus the trailing path/query', () => {
    expect(basePath('https://acme.com/x?y=1')).toBe('https://acme.com');
  });
});
