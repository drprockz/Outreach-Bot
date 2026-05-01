import { describe, it, expect } from 'vitest';
import { loadEnv, assertRequiredEnv, ENV_REGISTRATION_URLS } from '../src/env.js';

describe('loadEnv', () => {
  it('returns a typed Env object with only declared keys', () => {
    const env = loadEnv({
      ADZUNA_APP_ID: 'foo',
      GITHUB_TOKEN: 'bar',
      UNKNOWN_NOISE: 'should-be-ignored',
    });
    expect(env.ADZUNA_APP_ID).toBe('foo');
    expect(env.GITHUB_TOKEN).toBe('bar');
    expect((env as Record<string, unknown>).UNKNOWN_NOISE).toBeUndefined();
  });

  it('treats empty strings as unset', () => {
    const env = loadEnv({ ADZUNA_APP_ID: '', GITHUB_TOKEN: 'x' });
    expect(env.ADZUNA_APP_ID).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBe('x');
  });
});

describe('assertRequiredEnv', () => {
  it('passes when every required key is present and non-empty', () => {
    const env = loadEnv({ ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' });
    expect(() => assertRequiredEnv(env, 'hiring', ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'])).not.toThrow();
  });

  it('throws naming the missing key and registration URL', () => {
    const env = loadEnv({ ADZUNA_APP_ID: 'a' });
    expect(() => assertRequiredEnv(env, 'hiring', ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']))
      .toThrow(/ADZUNA_APP_KEY.*developer\.adzuna\.com/);
  });

  it('lists every missing key when several are absent', () => {
    const env = loadEnv({});
    let err: Error | null = null;
    try {
      assertRequiredEnv(env, 'hiring', ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain('ADZUNA_APP_ID');
    expect(err!.message).toContain('ADZUNA_APP_KEY');
  });
});

describe('ENV_REGISTRATION_URLS', () => {
  it('has a URL for every Env key referenced by an adapter', () => {
    const required = ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY'] as const;
    for (const key of required) {
      expect(ENV_REGISTRATION_URLS[key]).toMatch(/^https?:\/\//);
    }
  });
});
