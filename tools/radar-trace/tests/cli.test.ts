import { describe, it, expect, vi } from 'vitest';
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
});

describe('main() integration', () => {
  it('emits a complete dossier that validates against RadarTraceDossierSchema', async () => {
    let tmp: string | null = null;
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

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
      const code = await main([
        '--company', 'Acme', '--domain', 'acme.com',
        '--modules', 'customer',
        '--out', out,
        '--timeout', '100',
      ]);
      expect(code).toBe(0);
      // Only logger messages go to stdout — no JSON blob
      const nonLogOutput = stdoutChunks.filter((c) => {
        try { JSON.parse(c.trim()); const o = JSON.parse(c.trim()); return 'radarTraceVersion' in o; }
        catch { return false; }
      });
      expect(nonLogOutput).toHaveLength(0);
      const written = JSON.parse(readFileSync(out, 'utf8'));
      expect(RadarTraceDossierSchema.safeParse(written).success).toBe(true);
    } finally {
      stdoutSpy.mockRestore();
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('adapters key set — modules block has correct keys for each module', async () => {
    // Verify the modules block structure without running DNS/network adapters.
    // Customer module has no required env and times out fast at --timeout 100.
    let tmp: string | null = null;
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

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
      stdoutSpy.mockRestore();
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });
});
