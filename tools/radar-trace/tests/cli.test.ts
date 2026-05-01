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
  const fakeLoad = async () => async (_lead: unknown, _persona: unknown, _signals: unknown) => ({
    hook: 'fake-hook', costUsd: 0, model: 'fake', hookVariantId: 'A' as const,
  });

  it('emits a complete dossier that validates against EnrichedDossierSchema', async () => {
    let tmp: string | null = null;
    let stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      // Restrict to stub modules only — using real adapters here would make real
      // DNS / HTTP calls (operational adapter) and stall the suite. Stubs exercise
      // the same end-to-end shape (schema + module key set + exit code).
      const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--modules', 'voice,positioning', '--out', join(tmp, 'out.json')], { loadRegenerateHook: fakeLoad });
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
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      const out = join(tmp, 'dossier.json');
      const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--modules', 'voice,positioning', '--out', out], { loadRegenerateHook: fakeLoad });
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

describe('main() synthesis', () => {
  let tmp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;
  let stdoutChunks: string[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'radar-trace-syn-'));
    stdoutChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('populates signalSummary when synthesis succeeds', async () => {
    const fakeLoad = async () => async (_lead: unknown, _persona: unknown, _signals: unknown) => ({
      hook: 'fake-hook', costUsd: 0.002, model: 'fake', hookVariantId: 'A' as const,
    });
    const out = join(tmp, 'd.json');
    const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--modules', 'voice,positioning', '--out', out], { loadRegenerateHook: fakeLoad });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.signalSummary.suggestedHooks.length).toBe(3);
    expect(parsed.signalSummary.suggestedHooks[0]).toBe('fake-hook');
    expect(parsed.signalSummary.totalCostUsd).toBeCloseTo(0.006, 5);
  });

  it('falls back to empty signalSummary when loadRegenerateHook throws', async () => {
    const fakeLoad = async () => { throw new Error('SDK not installed'); };
    const out = join(tmp, 'd.json');
    const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--modules', 'voice,positioning', '--out', out], { loadRegenerateHook: fakeLoad });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.signalSummary.topSignals).toEqual([]);
    expect(parsed.signalSummary.suggestedHooks).toEqual([]);
    expect(parsed.signalSummary.totalCostUsd).toBe(0);
  });

  it('--debug-context includes synthesizedContext + stage10 metadata', async () => {
    const fakeLoad = async () => async (_lead: unknown, _persona: unknown, _signals: unknown) => ({
      hook: 'fake-hook', costUsd: 0, model: 'fake', hookVariantId: 'A' as const,
    });
    const out = join(tmp, 'd.json');
    const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--modules', 'voice,positioning', '--debug-context', '--out', out], { loadRegenerateHook: fakeLoad });
    expect(code).toBe(0);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.signalSummary._debug).toBeDefined();
    expect(parsed.signalSummary._debug.synthesizedContext.lead.business_name).toBe('Acme');
    expect(parsed.signalSummary._debug.stage10.path).toBe('src/core/pipeline/regenerateHook.js');
    expect(parsed.signalSummary._debug.stage10.gitSha).toMatch(/^[0-9a-f]{7,40}$|^unknown$/);
  });
});
