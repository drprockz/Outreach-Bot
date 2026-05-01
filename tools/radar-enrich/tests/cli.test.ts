import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOptions, main } from '../src/cli.js';
import { EnrichedDossierSchema } from '../src/schemas.js';

describe('buildOptions (arg parser)', () => {
  it('parses required + optional flags', () => {
    const opts = buildOptions(['--company', 'Acme', '--domain', 'acme.com', '--location', 'Mumbai, India', '--founder', 'Jane']);
    expect(opts.input.name).toBe('Acme');
    expect(opts.input.domain).toBe('acme.com');
    expect(opts.input.location).toBe('Mumbai, India');
    expect(opts.input.founder).toBe('Jane');
    expect(opts.modules).toEqual(['hiring', 'product', 'customer', 'voice', 'operational', 'positioning']);
    expect(opts.useCache).toBe(true);
    expect(opts.concurrency).toBe(4);
    expect(opts.timeoutMs).toBe(30000);
    expect(opts.verbose).toBe(false);
    expect(opts.debugContext).toBe(false);
    expect(opts.outPath).toBeUndefined();
  });

  it('honors --modules whitelist', () => {
    const opts = buildOptions(['-c', 'Acme', '-d', 'acme.com', '-m', 'hiring,product']);
    expect(opts.modules).toEqual(['hiring', 'product']);
  });

  it('rejects an unknown module name in --modules', () => {
    expect(() => buildOptions(['-c', 'Acme', '-d', 'acme.com', '-m', 'banana'])).toThrow(/unknown module/i);
  });

  it('--no-cache disables cache reads', () => {
    const opts = buildOptions(['-c', 'Acme', '-d', 'acme.com', '--no-cache']);
    expect(opts.useCache).toBe(false);
  });

  it('--clear-cache sets the action flag', () => {
    const opts = buildOptions(['--clear-cache']);
    expect(opts.action).toBe('clear-cache');
  });

  it('-v / --verbose toggles', () => {
    const opts = buildOptions(['-c', 'Acme', '-d', 'acme.com', '-v']);
    expect(opts.verbose).toBe(true);
  });

  it('--debug-context toggles', () => {
    const opts = buildOptions(['-c', 'Acme', '-d', 'acme.com', '--debug-context']);
    expect(opts.debugContext).toBe(true);
  });

  it('rejects missing --company when action is enrich', () => {
    expect(() => buildOptions(['-d', 'acme.com'])).toThrow(/company/i);
  });

  it('rejects missing --domain when action is enrich', () => {
    expect(() => buildOptions(['-c', 'Acme'])).toThrow(/domain/i);
  });
});

describe('main() integration', () => {
  it('emits a complete dossier that validates against EnrichedDossierSchema', async () => {
    let tmp: string | null = null;
    let stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-enrich-int-'));
      // Restrict to stub modules only — using real adapters here would make real
      // DNS / HTTP calls (operational adapter) and stall the suite. Stubs exercise
      // the same end-to-end shape (schema + module key set + exit code).
      const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--modules', 'voice,positioning', '--out', join(tmp, 'out.json')]);
      expect(code).toBe(0);
      const written = JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8'));
      expect(EnrichedDossierSchema.safeParse(written).success).toBe(true);
      expect(Object.keys(written.modules).sort()).toEqual(['customer','hiring','operational','positioning','product','voice']);
    } finally {
      stdoutSpy.mockRestore();
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('writes to --out path and emits no stdout', async () => {
    let tmp: string | null = null;
    let stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-enrich-int-'));
      const out = join(tmp, 'dossier.json');
      const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--modules', 'voice,positioning', '--out', out]);
      expect(code).toBe(0);
      expect(stdoutChunks.join('')).toBe('');
      const written = JSON.parse(readFileSync(out, 'utf8'));
      expect(EnrichedDossierSchema.safeParse(written).success).toBe(true);
    } finally {
      stdoutSpy.mockRestore();
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });
});
