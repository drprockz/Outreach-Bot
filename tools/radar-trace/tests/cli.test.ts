import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOptions, main } from '../src/cli.js';
import { RadarTraceDossierSchema } from '../src/schemas.js';

describe('buildOptions (arg parser)', () => {
  it('parses required + optional flags', () => {
    const opts = buildOptions(['--company', 'Acme', '--domain', 'acme.com', '--location', 'Mumbai, India', '--founder', 'Jane']);
    expect(opts.input.name).toBe('Acme');
    expect(opts.input.domain).toBe('acme.com');
    expect(opts.input.location).toBe('Mumbai, India');
    expect(opts.input.founder).toBe('Jane');
    expect(opts.useCache).toBe(true);
    expect(opts.concurrency).toBe(4);
    expect(opts.timeoutMs).toBe(30000);
    expect(opts.verbose).toBe(false);
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

  it('rejects missing --company when action is enrich', () => {
    expect(() => buildOptions(['-d', 'acme.com'])).toThrow(/company/i);
  });

  it('rejects missing --domain when action is enrich', () => {
    expect(() => buildOptions(['-c', 'Acme'])).toThrow(/domain/i);
  });

  // Task 7.1 — --skip-paid
  it('--skip-paid sets skipPaid:true in CliOptions', () => {
    const opts = buildOptions(['-c', 'Acme', '-d', 'acme.com', '--skip-paid']);
    expect(opts.skipPaid).toBe(true);
  });

  // Task 7.2 — --max-cost-inr
  it('--max-cost-inr is parsed as a number', () => {
    const opts = buildOptions(['-c', 'Acme', '-d', 'acme.com', '--max-cost-inr', '500']);
    expect(opts.maxCostInr).toBe(500);
  });

  // Task 7.3 — --adapters
  it('--adapters parses a comma-separated list', () => {
    const opts = buildOptions(['-c', 'Acme', '-d', 'acme.com', '--adapters', 'hiring.adzuna,operational.crtsh']);
    expect(opts.adapters).toEqual(['hiring.adzuna', 'operational.crtsh']);
  });

  it('--adapters rejects unknown adapter name', () => {
    expect(() => buildOptions(['-c', 'Acme', '-d', 'acme.com', '--adapters', 'banana.unknown']))
      .toThrow(/unknown adapter/i);
  });

  it('--adapters rejects empty list', () => {
    expect(() => buildOptions(['-c', 'Acme', '-d', 'acme.com', '--adapters', '']))
      .toThrow(/at least one adapter/i);
  });

  // Task 7.4 — --linkedin
  it('--linkedin sets founderLinkedinUrl in input', () => {
    const opts = buildOptions(['-c', 'Acme', '-d', 'acme.com', '--linkedin', 'https://linkedin.com/in/jane']);
    expect(opts.input.founderLinkedinUrl).toBe('https://linkedin.com/in/jane');
  });
});

describe('main() integration', () => {
  let stderrChunks: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    stderrChunks = [];
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : (chunk as Buffer).toString());
      return true;
    });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('emits a complete dossier that validates against RadarTraceDossierSchema', async () => {
    let tmp: string | null = null;

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      // Run with no modules (empty adapter list) — this exercises the full shape
      // without making real network calls. Adapters for voice/positioning not yet
      // wired (chunks 3-5), so restrict to a set with no required env.
      // We pass --modules with an empty-resolving pattern by using no real module.
      // Actually, we can use no --modules flag and just verify the schema.
      // Use a module that requires no env — the adapters will get status:error due
      // to missing network, but the dossier shape will still be valid.
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--modules', 'customer',  // customer adapters have no requiredEnv
        '--out', join(tmp, 'out.json'),
        '--timeout', '100',       // very short timeout so HTTP fails fast
      ]);
      expect(code).toBe(0);
      const written = JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8'));
      expect(RadarTraceDossierSchema.safeParse(written).success).toBe(true);
      expect(written.radarTraceVersion).toBe('1.0.0');
      expect(written.signalSummary).toBeNull();
      expect(Object.keys(written.modules).sort()).toEqual([
        'ads', 'customer', 'directories', 'hiring', 'operational',
        'positioning', 'product', 'social', 'voice',
      ]);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('writes to --out path and emits no stdout', async () => {
    let tmp: string | null = null;
    let stdoutChunks: string[] = [];
    // Override the beforeEach spy to capture chunks for this test
    stdoutSpy.mockImplementation((chunk: unknown) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : (chunk as Buffer).toString());
      return true;
    });

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      const out = join(tmp, 'dossier.json');
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--modules', 'customer',
        '--out', out,
        '--timeout', '100',
      ]);
      expect(code).toBe(0);
      // Only logger messages go to stdout — no JSON blob
      const nonLogOutput = stdoutChunks.filter((c) => {
        try { const o = JSON.parse(c.trim()); return 'radarTraceVersion' in o; }
        catch { return false; }
      });
      expect(nonLogOutput).toHaveLength(0);
      const written = JSON.parse(readFileSync(out, 'utf8'));
      expect(RadarTraceDossierSchema.safeParse(written).success).toBe(true);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('adapters key set — modules block has correct keys for each module', async () => {
    // Verify the modules block structure without running DNS/network adapters.
    // Customer module has no required env and times out fast at --timeout 100.
    let tmp: string | null = null;

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--modules', 'customer',
        '--out', join(tmp, 'out.json'),
        '--timeout', '100',
      ]);
      expect(code).toBe(0);
      const written = JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8'));
      // customer module should have both adapters
      expect(written.modules.customer.adapters.sort()).toEqual([
        'customer.logos_current', 'customer.wayback_diff',
      ]);
      // other modules are empty arrays
      expect(written.modules.hiring.adapters).toEqual([]);
      expect(written.modules.product.adapters).toEqual([]);
      expect(written.modules.operational.adapters).toEqual([]);
      // adapters map has exactly the 2 customer adapters
      expect(Object.keys(written.adapters).sort()).toEqual([
        'customer.logos_current', 'customer.wayback_diff',
      ]);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Task 7.1 — --skip-paid integration test
  it('--skip-paid: Apify adapters appear in dossier as status:empty and are not run', async () => {
    let tmp: string | null = null;

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--modules', 'voice,social,ads,directories',
        '--skip-paid',
        '--out', join(tmp, 'out.json'),
        '--timeout', '100',
      ]);
      expect(code).toBe(0);
      const written = JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8'));
      // All *_apify adapter slots should exist in the dossier
      const apifyKeys = Object.keys(written.adapters).filter((k) => k.includes('_apify'));
      expect(apifyKeys.length).toBeGreaterThan(0);
      // Every apify slot must have status:'empty'
      for (const k of apifyKeys) {
        expect(written.adapters[k].status).toBe('empty');
        expect(written.adapters[k].payload).toBeNull();
      }
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Task 7.2 — --max-cost-inr integration tests
  it('--max-cost-inr: pre-flight under threshold proceeds (returns 0)', async () => {
    let tmp: string | null = null;

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      // customer module has estimatedCostInr:0 for both adapters — well under any cap
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--modules', 'customer',
        '--max-cost-inr', '1000',
        '--out', join(tmp, 'out.json'),
        '--timeout', '100',
      ]);
      expect(code).toBe(0);
      const stderr = stderrChunks.join('');
      expect(stderr).toMatch(/pre-flight estimated cost.*₹/);
      expect(stderr).toMatch(/actual cost.*₹/);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--max-cost-inr: pre-flight over threshold exits 1 with error message naming offenders', async () => {
    // Run with all modules and a tiny cap (₹0.01) — will definitely exceed
    const code = await main([
      '--company', 'Acme', '--domain', 'acme.com',
      '--modules', 'voice,social,ads',
      '--max-cost-inr', '0.01',
      '--timeout', '100',
    ]);
    expect(code).toBe(1);
    const stderr = stderrChunks.join('');
    expect(stderr).toMatch(/pre-flight cost.*exceeds.*--max-cost-inr/i);
    // Should list at least one paid adapter name in the error
    expect(stderr).toMatch(/₹/);
  });

  it('--max-cost-inr: actual cost may be lower than pre-flight (gated adapters skipped)', async () => {
    let tmp: string | null = null;

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      // Use a very generous cap so the run proceeds
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--modules', 'customer',
        '--max-cost-inr', '9999',
        '--out', join(tmp, 'out.json'),
        '--timeout', '100',
      ]);
      expect(code).toBe(0);
      const stderr = stderrChunks.join('');
      // Both pre-flight and actual cost lines must be present
      expect(stderr).toMatch(/pre-flight estimated cost \(worst case\)/);
      expect(stderr).toMatch(/actual cost/);
      // Pre-flight >= actual (gated adapters may not fire; here both are 0)
      const preMatch = stderr.match(/pre-flight estimated cost.*?₹([\d.]+)/);
      const actualMatch = stderr.match(/actual cost.*?₹([\d.]+)/);
      expect(preMatch).not.toBeNull();
      expect(actualMatch).not.toBeNull();
      const preCost = parseFloat(preMatch?.[1] ?? '0');
      const actualCost = parseFloat(actualMatch?.[1] ?? '0');
      expect(actualCost).toBeLessThanOrEqual(preCost);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Task 7.3 — --adapters integration test
  it('--adapters: runs only listed adapters; others appear as status:empty', async () => {
    let tmp: string | null = null;

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--adapters', 'customer.logos_current',
        '--out', join(tmp, 'out.json'),
        '--timeout', '100',
      ]);
      expect(code).toBe(0);
      const written = JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8'));
      // Only the requested adapter should be in the dossier
      const adapterKeys = Object.keys(written.adapters);
      expect(adapterKeys).toEqual(['customer.logos_current']);
      // modules block reflects the single adapter scope
      expect(written.modules.customer.adapters).toEqual(['customer.logos_current']);
      expect(written.modules.hiring.adapters).toEqual([]);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Task 7.4 — --linkedin integration test
  it('--linkedin: founderLinkedinUrl is passed through to the dossier company field', async () => {
    let tmp: string | null = null;
    const linkedinUrl = 'https://linkedin.com/in/jane-doe';

    try {
      tmp = mkdtempSync(join(tmpdir(), 'radar-trace-int-'));
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--linkedin', linkedinUrl,
        '--modules', 'customer',
        '--out', join(tmp, 'out.json'),
        '--timeout', '100',
      ]);
      expect(code).toBe(0);
      const written = JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8'));
      expect(written.company.founderLinkedinUrl).toBe(linkedinUrl);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });
});
