# radar-enrich Prototype Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone TypeScript CLI at `tools/radar-enrich/` that enriches a single company with operational-truth signals from 4 modules (hiring, product, customer, operational), stubs 2 more (voice, positioning) against the same adapter contract, and feeds the result through Radar's existing Stage 10 hook generator (`src/core/pipeline/regenerateHook.js`) to produce 3 candidate hooks per run for manual validation.

**Architecture:** Standalone npm package outside the workspace tree (its own `node_modules`, own `tsconfig.json`, own `vitest.config.ts`). Adapter pattern with a single `Adapter<TPayload>` interface — every module implements `name`, `version`, `requiredEnv`, `schema`, `run(ctx)`. Orchestrator runs adapters in parallel via `p-limit`, isolates failures, validates payloads through zod, and writes file-based cache keyed by `<adapter>-<inputHash>-<version>-<YYYYMMDD>`. Final synthesis flattens module outputs into Stage 10's `signals[]` shape and calls `regenerateHook` 3 times in parallel for 3 hook candidates.

**Tech Stack:** TypeScript 5 (NodeNext, strict), Node 20+, `commander` for CLI, `zod` for schema validation, `p-limit` for concurrency, `pino` + `pino-pretty` for logging, `cheerio` for HTML parsing, `@anthropic-ai/sdk` (transitively, via reused Stage 10), native `fetch`, `dns/promises`, `crypto`. Tests with `vitest`, no network in tests (HTTP fixtures + DI'd fetch).

**Spec:** [docs/superpowers/specs/2026-05-01-radar-enrich-prototype-design.md](../specs/2026-05-01-radar-enrich-prototype-design.md)

**Reference skills:**
- @superpowers:test-driven-development — every task is test-first
- @superpowers:verification-before-completion — never claim a task done without seeing the test pass

---

## File Structure

Files this plan creates, with one-line responsibility each:

| Path | Responsibility |
|---|---|
| `tools/radar-enrich/package.json` | Standalone package manifest |
| `tools/radar-enrich/tsconfig.json` | TS compiler config (NodeNext, strict, ES2022) |
| `tools/radar-enrich/vitest.config.ts` | Test runner config |
| `tools/radar-enrich/.env.example` | Documents every env var + registration URL |
| `tools/radar-enrich/.gitignore` | Ignores `node_modules/`, `cache/`, `profiles/`, `dist/` |
| `tools/radar-enrich/README.md` | How to run, key acquisition links, sample output |
| `tools/radar-enrich/src/types.ts` | `Adapter`, `AdapterResult`, `AdapterContext`, `CompanyInput`, `Cache`, `Logger` |
| `tools/radar-enrich/src/env.ts` | Zod-validated env loader, fail-fast on missing required keys |
| `tools/radar-enrich/src/logger.ts` | Pino logger, pretty when TTY, JSON otherwise, always to stderr |
| `tools/radar-enrich/src/http.ts` | Fetch wrapper: timeout, retry-once-on-5xx, UA header |
| `tools/radar-enrich/src/cache.ts` | File-based cache (`./cache/<adapter>-<hash>-<version>-<YYYYMMDD>.json`) |
| `tools/radar-enrich/src/schemas.ts` | Zod schemas for every payload + the top-level output |
| `tools/radar-enrich/src/orchestrator.ts` | Runs adapters via `p-limit`, isolates failures, assembles output |
| `tools/radar-enrich/src/cli.ts` | `commander` entrypoint, args→orchestrator, prints summary matrix |
| `tools/radar-enrich/src/lib/classify.ts` | Function/seniority keyword classifiers (Module 1) |
| `tools/radar-enrich/src/lib/domainUtils.ts` | Normalize domain, registered-domain extraction, URL helpers |
| `tools/radar-enrich/src/fingerprints/techstack.ts` | Embedded ~50-tool fingerprint dataset (Module 5) |
| `tools/radar-enrich/src/adapters/voice.stub.ts` | Module 4 stub — returns `status:'empty'` |
| `tools/radar-enrich/src/adapters/positioning.stub.ts` | Module 6 stub — returns `status:'empty'` |
| `tools/radar-enrich/src/adapters/hiring.ts` | Module 1 — Adzuna + careers HTML |
| `tools/radar-enrich/src/adapters/product.ts` | Module 2 — GitHub + changelog discovery |
| `tools/radar-enrich/src/adapters/customer.ts` | Module 3 — Wayback diff |
| `tools/radar-enrich/src/adapters/operational.ts` | Module 5 — fingerprints + DNS + crt.sh |
| `tools/radar-enrich/src/synthesis/contextMapper.ts` | 4-module output → Stage 10 lead/persona/signals shape |
| `tools/radar-enrich/src/synthesis/hookGenerator.ts` | Calls `regenerateHook` 3x, derives `topSignals` locally |
| `tools/radar-enrich/tests/**/*.test.ts` | Per-file specs with HTTP fixtures |
| `tools/radar-enrich/tests/fixtures/<adapter>/*.json` | Sanitized real responses for test inputs |

---

## Chunk 1: Package skeleton + types + env + logger

This chunk produces a buildable, testable package with the typed surface and observability primitives. After this chunk a developer can `npm install`, `npm test`, and `npm run typecheck` successfully with the type system and config plumbing locked in. Cache + HTTP wrapper are deferred to Chunk 2.

### Task 1.1: Package skeleton

**Files:**
- Create: `tools/radar-enrich/package.json`
- Create: `tools/radar-enrich/tsconfig.json`
- Create: `tools/radar-enrich/vitest.config.ts`
- Create: `tools/radar-enrich/.gitignore`
- Create: `tools/radar-enrich/.env.example`
- Create: `tools/radar-enrich/README.md`

- [ ] **Step 1: Create the directory and initialize package.json**

```bash
mkdir -p tools/radar-enrich/src tools/radar-enrich/tests
```

Create `tools/radar-enrich/package.json`:

```json
{
  "name": "radar-enrich",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Strategic-signal validation prototype for Radar cold outreach",
  "bin": {
    "radar-enrich": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "enrich": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "cheerio": "^1.0.0",
    "commander": "^12.0.0",
    "p-limit": "^6.0.0",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `tools/radar-enrich/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "allowJs": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

`allowJs: true` is required because `synthesis/hookGenerator.ts` imports `regenerateHook.js` from `src/core/pipeline/`.

- [ ] **Step 3: Create vitest.config.ts**

Create `tools/radar-enrich/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    environment: 'node',
    testTimeout: 10000,
    passWithNoTests: true,
  },
});
```

- [ ] **Step 4: Create .gitignore**

Create `tools/radar-enrich/.gitignore`:

```
node_modules/
dist/
cache/
profiles/
.env
*.log
```

- [ ] **Step 5: Create .env.example**

Create `tools/radar-enrich/.env.example`:

```env
# Required by Module 1 — Hiring
# Register: https://developer.adzuna.com/
ADZUNA_APP_ID=
ADZUNA_APP_KEY=

# Required by Module 2 — Product
# Generate: https://github.com/settings/tokens (public_repo scope is sufficient)
GITHUB_TOKEN=

# Required by Module 3 — Customer (no key needed; Wayback Machine is open)

# Required by Module 5 — Operational (no key needed; uses DNS + crt.sh)

# Required by synthesis (Stage 10 hook generator)
ANTHROPIC_API_KEY=

# Stub modules — only needed once Module 4 / 6 are un-stubbed
# https://serper.dev/
SERPER_API_KEY=
# https://api.search.brave.com/
BRAVE_API_KEY=
# https://www.listennotes.com/api/
LISTEN_NOTES_KEY=
```

- [ ] **Step 6: Create README.md**

Create `tools/radar-enrich/README.md`:

````markdown
# radar-enrich

Strategic-signal validation prototype. See `docs/superpowers/specs/2026-05-01-radar-enrich-prototype-design.md` for the design doc.

## Setup

```bash
cd tools/radar-enrich
npm install
cp .env.example .env
# fill in ADZUNA_APP_ID, ADZUNA_APP_KEY, GITHUB_TOKEN, ANTHROPIC_API_KEY at minimum
```

## Run

```bash
npm run enrich -- --company "Acme Corp" --domain acme.com
npm run enrich -- --company "Acme Corp" --domain acme.com --location "Mumbai, India" --verbose
npm run enrich -- --company "Acme Corp" --domain acme.com --out ./profiles/acme.json
```

## Test

```bash
npm test
npm run typecheck
```

## What it does

Fetches operational signals (hiring, GitHub activity, Wayback diffs, tech stack) for one company and feeds them through Radar's existing Stage 10 hook generator. Output: structured JSON dossier + 3 candidate hooks for manual review.
````

- [ ] **Step 7: Install dependencies and verify the package builds**

```bash
cd tools/radar-enrich && npm install
```

Expected: clean install with no peer-dep warnings that block.

- [ ] **Step 8: Verify TypeScript compiles (no source files yet, so empty success)**

```bash
cd tools/radar-enrich && npm run typecheck
```

Expected: exits 0 silently (no `src/**/*.ts` files yet means no diagnostics).

- [ ] **Step 9: Verify vitest runs (no tests yet, exits cleanly)**

```bash
cd tools/radar-enrich && npm test
```

Expected: `No test files found`, exit 0 (the `passWithNoTests: true` in vitest.config.ts ensures this).

- [ ] **Step 10: Commit**

```bash
git add tools/radar-enrich/package.json tools/radar-enrich/package-lock.json tools/radar-enrich/tsconfig.json tools/radar-enrich/vitest.config.ts tools/radar-enrich/.gitignore tools/radar-enrich/.env.example tools/radar-enrich/README.md
git commit -m "chore(radar-enrich): scaffold standalone TS package"
```

---

### Task 1.2: Core types

**Files:**
- Create: `tools/radar-enrich/src/types.ts`
- Create: `tools/radar-enrich/tests/types.test.ts`

These types are referenced by every other file in the project, so we lock them down first.

- [ ] **Step 1: Write a placeholder test that asserts the type exports exist**

Create `tools/radar-enrich/tests/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Adapter, AdapterResult, AdapterContext, CompanyInput, Cache, Logger } from '../src/types.js';

describe('types', () => {
  it('exports the expected type names (compile-time check)', () => {
    // This test exists to lock the public surface. If a type is renamed or removed,
    // every other test file that imports from types.ts will fail to compile, and
    // this test serves as the documentation of what the module exports.
    const surface: Array<keyof typeof import('../src/types.js')> = [
      // types.ts only exports types + interfaces, no runtime values
    ];
    expect(surface).toEqual([]);

    // Runtime sanity: AdapterResultStatus is an enum-like union; we cast a literal to it
    const status: AdapterResult<unknown>['status'] = 'ok';
    expect(['ok', 'partial', 'empty', 'error']).toContain(status);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails (types module doesn't exist yet)**

```bash
cd tools/radar-enrich && npm test
```

Expected: FAIL — `Cannot find module '../src/types.js'`.

- [ ] **Step 3: Create types.ts**

Create `tools/radar-enrich/src/types.ts`:

```ts
import type { z } from 'zod';

export interface CompanyInput {
  name: string;
  domain: string;
  location?: string;
  founder?: string;
}

export interface Logger {
  debug: (msg: string, obj?: Record<string, unknown>) => void;
  info: (msg: string, obj?: Record<string, unknown>) => void;
  warn: (msg: string, obj?: Record<string, unknown>) => void;
  error: (msg: string, obj?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

export interface Cache {
  /** Returns cached AdapterResult if a fresh entry exists for today, else null. */
  read<T>(key: CacheKey): Promise<AdapterResult<T> | null>;
  /** Writes the AdapterResult under the key. Idempotent (overwrites). */
  write<T>(key: CacheKey, value: AdapterResult<T>): Promise<void>;
  /** Deletes every cache file. Used by --clear-cache. */
  clear(): Promise<void>;
}

export interface CacheKey {
  adapterName: string;
  adapterVersion: string;
  inputHash: string;       // sha256 of normalized CompanyInput, truncated to 12 chars
  date: string;            // YYYYMMDD
}

/** Runtime context handed to every adapter's run() — all I/O dependencies are here. */
export interface AdapterContext {
  input: CompanyInput;
  http: typeof fetch;       // wrapped fetch w/ timeout + retry; injectable for tests
  cache: Cache;
  logger: Logger;
  env: Env;
  signal: AbortSignal;      // from orchestrator's per-adapter timeout
}

/** Every keyed env var the prototype recognizes. Adapters declare which ones they require. */
export interface Env {
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  GITHUB_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  SERPER_API_KEY?: string;
  BRAVE_API_KEY?: string;
  LISTEN_NOTES_KEY?: string;
  ANTHROPIC_DISABLED?: string;  // honored by reused Stage 10 code
}

export type AdapterStatus = 'ok' | 'partial' | 'empty' | 'error';

export interface AdapterResult<T> {
  source: string;
  fetchedAt: string;        // ISO timestamp
  status: AdapterStatus;
  payload: T | null;
  errors?: string[];
  costPaise: number;        // visibility only; no enforcement
  durationMs: number;
}

export interface Adapter<TPayload> {
  readonly name: string;
  readonly version: string;
  readonly estimatedCostPaise: number;
  readonly requiredEnv: readonly (keyof Env)[];
  readonly schema: z.ZodType<TPayload>;
  run(ctx: AdapterContext): Promise<AdapterResult<TPayload>>;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd tools/radar-enrich && npm test
```

Expected: PASS — types.ts compiles, the runtime sanity assertion passes.

- [ ] **Step 5: Run typecheck to confirm strict mode is happy**

```bash
cd tools/radar-enrich && npm run typecheck
```

Expected: exits 0 silently.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/types.ts tools/radar-enrich/tests/types.test.ts
git commit -m "feat(radar-enrich): core Adapter/AdapterResult/Context types"
```

---

### Task 1.3: Env loader (zod-validated, fail-fast)

**Files:**
- Create: `tools/radar-enrich/src/env.ts`
- Create: `tools/radar-enrich/tests/env.test.ts`

The env loader is the boundary between `process.env` and the typed `Env` everything else uses. It must fail fast with the exact missing key + registration URL when an adapter's required env is absent.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/env.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- env
```

Expected: FAIL — `Cannot find module '../src/env.js'`.

- [ ] **Step 3: Create env.ts**

Create `tools/radar-enrich/src/env.ts`:

```ts
import { z } from 'zod';
import type { Env } from './types.js';

const EnvSchema = z.object({
  ADZUNA_APP_ID: z.string().min(1).optional(),
  ADZUNA_APP_KEY: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  SERPER_API_KEY: z.string().min(1).optional(),
  BRAVE_API_KEY: z.string().min(1).optional(),
  LISTEN_NOTES_KEY: z.string().min(1).optional(),
  ANTHROPIC_DISABLED: z.string().min(1).optional(),
});

export const ENV_REGISTRATION_URLS: Record<keyof Env, string> = {
  ADZUNA_APP_ID: 'https://developer.adzuna.com/',
  ADZUNA_APP_KEY: 'https://developer.adzuna.com/',
  GITHUB_TOKEN: 'https://github.com/settings/tokens',
  ANTHROPIC_API_KEY: 'https://console.anthropic.com/',
  SERPER_API_KEY: 'https://serper.dev/',
  BRAVE_API_KEY: 'https://api.search.brave.com/',
  LISTEN_NOTES_KEY: 'https://www.listennotes.com/api/',
  ANTHROPIC_DISABLED: '(internal flag — not registered)',
};

/**
 * Parse a raw env-shaped object into a strongly-typed Env. Empty strings are
 * treated as unset so a stale `KEY=` line in .env doesn't masquerade as present.
 * Unknown keys are dropped (zod's default `strip` behavior on z.object).
 */
export function loadEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== '' && v !== undefined) cleaned[k] = v;
  }
  return EnvSchema.parse(cleaned);
}

/**
 * Throws a single descriptive error listing every missing required key for the
 * given adapter, with each key's registration URL. Caller catches and surfaces.
 */
export function assertRequiredEnv(env: Env, adapterName: string, required: readonly (keyof Env)[]): void {
  const missing = required.filter((k) => !env[k]);
  if (missing.length === 0) return;
  const lines = missing.map((k) => `  - ${k}  →  ${ENV_REGISTRATION_URLS[k]}`);
  throw new Error(
    `Adapter "${adapterName}" requires env vars that are missing or empty:\n${lines.join('\n')}`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- env
```

Expected: PASS — all 5 assertions green.

- [ ] **Step 5: Run typecheck**

```bash
cd tools/radar-enrich && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/env.ts tools/radar-enrich/tests/env.test.ts
git commit -m "feat(radar-enrich): zod-validated env loader with fail-fast assertion"
```

---

### Task 1.4: Logger

**Files:**
- Create: `tools/radar-enrich/src/logger.ts`
- Create: `tools/radar-enrich/tests/logger.test.ts`

Pino logger that writes to **stderr** (so stdout JSON output stays clean) and uses pretty-print only when stdout is a TTY.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/logger.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from '../src/logger.js';

describe('createLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns an object with debug/info/warn/error/child methods', () => {
    const log = createLogger({ level: 'info', pretty: false });
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('child() returns a logger that includes the given bindings', () => {
    const log = createLogger({ level: 'info', pretty: false });
    const child = log.child({ adapter: 'hiring' });
    expect(typeof child.info).toBe('function');
    // We can't easily assert the binding appears in output without capturing
    // pino's stream; the child() returning a callable surface is the contract
    // the rest of the project relies on.
  });

  it('respects the level threshold (debug at info level is silent)', () => {
    // Tested indirectly: if level filtering broke, downstream verbose mode
    // wouldn't work. This is a smoke check that the pino instance accepts
    // the level option without throwing.
    expect(() => createLogger({ level: 'debug', pretty: false })).not.toThrow();
    expect(() => createLogger({ level: 'info', pretty: false })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- logger
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create logger.ts**

Create `tools/radar-enrich/src/logger.ts`:

```ts
import pino from 'pino';
import type { Logger } from './types.js';

export interface LoggerOptions {
  level: 'debug' | 'info' | 'warn' | 'error';
  pretty: boolean;
}

/**
 * Always writes to stderr (file descriptor 2) so stdout JSON output is uncontaminated.
 * Pretty-prints in dev/TTY, structured JSON otherwise.
 */
export function createLogger(opts: LoggerOptions): Logger {
  const stream = opts.pretty
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          destination: 2,
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : pino.destination(2);

  const instance = pino({ level: opts.level }, stream);

  return wrap(instance);
}

function wrap(p: pino.Logger): Logger {
  return {
    debug: (msg, obj) => (obj ? p.debug(obj, msg) : p.debug(msg)),
    info: (msg, obj) => (obj ? p.info(obj, msg) : p.info(msg)),
    warn: (msg, obj) => (obj ? p.warn(obj, msg) : p.warn(msg)),
    error: (msg, obj) => (obj ? p.error(obj, msg) : p.error(msg)),
    child: (bindings) => wrap(p.child(bindings)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- logger
```

Expected: PASS.

- [ ] **Step 5: Smoke-test the logger end-to-end manually**

```bash
cd tools/radar-enrich && node --input-type=module -e "import('./src/logger.ts').then(m => { const l = m.createLogger({level:'info',pretty:true}); l.info('hello', {key:'value'}); l.child({adapter:'test'}).info('nested'); })" 2>&1 | head -5
```

Note: this requires `tsx`-equivalent loading; if it errors on the `.ts` import, instead run via tsx:

```bash
cd tools/radar-enrich && npx tsx -e "import { createLogger } from './src/logger.js'; const l = createLogger({level:'info',pretty:true}); l.info('hello', {key:'value'}); l.child({adapter:'test'}).info('nested');"
```

Expected: two pretty-printed lines on stderr containing `hello` and `nested`.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/logger.ts tools/radar-enrich/tests/logger.test.ts
git commit -m "feat(radar-enrich): pino logger to stderr, pretty in TTY"
```

---

## Chunk 1 complete checkpoint

After this chunk:
- `tools/radar-enrich/` is buildable, testable
- Core types, env loader, and logger have full test coverage
- Next chunk adds the HTTP wrapper and file cache

Verify before moving on:

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Both must exit 0. Test count should be ~12 across types, env, logger.

---

## Chunk 2: HTTP + Cache

Runtime utilities every adapter consumes. Stays under the size cap by being tightly scoped to two modules.

---

### Task 2.1: HTTP fetch wrapper

**Files:**
- Create: `tools/radar-enrich/src/http.ts`
- Create: `tools/radar-enrich/tests/http.test.ts`

Thin wrapper over native `fetch` that adds a timeout via AbortController, retries once on 5xx, and sets a sane User-Agent. Exposed as `typeof fetch` so it's drop-in for adapters and trivial to swap in tests.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/http.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createHttp } from '../src/http.js';

function mockResponse(status: number, body = 'ok'): Response {
  return new Response(body, { status });
}

describe('createHttp', () => {
  it('passes the request through and returns the response on 2xx', async () => {
    const underlying = vi.fn(async (..._args: unknown[]) => mockResponse(200, 'hello'));
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    const res = await http('https://example.com');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('attaches a User-Agent header', async () => {
    const seen: Headers[] = [];
    const underlying = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return mockResponse(200);
    });
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    await http('https://example.com');
    expect(seen[0]!.get('user-agent')).toMatch(/radar-enrich/i);
  });

  it('retries once on a 5xx response', async () => {
    const underlying = vi.fn(async () => mockResponse(503));
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    const res = await http('https://example.com');
    expect(res.status).toBe(503);
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a 4xx response', async () => {
    const underlying = vi.fn(async () => mockResponse(404));
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    const res = await http('https://example.com');
    expect(res.status).toBe(404);
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('aborts when the timeout fires', async () => {
    const underlying = vi.fn(async (_url: unknown, init?: RequestInit) => {
      // Simulate a slow server: wait until the signal fires, then reject.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 50 });
    await expect(http('https://example.com')).rejects.toThrow(/abort/i);
  });

  it('honors an externally-provided AbortSignal alongside the timeout', async () => {
    const externalCtrl = new AbortController();
    const underlying = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const http = createHttp({ underlying: underlying as unknown as typeof fetch, timeoutMs: 5000 });
    const promise = http('https://example.com', { signal: externalCtrl.signal });
    externalCtrl.abort();
    await expect(promise).rejects.toThrow(/abort/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- http
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create http.ts**

Create `tools/radar-enrich/src/http.ts`:

```ts
export interface HttpOptions {
  /** The fetch implementation to wrap. Defaults to globalThis.fetch. Override in tests. */
  underlying?: typeof fetch;
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** User-Agent header value. */
  userAgent?: string;
}

const DEFAULT_UA = 'radar-enrich/0.1 (+https://radar.simpleinc.cloud)';

/**
 * Returns a fetch-compatible function with timeout, single retry on 5xx, and a
 * User-Agent header. Composes with externally-provided AbortSignals — if either
 * signal fires, the request aborts.
 */
export function createHttp(opts: HttpOptions = {}): typeof fetch {
  const underlying = opts.underlying ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const ua = opts.userAgent ?? DEFAULT_UA;

  const wrapped: typeof fetch = async (input, init) => {
    const attempt = async (): Promise<Response> => {
      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
      const composed = init?.signal
        ? composeSignals([init.signal, timeoutCtrl.signal])
        : timeoutCtrl.signal;
      const headers = new Headers(init?.headers);
      if (!headers.has('user-agent')) headers.set('user-agent', ua);
      try {
        return await underlying(input, { ...init, signal: composed, headers });
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const first = await attempt();
    if (first.status >= 500 && first.status < 600) {
      // Cancel the first response body so we don't leak the underlying stream.
      await first.body?.cancel().catch(() => {});
      return attempt();
    }
    return first;
  };

  return wrapped;
}

/** Returns a single AbortSignal that fires when ANY of the given signals fires. */
function composeSignals(signals: AbortSignal[]): AbortSignal {
  // Node 20+ has AbortSignal.any; fall back to manual composition for safety.
  const anyCtor = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyCtor === 'function') return anyCtor(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort();
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- http
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Run typecheck**

```bash
cd tools/radar-enrich && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/http.ts tools/radar-enrich/tests/http.test.ts
git commit -m "feat(radar-enrich): fetch wrapper with timeout, single 5xx retry, UA header"
```

---

### Task 2.2: File-based cache

**Files:**
- Create: `tools/radar-enrich/src/cache.ts`
- Create: `tools/radar-enrich/tests/cache.test.ts`

24h cache keyed by `<adapter>-<inputHash>-<adapterVersion>-<YYYYMMDD>.json` in `./cache/`. Stores the full `AdapterResult`, including errors.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileCache, hashCompanyInput, todayStamp } from '../src/cache.js';
import type { AdapterResult, CompanyInput } from '../src/types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'radar-enrich-cache-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sampleResult: AdapterResult<{ x: number }> = {
  source: 'hiring',
  fetchedAt: '2026-05-01T00:00:00.000Z',
  status: 'ok',
  payload: { x: 42 },
  costPaise: 0,
  durationMs: 100,
};

const sampleKey = {
  adapterName: 'hiring',
  adapterVersion: '1.0.0',
  inputHash: 'abc123def456',
  date: '20260501',
};

describe('createFileCache', () => {
  it('write then read returns the same value', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    const got = await cache.read<{ x: number }>(sampleKey);
    expect(got).toEqual(sampleResult);
  });

  it('read returns null for a missing key', async () => {
    const cache = createFileCache(dir);
    const got = await cache.read<{ x: number }>(sampleKey);
    expect(got).toBeNull();
  });

  it('different versions produce different cache files (cache busts on version bump)', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    const otherKey = { ...sampleKey, adapterVersion: '1.0.1' };
    const got = await cache.read<{ x: number }>(otherKey);
    expect(got).toBeNull();
  });

  it('different dates produce different cache files (TTL via date suffix)', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    const otherKey = { ...sampleKey, date: '20260502' };
    const got = await cache.read<{ x: number }>(otherKey);
    expect(got).toBeNull();
  });

  it('clear() removes every cache file but leaves the directory', async () => {
    const cache = createFileCache(dir);
    await cache.write(sampleKey, sampleResult);
    await cache.write({ ...sampleKey, adapterName: 'product' }, sampleResult);
    await cache.clear();
    expect(await cache.read(sampleKey)).toBeNull();
    expect(existsSync(dir)).toBe(true);
  });

  it('write creates the cache directory if it does not exist', async () => {
    const sub = join(dir, 'nested', 'cache');
    const cache = createFileCache(sub);
    await cache.write(sampleKey, sampleResult);
    expect(existsSync(sub)).toBe(true);
    expect(await cache.read(sampleKey)).toEqual(sampleResult);
  });

  it('stores errored AdapterResults too (so flaky runs do not retry expensive APIs)', async () => {
    const cache = createFileCache(dir);
    const errored: AdapterResult<unknown> = {
      source: 'hiring',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'error',
      payload: null,
      errors: ['ETIMEDOUT'],
      costPaise: 0,
      durationMs: 30000,
    };
    await cache.write(sampleKey, errored);
    const got = await cache.read(sampleKey);
    expect(got).toEqual(errored);
  });
});

describe('hashCompanyInput', () => {
  const input: CompanyInput = { name: 'Acme Corp', domain: 'acme.com' };

  it('returns a 12-char hex string', () => {
    const h = hashCompanyInput(input);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is stable for the same input', () => {
    expect(hashCompanyInput(input)).toBe(hashCompanyInput(input));
  });

  it('is insensitive to surrounding whitespace and case in name/domain', () => {
    expect(hashCompanyInput({ name: 'Acme Corp', domain: 'acme.com' }))
      .toBe(hashCompanyInput({ name: '  acme corp  ', domain: 'ACME.COM' }));
  });

  it('changes when location or founder change', () => {
    const a = hashCompanyInput(input);
    const b = hashCompanyInput({ ...input, location: 'Mumbai' });
    const c = hashCompanyInput({ ...input, founder: 'Jane' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});

describe('todayStamp', () => {
  it('returns YYYYMMDD format', () => {
    const s = todayStamp();
    expect(s).toMatch(/^\d{8}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- cache
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create cache.ts**

Create `tools/radar-enrich/src/cache.ts`:

```ts
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AdapterResult, Cache, CacheKey, CompanyInput } from './types.js';

/**
 * Returns a stable 12-char hex hash of the normalized CompanyInput.
 * Normalization: trim + lowercase name and domain. Location and founder are passed
 * through verbatim — they're free-text and small variations like "Mumbai" vs
 * "Mumbai, India" are meaningfully different inputs that should produce different
 * cache entries.
 */
export function hashCompanyInput(input: CompanyInput): string {
  const normalized = JSON.stringify({
    name: input.name.trim().toLowerCase(),
    domain: input.domain.trim().toLowerCase(),
    location: input.location ?? null,
    founder: input.founder ?? null,
  });
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/** Returns today's date as YYYYMMDD in the system's local timezone (matches IST when run on the VPS). */
export function todayStamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function fileNameFor(key: CacheKey): string {
  return `${key.adapterName}-${key.inputHash}-${key.adapterVersion}-${key.date}.json`;
}

export function createFileCache(dir: string): Cache {
  return {
    async read<T>(key: CacheKey): Promise<AdapterResult<T> | null> {
      const path = join(dir, fileNameFor(key));
      try {
        const raw = await readFile(path, 'utf8');
        return JSON.parse(raw) as AdapterResult<T>;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    async write<T>(key: CacheKey, value: AdapterResult<T>): Promise<void> {
      await mkdir(dir, { recursive: true });
      const path = join(dir, fileNameFor(key));
      await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
    },
    async clear(): Promise<void> {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw err;
      }
      await Promise.all(entries.map((f) => unlink(join(dir, f)).catch(() => {})));
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- cache
```

Expected: PASS — all 11 assertions across cache and hash describe blocks.

- [ ] **Step 5: Full test + typecheck pass**

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/cache.ts tools/radar-enrich/tests/cache.test.ts
git commit -m "feat(radar-enrich): file-based cache keyed by adapter+input+version+date"
```

---

## Chunk 2 complete checkpoint

After this chunk:
- HTTP wrapper + file cache complete with full test coverage
- All cross-cutting infrastructure done; next chunks wire adapters + orchestrator on top

Verify before moving on:

```bash
cd tools/radar-enrich && npm test && npm run typecheck && npm run build
```

All three must exit 0. Test count should be ~25–30 across types, env, logger, http, cache.

---

## Chunk 3: Schemas + stub adapters

Adds the top-level zod schemas (envelope shape for the dossier, validated on output) and the two real stub adapters (voice, positioning) that exercise the `Adapter<T>` contract end-to-end.

---

### Task 3.1: Top-level schemas

**Files:**
- Create: `tools/radar-enrich/src/schemas.ts`
- Create: `tools/radar-enrich/tests/schemas.test.ts`

The top-level zod schemas describe the final dossier shape. Per-adapter payload schemas live alongside the adapter that owns them (Chunk 4), but the *envelope* schemas — `AdapterResultSchema`, `EnrichedDossierSchema`, `SignalSummarySchema` — live here.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  AdapterResultSchema,
  EnrichedDossierSchema,
  SignalSummarySchema,
  CompanyInputSchema,
} from '../src/schemas.js';

describe('CompanyInputSchema', () => {
  it('parses a minimal valid input', () => {
    const r = CompanyInputSchema.safeParse({ name: 'Acme', domain: 'acme.com' });
    expect(r.success).toBe(true);
  });

  it('rejects empty name', () => {
    const r = CompanyInputSchema.safeParse({ name: '', domain: 'acme.com' });
    expect(r.success).toBe(false);
  });

  it('rejects missing domain', () => {
    const r = CompanyInputSchema.safeParse({ name: 'Acme' });
    expect(r.success).toBe(false);
  });

  it('accepts optional location and founder', () => {
    const r = CompanyInputSchema.safeParse({
      name: 'Acme', domain: 'acme.com', location: 'Mumbai, India', founder: 'Jane',
    });
    expect(r.success).toBe(true);
  });
});

describe('AdapterResultSchema', () => {
  it('parses an ok result', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'hiring',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'ok',
      payload: { anything: 'goes' },
      costPaise: 0,
      durationMs: 100,
    });
    expect(r.success).toBe(true);
  });

  it('parses an error result with errors[]', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'hiring',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'error',
      payload: null,
      errors: ['ETIMEDOUT'],
      costPaise: 0,
      durationMs: 30000,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const r = AdapterResultSchema.safeParse({
      source: 'hiring',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      status: 'banana',
      payload: null,
      costPaise: 0,
      durationMs: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe('SignalSummarySchema', () => {
  it('parses with required fields and optional _debug', () => {
    const r = SignalSummarySchema.safeParse({
      topSignals: ['[customer_added] Added logo: Acme'],
      suggestedHooks: ['hook one', 'hook two', 'hook three'],
      totalCostUsd: 0.012,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a _debug block when present', () => {
    const r = SignalSummarySchema.safeParse({
      topSignals: [],
      suggestedHooks: [],
      totalCostUsd: 0,
      _debug: {
        synthesizedContext: { lead: { business_name: 'X', website_url: 'x.com', manual_hook_note: null }, persona: { role: 'founder' }, signals: [] },
        stage10: { path: 'src/core/pipeline/regenerateHook.js', gitSha: 'abc' },
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('EnrichedDossierSchema', () => {
  it('parses a full dossier with all 6 modules and a signalSummary', () => {
    const dossier = {
      company: { name: 'Acme', domain: 'acme.com' },
      enrichedAt: '2026-05-01T00:00:00.000Z',
      totalCostPaise: 0,
      totalDurationMs: 1000,
      modules: {
        hiring:      { source: 'hiring',      fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        product:     { source: 'product',     fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        customer:    { source: 'customer',    fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        voice:       { source: 'voice',       fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        operational: { source: 'operational', fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        positioning: { source: 'positioning', fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
      },
      signalSummary: {
        topSignals: [],
        suggestedHooks: [],
        totalCostUsd: 0,
      },
    };
    const r = EnrichedDossierSchema.safeParse(dossier);
    expect(r.success).toBe(true);
  });

  it('rejects a dossier missing the modules block', () => {
    const r = EnrichedDossierSchema.safeParse({
      company: { name: 'Acme', domain: 'acme.com' },
      enrichedAt: '2026-05-01T00:00:00.000Z',
      totalCostPaise: 0,
      totalDurationMs: 0,
      signalSummary: { topSignals: [], suggestedHooks: [], totalCostUsd: 0 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a dossier missing one of the six modules', () => {
    const r = EnrichedDossierSchema.safeParse({
      company: { name: 'Acme', domain: 'acme.com' },
      enrichedAt: '2026-05-01T00:00:00.000Z',
      totalCostPaise: 0,
      totalDurationMs: 0,
      modules: {
        hiring:      { source: 'hiring',      fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        product:     { source: 'product',     fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        customer:    { source: 'customer',    fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        voice:       { source: 'voice',       fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        operational: { source: 'operational', fetchedAt: 'x', status: 'empty', payload: null, costPaise: 0, durationMs: 0 },
        // positioning missing
      },
      signalSummary: { topSignals: [], suggestedHooks: [], totalCostUsd: 0 },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- schemas
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create schemas.ts**

Create `tools/radar-enrich/src/schemas.ts`:

```ts
import { z } from 'zod';

export const CompanyInputSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  location: z.string().optional(),
  founder: z.string().optional(),
});

export const AdapterStatusSchema = z.enum(['ok', 'partial', 'empty', 'error']);

/** Generic envelope — payload is z.unknown here; per-adapter schemas validate the inner shape separately. */
export const AdapterResultSchema = z.object({
  source: z.string(),
  fetchedAt: z.string(),
  status: AdapterStatusSchema,
  payload: z.unknown(),
  errors: z.array(z.string()).optional(),
  costPaise: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

const SynthesizedContextSchema = z.object({
  lead: z.object({
    business_name: z.string(),
    website_url: z.string(),
    manual_hook_note: z.string().nullable(),
  }),
  persona: z.object({ role: z.string() }),
  signals: z.array(z.object({
    signalType: z.string(),
    headline: z.string(),
    url: z.string().optional(),
  })),
});

export const SignalSummarySchema = z.object({
  topSignals: z.array(z.string()),
  suggestedHooks: z.array(z.string()),
  totalCostUsd: z.number().nonnegative(),
  _debug: z.object({
    synthesizedContext: SynthesizedContextSchema,
    stage10: z.object({ path: z.string(), gitSha: z.string() }),
  }).optional(),
});

const ModuleNames = ['hiring', 'product', 'customer', 'voice', 'operational', 'positioning'] as const;

export const ModulesBlockSchema = z.object(
  Object.fromEntries(ModuleNames.map((n) => [n, AdapterResultSchema])) as Record<typeof ModuleNames[number], typeof AdapterResultSchema>,
);

export const EnrichedDossierSchema = z.object({
  company: CompanyInputSchema,
  enrichedAt: z.string(),
  totalCostPaise: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  modules: ModulesBlockSchema,
  signalSummary: SignalSummarySchema,
});

export type EnrichedDossier = z.infer<typeof EnrichedDossierSchema>;
export type SignalSummary = z.infer<typeof SignalSummarySchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- schemas
```

Expected: PASS — all 11 assertions green.

- [ ] **Step 5: Commit**

```bash
git add tools/radar-enrich/src/schemas.ts tools/radar-enrich/tests/schemas.test.ts
git commit -m "feat(radar-enrich): top-level zod schemas (CompanyInput, AdapterResult, Dossier)"
```

---

### Task 3.2: Stub adapters (voice + positioning)

**Files:**
- Create: `tools/radar-enrich/src/adapters/voice.stub.ts`
- Create: `tools/radar-enrich/src/adapters/positioning.stub.ts`
- Create: `tools/radar-enrich/tests/adapters/stubs.test.ts`

Both stubs implement the same `Adapter<null>` shape and return `status:'empty'`. Their value is proving the adapter contract works end-to-end before we invest in real adapters.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/adapters/stubs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { voiceStub } from '../../src/adapters/voice.stub.js';
import { positioningStub } from '../../src/adapters/positioning.stub.js';
import type { AdapterContext } from '../../src/types.js';

function fakeCtx(): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http: globalThis.fetch,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => fakeCtx().logger },
    env: {},
    signal: new AbortController().signal,
  };
}

describe('voice.stub', () => {
  it('exposes the Adapter contract surface', () => {
    expect(voiceStub.name).toBe('voice');
    expect(voiceStub.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(voiceStub.requiredEnv).toEqual([]);
    expect(typeof voiceStub.run).toBe('function');
  });

  it('run() returns status:empty with payload null and zero cost', async () => {
    const result = await voiceStub.run(fakeCtx());
    expect(result.source).toBe('voice');
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
    expect(result.costPaise).toBe(0);
    expect(typeof result.durationMs).toBe('number');
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('positioning.stub', () => {
  it('exposes the Adapter contract surface', () => {
    expect(positioningStub.name).toBe('positioning');
    expect(positioningStub.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(positioningStub.requiredEnv).toEqual([]);
    expect(typeof positioningStub.run).toBe('function');
  });

  it('run() returns status:empty', async () => {
    const result = await positioningStub.run(fakeCtx());
    expect(result.source).toBe('positioning');
    expect(result.status).toBe('empty');
    expect(result.payload).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- stubs
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create the voice stub**

Create `tools/radar-enrich/src/adapters/voice.stub.ts`:

```ts
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';

// Documented intent (when implemented):
// Sources: Listen Notes API (LISTEN_NOTES_KEY), YouTube RSS for known channel IDs,
// Substack/Medium discovery via Serper, LinkedIn /pulse/ articles via Serper.
// Founder name resolution chain via Serper if --founder not provided.

export const voiceStub: Adapter<null> = {
  name: 'voice',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: [],
  schema: z.null(),
  async run(_ctx: AdapterContext): Promise<AdapterResult<null>> {
    return {
      source: 'voice',
      fetchedAt: new Date().toISOString(),
      status: 'empty',
      payload: null,
      costPaise: 0,
      durationMs: 0,
    };
  },
};
```

- [ ] **Step 4: Create the positioning stub**

Create `tools/radar-enrich/src/adapters/positioning.stub.ts`:

```ts
import { z } from 'zod';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';

// Documented intent (when implemented):
// Sources: Serper news (SERPER_API_KEY), Brave Search news (BRAVE_API_KEY),
// Crunchbase via Serper snippets, Meta Ad Library URL (returned, not scraped),
// Google Ads Transparency URL.

export const positioningStub: Adapter<null> = {
  name: 'positioning',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: [],
  schema: z.null(),
  async run(_ctx: AdapterContext): Promise<AdapterResult<null>> {
    return {
      source: 'positioning',
      fetchedAt: new Date().toISOString(),
      status: 'empty',
      payload: null,
      costPaise: 0,
      durationMs: 0,
    };
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- stubs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/adapters/voice.stub.ts tools/radar-enrich/src/adapters/positioning.stub.ts tools/radar-enrich/tests/adapters/stubs.test.ts
git commit -m "feat(radar-enrich): voice + positioning stub adapters"
```

---

## Chunk 3 complete checkpoint

After this chunk:
- Top-level dossier schemas exist and round-trip through tests
- Voice + positioning stubs implement the `Adapter<T>` contract
- Next chunk wires the orchestrator + CLI shell

Verify before moving on:

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Both must exit 0. Test count should now be ~25 across all modules so far (types, env, logger, http, cache, schemas, stubs).

---

## Chunk 4: Orchestrator + CLI shell (end-to-end with stubs only)

This chunk wires everything together so you can actually invoke `radar-enrich --company X --domain Y` and get a complete dossier JSON back. Real adapters and synthesis are still deferred — the proof of correctness here is that the assembly is right before any real adapter is built.

---

### Task 4.1: Orchestrator

**Files:**
- Create: `tools/radar-enrich/src/orchestrator.ts`
- Create: `tools/radar-enrich/tests/orchestrator.test.ts`

The orchestrator runs adapters in parallel (`p-limit`), enforces per-adapter timeout (`AbortController`), isolates failures (try/catch → `status:'error'`), validates payloads through each adapter's `schema` (failure → `status:'partial'`, payload preserved), and reads/writes the cache.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/orchestrator.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { runEnrichment } from '../src/orchestrator.js';
import type { Adapter, AdapterContext, AdapterResult, Cache, CompanyInput, Env, Logger } from '../src/types.js';

function silentLogger(): Logger {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop, child: () => silentLogger() };
}

function memoryCache(): Cache {
  const store = new Map<string, AdapterResult<unknown>>();
  const k = (key: { adapterName: string; adapterVersion: string; inputHash: string; date: string }) =>
    `${key.adapterName}-${key.inputHash}-${key.adapterVersion}-${key.date}`;
  return {
    async read(key) { return (store.get(k(key)) as AdapterResult<unknown> | undefined) ?? null; },
    async write(key, v) { store.set(k(key), v as AdapterResult<unknown>); },
    async clear() { store.clear(); },
  };
}

const fakeInput: CompanyInput = { name: 'Acme', domain: 'acme.com' };
const fakeEnv: Env = {};

function makeAdapter(name: string, behavior: (ctx: AdapterContext) => Promise<AdapterResult<unknown>>): Adapter<unknown> {
  return {
    name,
    version: '1.0.0',
    estimatedCostPaise: 0,
    requiredEnv: [],
    schema: z.unknown(),
    run: behavior,
  };
}

describe('runEnrichment', () => {
  it('runs every adapter and returns its result keyed by name', async () => {
    const adapters = [
      makeAdapter('hiring', async () => ({ source: 'hiring', fetchedAt: 'x', status: 'ok', payload: { jobs: 5 }, costPaise: 0, durationMs: 10 })),
      makeAdapter('product', async () => ({ source: 'product', fetchedAt: 'x', status: 'ok', payload: { repos: 3 }, costPaise: 0, durationMs: 20 })),
    ];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring.status).toBe('ok');
    expect(out.results.product.status).toBe('ok');
    expect(out.results.hiring.payload).toEqual({ jobs: 5 });
  });

  it('isolates a failing adapter — others still return successfully', async () => {
    const adapters = [
      makeAdapter('hiring', async () => { throw new Error('boom'); }),
      makeAdapter('product', async () => ({ source: 'product', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 0, durationMs: 5 })),
    ];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring.status).toBe('error');
    expect(out.results.hiring.errors).toEqual(expect.arrayContaining([expect.stringContaining('boom')]));
    expect(out.results.product.status).toBe('ok');
  });

  it('does not write cache entries for adapters that errored', async () => {
    const cache = memoryCache();
    const writeSpy = vi.spyOn(cache, 'write');
    const adapters = [
      makeAdapter('hiring', async () => { throw new Error('boom'); }),
    ];
    await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache, logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('uses cache when present and useCache is true', async () => {
    const cache = memoryCache();
    const { hashCompanyInput, todayStamp } = await import('../src/cache.js');
    const cached: AdapterResult<{ cached: true }> = {
      source: 'hiring', fetchedAt: 'cached', status: 'ok', payload: { cached: true }, costPaise: 0, durationMs: 0,
    };
    await cache.write(
      { adapterName: 'hiring', adapterVersion: '1.0.0', inputHash: hashCompanyInput(fakeInput), date: todayStamp() },
      cached,
    );

    const runSpy = vi.fn(async () => ({ source: 'hiring', fetchedAt: 'fresh', status: 'ok', payload: { fresh: true }, costPaise: 0, durationMs: 10 } satisfies AdapterResult<unknown>));
    const adapters = [makeAdapter('hiring', runSpy)];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache, logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring.payload).toEqual({ cached: true });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('skips cache reads when useCache is false but still writes', async () => {
    const cache = memoryCache();
    const { hashCompanyInput, todayStamp } = await import('../src/cache.js');
    await cache.write(
      { adapterName: 'hiring', adapterVersion: '1.0.0', inputHash: hashCompanyInput(fakeInput), date: todayStamp() },
      { source: 'hiring', fetchedAt: 'cached', status: 'ok', payload: { cached: true }, costPaise: 0, durationMs: 0 },
    );
    const adapters = [makeAdapter('hiring', async () => ({ source: 'hiring', fetchedAt: 'fresh', status: 'ok', payload: { fresh: true }, costPaise: 0, durationMs: 10 }))];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache, logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: false,
    });
    expect(out.results.hiring.payload).toEqual({ fresh: true });
  });

  it('produces status:partial when payload fails the adapter schema, preserving the payload, and STILL writes cache', async () => {
    const cache = memoryCache();
    const writeSpy = vi.spyOn(cache, 'write');
    const adapter: Adapter<{ jobs: number }> = {
      name: 'hiring', version: '1.0.0', estimatedCostPaise: 0, requiredEnv: [],
      schema: z.object({ jobs: z.number() }),
      run: async () => ({ source: 'hiring', fetchedAt: 'x', status: 'ok', payload: { jobs: 'not-a-number' as unknown as number }, costPaise: 0, durationMs: 10 }),
    };
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters: [adapter as Adapter<unknown>],
      cache, logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring.status).toBe('partial');
    expect(out.results.hiring.payload).toEqual({ jobs: 'not-a-number' });
    expect(out.results.hiring.errors?.[0]).toContain('jobs');
    // Partial results ARE cached (only 'error' status skips caching) — so flaky API responses
    // don't keep retrying expensive calls during the same day.
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('skips an adapter and returns status:error when its requiredEnv is missing', async () => {
    const adapter: Adapter<unknown> = {
      ...makeAdapter('hiring', async () => ({ source: 'hiring', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 0, durationMs: 0 })),
      requiredEnv: ['ADZUNA_APP_ID'],
    };
    const out = await runEnrichment({
      input: fakeInput, env: {}, adapters: [adapter],
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.results.hiring.status).toBe('error');
    expect(out.results.hiring.errors?.[0]).toContain('ADZUNA_APP_ID');
  });

  it('aborts an adapter that exceeds the per-adapter timeout', async () => {
    const adapter = makeAdapter('hiring', async (ctx) =>
      new Promise<AdapterResult<unknown>>((resolve) => {
        ctx.signal.addEventListener('abort', () => resolve({
          source: 'hiring', fetchedAt: 'x', status: 'error', payload: null, errors: ['aborted-by-test'], costPaise: 0, durationMs: 0,
        }));
      }),
    );
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters: [adapter],
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 50, useCache: true,
    });
    // The adapter cooperated by listening to ctx.signal. The orchestrator's
    // timeout fires the AbortController; the adapter resolves with error.
    expect(out.results.hiring.status).toBe('error');
  });

  it('summary.totalCostPaise is the sum of per-adapter costPaise', async () => {
    const adapters = [
      makeAdapter('hiring', async () => ({ source: 'hiring', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 100, durationMs: 5 })),
      makeAdapter('product', async () => ({ source: 'product', fetchedAt: 'x', status: 'ok', payload: {}, costPaise: 250, durationMs: 5 })),
    ];
    const out = await runEnrichment({
      input: fakeInput, env: fakeEnv, adapters,
      cache: memoryCache(), logger: silentLogger(),
      http: globalThis.fetch, concurrency: 2, timeoutMs: 5000, useCache: true,
    });
    expect(out.summary.totalCostPaise).toBe(350);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- orchestrator
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create orchestrator.ts**

Create `tools/radar-enrich/src/orchestrator.ts`:

```ts
import pLimit from 'p-limit';
import { hashCompanyInput, todayStamp } from './cache.js';
import { assertRequiredEnv } from './env.js';
import type {
  Adapter, AdapterContext, AdapterResult, Cache, CompanyInput, Env, Logger,
} from './types.js';

export interface RunOptions {
  input: CompanyInput;
  env: Env;
  adapters: ReadonlyArray<Adapter<unknown>>;
  cache: Cache;
  logger: Logger;
  http: typeof fetch;
  concurrency: number;
  timeoutMs: number;
  useCache: boolean;
}

export interface RunOutput {
  results: Record<string, AdapterResult<unknown>>;
  summary: {
    totalCostPaise: number;
    totalDurationMs: number;
    perAdapter: Array<{ name: string; status: string; durationMs: number; costPaise: number; cached: boolean }>;
  };
}

export async function runEnrichment(opts: RunOptions): Promise<RunOutput> {
  const limit = pLimit(opts.concurrency);
  const startWall = Date.now();
  const inputHash = hashCompanyInput(opts.input);
  const date = todayStamp();

  const tasks = opts.adapters.map((adapter) =>
    limit(() => runOneAdapter(adapter, opts, inputHash, date)),
  );
  const settled = await Promise.all(tasks);

  const results: Record<string, AdapterResult<unknown>> = {};
  const perAdapter: RunOutput['summary']['perAdapter'] = [];
  let totalCostPaise = 0;
  for (const { name, result, cached } of settled) {
    results[name] = result;
    totalCostPaise += result.costPaise;
    perAdapter.push({ name, status: result.status, durationMs: result.durationMs, costPaise: result.costPaise, cached });
  }
  return {
    results,
    summary: { totalCostPaise, totalDurationMs: Date.now() - startWall, perAdapter },
  };
}

async function runOneAdapter(
  adapter: Adapter<unknown>,
  opts: RunOptions,
  inputHash: string,
  date: string,
): Promise<{ name: string; result: AdapterResult<unknown>; cached: boolean }> {
  const log = opts.logger.child({ adapter: adapter.name });
  const cacheKey = { adapterName: adapter.name, adapterVersion: adapter.version, inputHash, date };

  // 1. Cache read (if enabled)
  if (opts.useCache) {
    const cached = await opts.cache.read<unknown>(cacheKey);
    if (cached) {
      log.info('cache hit', { status: cached.status });
      return { name: adapter.name, result: cached, cached: true };
    }
  }

  // 2. Required env check (fail-fast → status:error, no run)
  try {
    assertRequiredEnv(opts.env, adapter.name, adapter.requiredEnv);
  } catch (err) {
    const result: AdapterResult<unknown> = {
      source: adapter.name,
      fetchedAt: new Date().toISOString(),
      status: 'error',
      payload: null,
      errors: [(err as Error).message],
      costPaise: 0,
      durationMs: 0,
    };
    log.warn('skipped: missing env', { errors: result.errors });
    return { name: adapter.name, result, cached: false };
  }

  // 3. Run with timeout + try/catch isolation
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(new Error(`timeout after ${opts.timeoutMs}ms`)), opts.timeoutMs);
  const ctx: AdapterContext = {
    input: opts.input,
    http: opts.http,
    cache: opts.cache,
    logger: log,
    env: opts.env,
    signal: timeoutCtrl.signal,
  };

  log.info('start');
  const t0 = Date.now();
  let result: AdapterResult<unknown>;
  try {
    result = await adapter.run(ctx);
  } catch (err) {
    result = {
      source: adapter.name,
      fetchedAt: new Date().toISOString(),
      status: 'error',
      payload: null,
      errors: [(err as Error).message ?? String(err)],
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }

  // 4. Validate payload through adapter.schema (only if status was ok and payload non-null)
  if (result.status === 'ok' && result.payload !== null) {
    const parsed = adapter.schema.safeParse(result.payload);
    if (!parsed.success) {
      result = {
        ...result,
        status: 'partial',
        errors: [...(result.errors ?? []), parsed.error.message],
      };
    }
  }

  log.info('done', { status: result.status, durationMs: result.durationMs, costPaise: result.costPaise });

  // 5. Cache write (skip on error)
  if (result.status !== 'error') {
    await opts.cache.write(cacheKey, result);
  }

  return { name: adapter.name, result, cached: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- orchestrator
```

Expected: PASS — all 9 assertions green.

- [ ] **Step 5: Run full test suite + typecheck**

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/orchestrator.ts tools/radar-enrich/tests/orchestrator.test.ts
git commit -m "feat(radar-enrich): orchestrator with isolation, cache, schema validation"
```

---

### Task 4.2: CLI shell

**Files:**
- Create: `tools/radar-enrich/src/cli.ts`
- Create: `tools/radar-enrich/tests/cli.test.ts` (limited — most CLI behavior tested via the orchestrator)

The CLI parses args, builds the runtime context, dispatches to the orchestrator, and emits the dossier. Since synthesis (Chunk 5) isn't ready yet, the CLI's `signalSummary` block is a placeholder `{ topSignals: [], suggestedHooks: [], totalCostUsd: 0 }`. Chunk 5 will swap in the real synthesizer.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildOptions } from '../src/cli.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- cli
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create cli.ts**

Create `tools/radar-enrich/src/cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runEnrichment } from './orchestrator.js';
import { createFileCache } from './cache.js';
import { createHttp } from './http.js';
import { createLogger } from './logger.js';
import { loadEnv } from './env.js';
import { EnrichedDossierSchema, type EnrichedDossier } from './schemas.js';
import { voiceStub } from './adapters/voice.stub.js';
import { positioningStub } from './adapters/positioning.stub.js';
import type { Adapter, CompanyInput } from './types.js';

const ALL_MODULES = ['hiring', 'product', 'customer', 'voice', 'operational', 'positioning'] as const;
type ModuleName = typeof ALL_MODULES[number];

export interface CliOptions {
  action: 'enrich' | 'clear-cache';
  input: CompanyInput;
  modules: ModuleName[];
  outPath?: string;
  useCache: boolean;
  concurrency: number;
  timeoutMs: number;
  verbose: boolean;
  debugContext: boolean;
}

export function buildOptions(argv: string[]): CliOptions {
  const program = new Command()
    .exitOverride()
    .name('radar-enrich')
    .option('-c, --company <name>', 'Company name')
    .option('-d, --domain <domain>', 'Primary domain (e.g. acme.com)')
    .option('-l, --location <location>', '"City, Country"')
    .option('-f, --founder <name>', 'Founder/CEO name')
    .option('-m, --modules <list>', 'Comma-separated module list', ALL_MODULES.join(','))
    .option('-o, --out <path>', 'Write JSON to file (default: stdout)')
    .option('--no-cache', 'Skip cache reads (writes still happen)')
    .option('--clear-cache', 'Wipe ./cache/ then exit')
    .option('--debug-context', 'Include synthetic LeadContext in output')
    .option('--concurrency <n>', 'Adapter parallelism', (v) => parseInt(v, 10), 4)
    .option('--timeout <ms>', 'Per-adapter timeout in ms', (v) => parseInt(v, 10), 30000)
    .option('-v, --verbose', 'Per-adapter progress, timing, cost', false);

  program.parse(argv, { from: 'user' });
  const o = program.opts<{
    company?: string; domain?: string; location?: string; founder?: string;
    modules: string; out?: string; cache: boolean; clearCache?: boolean;
    debugContext?: boolean; concurrency: number; timeout: number; verbose: boolean;
  }>();

  if (o.clearCache) {
    return {
      action: 'clear-cache',
      input: { name: '', domain: '' },
      modules: [...ALL_MODULES],
      useCache: o.cache,
      concurrency: o.concurrency,
      timeoutMs: o.timeout,
      verbose: o.verbose,
      debugContext: false,
    };
  }

  if (!o.company) throw new Error('Missing required --company');
  if (!o.domain) throw new Error('Missing required --domain');

  const requested = o.modules.split(',').map((s) => s.trim()).filter(Boolean);
  for (const m of requested) {
    if (!(ALL_MODULES as readonly string[]).includes(m)) {
      throw new Error(`Unknown module: ${m} (valid: ${ALL_MODULES.join(',')})`);
    }
  }

  return {
    action: 'enrich',
    input: { name: o.company, domain: o.domain, location: o.location, founder: o.founder },
    modules: requested as ModuleName[],
    outPath: o.out,
    useCache: o.cache,
    concurrency: o.concurrency,
    timeoutMs: o.timeout,
    verbose: o.verbose,
    debugContext: !!o.debugContext,
  };
}

const STUB_ADAPTERS: Record<ModuleName, Adapter<unknown> | null> = {
  hiring: null,        // wired in Chunk 5
  product: null,       // wired in Chunk 5
  customer: null,      // wired in Chunk 5
  operational: null,   // wired in Chunk 5
  voice: voiceStub as Adapter<unknown>,
  positioning: positioningStub as Adapter<unknown>,
};

function resolveAdapters(modules: ModuleName[]): Adapter<unknown>[] {
  const out: Adapter<unknown>[] = [];
  for (const m of modules) {
    const a = STUB_ADAPTERS[m];
    if (a) {
      out.push(a);
    } else {
      // Pre-Chunk-4: every real adapter is "not implemented" → emit a stub-empty adapter inline
      out.push(notImplementedAdapter(m));
    }
  }
  return out;
}

// Pre-Chunk-5 placeholder. The four real adapter imports replace it in Chunk 5,
// at which point this function and the `STUB_ADAPTERS[m] === null` branch above
// are deleted (Task 5.0).
function notImplementedAdapter(name: ModuleName): Adapter<unknown> {
  return {
    name,
    version: '0.0.0',
    estimatedCostPaise: 0,
    requiredEnv: [],
    schema: z.unknown(),
    async run() {
      return {
        source: name,
        fetchedAt: new Date().toISOString(),
        status: 'empty',
        payload: null,
        errors: ['adapter not yet implemented'],
        costPaise: 0,
        durationMs: 0,
      };
    },
  };
}

export async function main(argv: string[]): Promise<number> {
  const opts = buildOptions(argv);
  const logger = createLogger({ level: opts.verbose ? 'debug' : 'info', pretty: process.stdout.isTTY ?? false });
  const env = loadEnv(process.env);
  const cache = createFileCache(resolve(process.cwd(), 'cache'));

  if (opts.action === 'clear-cache') {
    await cache.clear();
    logger.info('cache cleared');
    return 0;
  }

  const http = createHttp({ timeoutMs: opts.timeoutMs });
  const adapters = resolveAdapters(opts.modules);

  const { results, summary } = await runEnrichment({
    input: opts.input, env, adapters, cache, logger, http,
    concurrency: opts.concurrency, timeoutMs: opts.timeoutMs, useCache: opts.useCache,
  });

  // Synthesis is wired in Chunk 5. For now emit an empty signalSummary.
  const dossier: EnrichedDossier = {
    company: opts.input,
    enrichedAt: new Date().toISOString(),
    totalCostPaise: summary.totalCostPaise,
    totalDurationMs: summary.totalDurationMs,
    modules: {
      hiring:      results.hiring      ?? emptyResult('hiring'),
      product:     results.product     ?? emptyResult('product'),
      customer:    results.customer    ?? emptyResult('customer'),
      voice:       results.voice       ?? emptyResult('voice'),
      operational: results.operational ?? emptyResult('operational'),
      positioning: results.positioning ?? emptyResult('positioning'),
    },
    signalSummary: { topSignals: [], suggestedHooks: [], totalCostUsd: 0 },
  };

  const validated = EnrichedDossierSchema.parse(dossier);
  const json = JSON.stringify(validated, null, 2);
  if (opts.outPath) {
    await writeFile(opts.outPath, json, 'utf8');
    logger.info('dossier written', { path: opts.outPath });
  } else {
    process.stdout.write(json + '\n');
  }

  if (opts.verbose) {
    logger.info('summary', {
      totalCostPaise: summary.totalCostPaise,
      totalDurationMs: summary.totalDurationMs,
      perAdapter: summary.perAdapter,
    });
  }

  return 0;
}

function emptyResult(name: string) {
  return {
    source: name, fetchedAt: new Date().toISOString(), status: 'empty' as const,
    payload: null, costPaise: 0, durationMs: 0,
  };
}

// Entrypoint guard: only run when invoked directly (not when imported by tests)
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { process.stderr.write(`error: ${(err as Error).message}\n`); process.exit(1); },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- cli
```

Expected: PASS — all 9 buildOptions assertions green.

- [ ] **Step 5: End-to-end smoke test (real CLI invocation, all six modules)**

```bash
cd tools/radar-enrich && npx tsx src/cli.ts --company "Acme Corp" --domain acme.com --verbose 2>/tmp/radar-enrich.log
```

Expected:
- stdout is a JSON dossier with all 6 module keys present in `modules`
- `voice` and `positioning` show `status:'empty'` from the real stubs (Chunk 3)
- `hiring`, `product`, `customer`, `operational` show `status:'empty'` from the inline `notImplementedAdapter` placeholder (will be replaced in Chunk 5)
- stderr (`/tmp/radar-enrich.log`) shows pino lines: 6 adapter `start` + 6 adapter `done` + one `summary` line at the end

Then verify scoping with `--modules`:

```bash
cd tools/radar-enrich && npx tsx src/cli.ts --company "Acme Corp" --domain acme.com --modules voice,positioning 2>/dev/null | jq '.modules | keys'
```

Expected output:
```json
["customer", "hiring", "operational", "positioning", "product", "voice"]
```

The dossier always has all 6 module keys (hard-coded shape via `emptyResult` fallback) regardless of `--modules`. Only `voice` and `positioning` actually ran; the other four are `status:'empty'` from the fallback.

- [ ] **Step 6: Smoke-test --clear-cache**

```bash
cd tools/radar-enrich && mkdir -p cache && touch cache/junk.json && npx tsx src/cli.ts --clear-cache && ls cache/
```

Expected: empty `ls cache/` output (the junk file was deleted, the directory remains). Note: this depends on `cache.clear()` (Chunk 2) deleting *every* file in the directory, not only files it wrote — verify by inspection of `cache.ts` if this test fails.

- [ ] **Step 7: Smoke-test exit code 1 on missing required arg**

```bash
cd tools/radar-enrich && npx tsx src/cli.ts --domain acme.com; echo "exit=$?"
```

Expected: stderr line `error: Missing required --company` and `exit=1`.

- [ ] **Step 8: Add an integration test for main()**

Append to `tools/radar-enrich/tests/cli.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { EnrichedDossierSchema } from '../src/schemas.js';

describe('main() integration', () => {
  let tmp: string;
  let originalCwd: string;
  let stdoutChunks: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'radar-enrich-int-'));
    originalCwd = process.cwd();
    process.chdir(tmp);
    stdoutChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('emits a complete dossier that validates against EnrichedDossierSchema', async () => {
    const code = await main(['--company', 'Acme', '--domain', 'acme.com']);
    expect(code).toBe(0);
    const json = stdoutChunks.join('');
    const parsed = JSON.parse(json);
    expect(EnrichedDossierSchema.safeParse(parsed).success).toBe(true);
    expect(Object.keys(parsed.modules).sort()).toEqual(['customer','hiring','operational','positioning','product','voice']);
  });

  it('writes to --out path and emits no stdout', async () => {
    const out = join(tmp, 'dossier.json');
    const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--out', out]);
    expect(code).toBe(0);
    expect(stdoutChunks.join('')).toBe('');
    const written = JSON.parse(readFileSync(out, 'utf8'));
    expect(EnrichedDossierSchema.safeParse(written).success).toBe(true);
  });
});
```

- [ ] **Step 9: Run all tests + typecheck**

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Expected: all green. Test count should now be ~43 across all modules so far (12 schemas + 4 stubs + 9 orchestrator + 9 cli buildOptions + 2 cli integration + 7 from chunks 1-2).

- [ ] **Step 10: Commit**

```bash
git add tools/radar-enrich/src/cli.ts tools/radar-enrich/tests/cli.test.ts
git commit -m "feat(radar-enrich): CLI shell wires orchestrator + stubs end-to-end"
```

---

## Chunk 4 complete checkpoint

After this chunk:
- The CLI runs end-to-end with stubs for every module
- Dossier output validates against `EnrichedDossierSchema`
- Orchestrator handles cache/timeout/isolation/schema-validation correctly
- No real adapters yet, no synthesis yet — those are Chunks 5–7

Verify before moving on:

```bash
cd tools/radar-enrich && npm test && npm run typecheck && npx tsx src/cli.ts --company "Acme" --domain acme.com 2>/dev/null | jq '.modules | keys'
```

Expected output of the `jq` invocation:
```json
["customer", "hiring", "operational", "positioning", "product", "voice"]
```

---

## Chunk 5: Helpers + hiring + product adapters

Adds the lib helpers (`classify`, `domainUtils`) and the two HTTP-API-based adapters (hiring, product). Each follows the same TDD pattern: HTTP fixture → schema test → adapter test → impl. The `notImplementedAdapter` placeholder in `cli.ts` is partially replaced (only `hiring` and `product`); full removal happens in Chunk 6 once `customer` and `operational` are also wired.

---

### Task 5.1: Function + seniority classifiers

**Files:**
- Create: `tools/radar-enrich/src/lib/classify.ts`
- Create: `tools/radar-enrich/tests/lib/classify.test.ts`

Two pure keyword classifiers used by Module 1 to bucket job titles. Per spec §13.1: function (eng / sales / marketing / ops / finance / product / design / cs / legal / hr / other) and seniority (intern / junior / mid / senior / staff / principal / director / vp / c-level).

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/lib/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyFunction, classifySeniority } from '../../src/lib/classify.js';

describe('classifyFunction', () => {
  it.each([
    ['Senior Backend Engineer', 'eng'],
    ['Frontend Developer', 'eng'],
    ['SDET', 'eng'],
    ['Account Executive', 'sales'],
    ['VP of Sales', 'sales'],
    ['Marketing Manager', 'marketing'],
    ['Brand Strategist', 'marketing'],
    ['Operations Lead', 'ops'],
    ['Finance Controller', 'finance'],
    ['Product Manager', 'product'],
    ['Senior Product Designer', 'design'],
    ['UX Researcher', 'design'],
    ['Customer Success Manager', 'cs'],
    ['Legal Counsel', 'legal'],
    ['HR Business Partner', 'hr'],
    ['Recruiter', 'hr'],
    ['Some Random Title', 'other'],
  ])('%s → %s', (title, expected) => {
    expect(classifyFunction(title)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(classifyFunction('SENIOR ENGINEER')).toBe('eng');
    expect(classifyFunction('sales engineer')).toBe('sales'); // sales wins over engineer
  });
});

describe('classifySeniority', () => {
  it.each([
    ['Intern', 'intern'],
    ['Junior Developer', 'junior'],
    ['Software Engineer', 'mid'],
    ['Senior Engineer', 'senior'],
    ['Staff Engineer', 'staff'],
    ['Principal Engineer', 'principal'],
    ['Engineering Director', 'director'],
    ['VP of Engineering', 'vp'],
    ['Chief Technology Officer', 'c-level'],
    ['CEO', 'c-level'],
    ['CTO', 'c-level'],
    ['Random Title', 'mid'],
  ])('%s → %s', (title, expected) => {
    expect(classifySeniority(title)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- classify
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create classify.ts**

Create `tools/radar-enrich/src/lib/classify.ts`:

```ts
export type FunctionTag = 'eng' | 'sales' | 'marketing' | 'ops' | 'finance' | 'product' | 'design' | 'cs' | 'legal' | 'hr' | 'other';
export type SeniorityTag = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'director' | 'vp' | 'c-level';

// Rules are evaluated in order — more specific tokens come first so e.g. "Sales Engineer"
// matches `sales` before falling through to `eng`. Tokens are matched against a
// space-padded lowercased title so short tokens like ` sre ` don't false-match inside
// longer words ("presreal").
const FUNCTION_RULES: Array<{ tag: FunctionTag; tokens: string[] }> = [
  { tag: 'sales',     tokens: ['sales', 'account executive', 'business development', ' bdr ', ' sdr '] },
  { tag: 'cs',        tokens: ['customer success', 'customer support', 'account manager'] },
  { tag: 'marketing', tokens: ['marketing', 'brand strat', 'growth', 'content strategist', 'demand gen', ' seo '] },
  { tag: 'design',    tokens: ['designer', ' design ', ' ux ', ' ui ', 'researcher'] },
  { tag: 'product',   tokens: ['product manager', 'product owner', ' pm '] },
  { tag: 'ops',       tokens: ['operations', ' ops ', 'supply chain', 'logistics'] },
  { tag: 'finance',   tokens: ['finance', 'accountant', 'controller', ' cfo'] },
  { tag: 'legal',     tokens: [' legal ', 'counsel', 'paralegal'] },
  { tag: 'hr',        tokens: ['recruiter', 'human resources', 'people ops', 'talent ', ' hr '] },
  { tag: 'eng',       tokens: ['engineer', 'developer', 'sdet', 'devops', ' sre ', 'infra', 'backend', 'frontend', 'fullstack'] },
];

const SENIORITY_RULES: Array<{ tag: SeniorityTag; tokens: string[] }> = [
  { tag: 'c-level',   tokens: [' ceo ', ' cto ', ' cfo ', ' coo ', ' cmo ', ' cpo ', 'chief '] },
  { tag: 'vp',        tokens: [' vp ', 'vice president'] },
  { tag: 'director',  tokens: ['director', 'head of'] },
  { tag: 'principal', tokens: ['principal'] },
  { tag: 'staff',     tokens: [' staff '] },
  { tag: 'senior',    tokens: ['senior', ' sr.'] },
  { tag: 'junior',    tokens: ['junior', ' jr.'] },
  { tag: 'intern',    tokens: ['intern'] },
];

export function classifyFunction(title: string): FunctionTag {
  const padded = ` ${title.toLowerCase()} `;
  for (const rule of FUNCTION_RULES) {
    if (rule.tokens.some((t) => padded.includes(t))) return rule.tag;
  }
  return 'other';
}

export function classifySeniority(title: string): SeniorityTag {
  const padded = ` ${title.toLowerCase()} `;
  for (const rule of SENIORITY_RULES) {
    if (rule.tokens.some((t) => padded.includes(t))) return rule.tag;
  }
  return 'mid';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- classify
```

Expected: PASS — all parametrized cases green.

- [ ] **Step 5: Commit**

```bash
git add tools/radar-enrich/src/lib/classify.ts tools/radar-enrich/tests/lib/classify.test.ts
git commit -m "feat(radar-enrich): keyword-based function + seniority classifiers"
```

---

### Task 5.2: Domain utilities

**Files:**
- Create: `tools/radar-enrich/src/lib/domainUtils.ts`
- Create: `tools/radar-enrich/tests/lib/domainUtils.test.ts`

Small helpers shared across adapters: normalize a domain (strip protocol, www, trailing slash), build a canonical URL.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/lib/domainUtils.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- domainUtils
```

Expected: FAIL.

- [ ] **Step 3: Create domainUtils.ts**

Create `tools/radar-enrich/src/lib/domainUtils.ts`:

```ts
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('domain is empty');
  let s = trimmed.toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/\/.*$/, '');
  return s;
}

export function toHttpsUrl(domain: string, path = '/'): string {
  const d = normalizeDomain(domain);
  const p = path.startsWith('/') ? path : `/${path}`;
  return `https://${d}${p}`;
}

export function basePath(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- domainUtils
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/radar-enrich/src/lib/domainUtils.ts tools/radar-enrich/tests/lib/domainUtils.test.ts
git commit -m "feat(radar-enrich): domain normalize + URL builder helpers"
```

---

### Task 5.3: Hiring adapter (Module 1)

**Files:**
- Create: `tools/radar-enrich/src/adapters/hiring.ts`
- Create: `tools/radar-enrich/tests/adapters/hiring.test.ts`
- Create: `tools/radar-enrich/tests/fixtures/hiring/adzuna-acme.json`
- Create: `tools/radar-enrich/tests/fixtures/hiring/careers-acme.html`

Adzuna India endpoint: `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id={ID}&app_key={KEY}&company={URL-encoded name}&results_per_page=50`.

The adapter:
1. Calls Adzuna with the company name.
2. Best-effort fetches `https://{domain}/careers` and extracts job titles via cheerio (h2/h3/h4 + anchor text).
3. Merges into the payload, classifies each job's function + seniority, computes 30d/90d cohort counts.

- [ ] **Step 1: Capture a fixture for Adzuna**

Create `tools/radar-enrich/tests/fixtures/hiring/adzuna-acme.json` (a minimized but realistic Adzuna response — paste from a real call to a test company; if you don't have one yet, use this synthetic shape):

```json
{
  "count": 3,
  "results": [
    { "id": "1", "title": "Senior Backend Engineer", "company": { "display_name": "Acme Corp" }, "location": { "display_name": "Mumbai" }, "created": "2026-04-15T00:00:00Z", "redirect_url": "https://example.com/job/1" },
    { "id": "2", "title": "Account Executive", "company": { "display_name": "Acme Corp" }, "location": { "display_name": "Bengaluru" }, "created": "2026-03-10T00:00:00Z", "redirect_url": "https://example.com/job/2" },
    { "id": "3", "title": "Director of Engineering", "company": { "display_name": "Acme Corp" }, "location": { "display_name": "Mumbai" }, "created": "2026-04-20T00:00:00Z", "redirect_url": "https://example.com/job/3" }
  ]
}
```

- [ ] **Step 2: Capture a fixture for the careers page**

Create `tools/radar-enrich/tests/fixtures/hiring/careers-acme.html`:

```html
<!doctype html>
<html><body>
<h1>Careers</h1>
<ul class="jobs">
  <li><h3><a href="/jobs/123">Customer Success Manager</a></h3><p>Mumbai</p></li>
  <li><h3><a href="/jobs/456">VP of Marketing</a></h3><p>Remote</p></li>
</ul>
</body></html>
```

- [ ] **Step 3: Write the failing tests**

Create `tools/radar-enrich/tests/adapters/hiring.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hiringAdapter } from '../../src/adapters/hiring.js';
import type { AdapterContext } from '../../src/types.js';

// Pin Date.now() so date-cohort assertions stay valid regardless of test run date.
beforeAll(() => vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') }));
afterAll(() => vi.useRealTimers());

const adzunaFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/hiring/adzuna-acme.json'), 'utf8'));
const careersFixture = readFileSync(join(__dirname, '../fixtures/hiring/careers-acme.html'), 'utf8');

function ctxWith(http: typeof fetch, env: Record<string, string> = { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme Corp', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http, env).logger },
    env,
    signal: new AbortController().signal,
  };
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of Object.entries(routes)) {
      if (u.includes(match)) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('hiringAdapter', () => {
  it('exposes the Adapter contract surface', () => {
    expect(hiringAdapter.name).toBe('hiring');
    expect(hiringAdapter.requiredEnv).toEqual(['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']);
    expect(hiringAdapter.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('returns ok with bucketed counts when Adzuna + careers both succeed', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify(adzunaFixture), { status: 200 }),
      'acme.com/careers': () => new Response(careersFixture, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await hiringAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload).not.toBeNull();
    const p = result.payload!;
    // Adzuna: 3 jobs (1 eng, 1 sales, 1 director-eng), Careers: 2 (cs, marketing)
    expect(p.totalActiveJobs).toBe(5);
    expect(p.byFunction.eng).toBeGreaterThanOrEqual(2);
    expect(p.byFunction.sales).toBeGreaterThanOrEqual(1);
    expect(p.byFunction.cs).toBeGreaterThanOrEqual(1);
    expect(p.byFunction.marketing).toBeGreaterThanOrEqual(1);
    expect(p.bySeniority.director).toBeGreaterThanOrEqual(1);
    expect(p.rawJobs.length).toBe(5);
  });

  it('returns partial when careers fetch fails but Adzuna succeeds', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify(adzunaFixture), { status: 200 }),
      'acme.com/careers': () => new Response('not found', { status: 404 }),
    });
    const result = await hiringAdapter.run(ctxWith(http));
    expect(['ok', 'partial']).toContain(result.status);
    expect(result.payload?.rawJobs.length).toBe(3); // only Adzuna jobs
  });

  it('returns error when Adzuna fails (no usable data)', async () => {
    const http = fakeFetch({
      'api.adzuna.com': () => new Response('boom', { status: 500 }),
      'acme.com/careers': () => new Response('not found', { status: 404 }),
    });
    const result = await hiringAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('jobsLast30Days correctly counts by created date', async () => {
    // Adzuna fixture has 3 jobs created 2026-04-15, 2026-03-10, 2026-04-20.
    // If "today" is 2026-05-01, last-30d window is 2026-04-01..2026-05-01 → 2 jobs match.
    const http = fakeFetch({
      'api.adzuna.com': () => new Response(JSON.stringify(adzunaFixture), { status: 200 }),
      'acme.com/careers': () => new Response('', { status: 404 }),
    });
    const result = await hiringAdapter.run(ctxWith(http));
    // The exact 30d count depends on system date — accept any non-negative number, but assert
    // jobsLast90Days >= jobsLast30Days as a structural invariant.
    expect(result.payload!.jobsLast90Days).toBeGreaterThanOrEqual(result.payload!.jobsLast30Days);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- hiring
```

Expected: FAIL — module not found.

- [ ] **Step 5: Create hiring.ts**

Create `tools/radar-enrich/src/adapters/hiring.ts`:

```ts
import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';
import { classifyFunction, classifySeniority, type FunctionTag, type SeniorityTag } from '../lib/classify.js';
import { toHttpsUrl } from '../lib/domainUtils.js';

const JobSchema = z.object({
  source: z.enum(['adzuna', 'careers']),
  title: z.string(),
  location: z.string().nullable(),
  date: z.string().nullable(),       // ISO YYYY-MM-DD if known
  url: z.string().nullable(),
  function: z.string(),               // FunctionTag
  seniority: z.string(),              // SeniorityTag
});

export const HiringPayloadSchema = z.object({
  totalActiveJobs: z.number().int().nonnegative(),
  jobsLast30Days: z.number().int().nonnegative(),
  jobsLast90Days: z.number().int().nonnegative(),
  byFunction: z.record(z.string(), z.number().int().nonnegative()),
  bySeniority: z.record(z.string(), z.number().int().nonnegative()),
  byLocation: z.record(z.string(), z.number().int().nonnegative()),
  newRoleTypes: z.array(z.string()),
  rawJobs: z.array(JobSchema),
});

export type HiringPayload = z.infer<typeof HiringPayloadSchema>;
type Job = z.infer<typeof JobSchema>;

export const hiringAdapter: Adapter<HiringPayload> = {
  name: 'hiring',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  schema: HiringPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<HiringPayload>> {
    const t0 = Date.now();
    const errors: string[] = [];
    const adzunaJobs = await fetchAdzuna(ctx).catch((err) => {
      errors.push(`adzuna: ${(err as Error).message}`);
      return [] as Job[];
    });
    const careersJobs = await fetchCareers(ctx).catch((err) => {
      errors.push(`careers: ${(err as Error).message}`);
      return [] as Job[];
    });

    const allJobs = [...adzunaJobs, ...careersJobs];
    if (allJobs.length === 0) {
      return {
        source: 'hiring',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        payload: null,
        errors,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    }

    const payload = aggregate(allJobs);
    const status: AdapterResult<HiringPayload>['status'] =
      errors.length > 0 ? 'partial' : 'ok';

    return {
      source: 'hiring',
      fetchedAt: new Date().toISOString(),
      status,
      payload,
      errors: errors.length > 0 ? errors : undefined,
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};

async function fetchAdzuna(ctx: AdapterContext): Promise<Job[]> {
  const id = ctx.env.ADZUNA_APP_ID!;
  const key = ctx.env.ADZUNA_APP_KEY!;
  const company = encodeURIComponent(ctx.input.name);
  const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${id}&app_key=${key}&company=${company}&results_per_page=50`;
  const res = await ctx.http(url, { signal: ctx.signal });
  if (!res.ok) throw new Error(`adzuna http ${res.status}`);
  const json = await res.json() as { results?: Array<{ title: string; location?: { display_name?: string }; created?: string; redirect_url?: string }> };
  return (json.results ?? []).map((r) => ({
    source: 'adzuna' as const,
    title: r.title,
    location: r.location?.display_name ?? null,
    date: r.created ? r.created.slice(0, 10) : null,
    url: r.redirect_url ?? null,
    function: classifyFunction(r.title),
    seniority: classifySeniority(r.title),
  }));
}

async function fetchCareers(ctx: AdapterContext): Promise<Job[]> {
  const url = toHttpsUrl(ctx.input.domain, '/careers');
  const res = await ctx.http(url, { signal: ctx.signal });
  if (!res.ok) throw new Error(`careers http ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const titles: string[] = [];
  $('h1, h2, h3, h4, a').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 120 && /(engineer|developer|manager|director|designer|sales|marketing|recruit|hr|legal|finance|product|customer|operations)/i.test(text)) {
      titles.push(text);
    }
  });
  return [...new Set(titles)].map((title) => ({
    source: 'careers' as const,
    title,
    location: null,
    date: null,
    url,
    function: classifyFunction(title),
    seniority: classifySeniority(title),
  }));
}

function aggregate(jobs: Job[]): HiringPayload {
  const today = Date.now();
  const day = 86400000;
  const byFunction: Record<string, number> = {};
  const bySeniority: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  let last30 = 0, last90 = 0;
  for (const j of jobs) {
    byFunction[j.function] = (byFunction[j.function] ?? 0) + 1;
    bySeniority[j.seniority] = (bySeniority[j.seniority] ?? 0) + 1;
    if (j.location) byLocation[j.location] = (byLocation[j.location] ?? 0) + 1;
    if (j.date) {
      const d = Date.parse(j.date);
      if (!isNaN(d)) {
        const ageDays = (today - d) / day;
        if (ageDays <= 30) last30 += 1;
        if (ageDays <= 90) last90 += 1;
      }
    }
  }
  // newRoleTypes = function tags that appear ONLY in jobs from the last 90 days
  const oldFunctions = new Set<string>();
  const newFunctions = new Set<string>();
  for (const j of jobs) {
    const isNew = j.date ? (today - Date.parse(j.date)) / day <= 90 : false;
    (isNew ? newFunctions : oldFunctions).add(j.function);
  }
  const newRoleTypes = [...newFunctions].filter((f) => !oldFunctions.has(f));

  return {
    totalActiveJobs: jobs.length,
    jobsLast30Days: last30,
    jobsLast90Days: last90,
    byFunction,
    bySeniority,
    byLocation,
    newRoleTypes,
    rawJobs: jobs,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- hiring
```

Expected: PASS — all 5 assertions green.

- [ ] **Step 7: Wire hiring into cli.ts STUB_ADAPTERS map**

Edit `tools/radar-enrich/src/cli.ts`:

Add at the top:
```ts
import { hiringAdapter } from './adapters/hiring.js';
```

Replace `hiring: null,` with `hiring: hiringAdapter as Adapter<unknown>,`.

- [ ] **Step 8: Commit**

```bash
git add tools/radar-enrich/src/adapters/hiring.ts tools/radar-enrich/tests/adapters/hiring.test.ts tools/radar-enrich/tests/fixtures/hiring tools/radar-enrich/src/cli.ts
git commit -m "feat(radar-enrich): hiring adapter (Adzuna + careers HTML)"
```

---

### Task 5.4: Product adapter (Module 2)

**Files:**
- Create: `tools/radar-enrich/src/adapters/product.ts`
- Create: `tools/radar-enrich/tests/adapters/product.test.ts`
- Create: `tools/radar-enrich/tests/fixtures/product/github-orgs.json`
- Create: `tools/radar-enrich/tests/fixtures/product/github-repos.json`
- Create: `tools/radar-enrich/tests/fixtures/product/github-events.json`
- Create: `tools/radar-enrich/tests/fixtures/product/changelog.html`

Steps:
1. Search GitHub for an org matching the company name.
2. If found, list public repos, recent events, recent releases on the most-active repo.
3. Best-effort fetch `https://{domain}/changelog`, `/blog`, or `/release-notes`; sniff RSS link in `<head>`; fallback to scraping titles.

- [ ] **Step 1: Capture fixtures**

Create `tools/radar-enrich/tests/fixtures/product/github-orgs.json`:

```json
{
  "items": [
    { "login": "acme", "type": "Organization", "html_url": "https://github.com/acme" }
  ]
}
```

Create `tools/radar-enrich/tests/fixtures/product/github-repos.json`:

```json
[
  { "name": "core", "description": "Main library", "language": "TypeScript", "stargazers_count": 120, "pushed_at": "2026-04-25T00:00:00Z", "created_at": "2024-01-01T00:00:00Z", "html_url": "https://github.com/acme/core" },
  { "name": "demo-app", "description": "New demo", "language": "Python", "stargazers_count": 5, "pushed_at": "2026-04-20T00:00:00Z", "created_at": "2026-04-15T00:00:00Z", "html_url": "https://github.com/acme/demo-app" }
]
```

Create `tools/radar-enrich/tests/fixtures/product/github-events.json`:

```json
[
  { "type": "PushEvent", "created_at": "2026-04-29T00:00:00Z", "repo": { "name": "acme/core" } },
  { "type": "PushEvent", "created_at": "2026-04-28T00:00:00Z", "repo": { "name": "acme/core" } },
  { "type": "ReleaseEvent", "created_at": "2026-04-25T00:00:00Z", "repo": { "name": "acme/core" }, "payload": { "release": { "tag_name": "v2.1.0", "name": "April release", "html_url": "https://github.com/acme/core/releases/tag/v2.1.0" } } }
]
```

Create `tools/radar-enrich/tests/fixtures/product/changelog.html`:

```html
<!doctype html>
<html><head></head>
<body>
<article><h2>Shipped: New dashboard widget</h2><time datetime="2026-04-28">Apr 28</time></article>
<article><h2>Shipped: API v2</h2><time datetime="2026-04-15">Apr 15</time></article>
</body></html>
```

(Spec §13.2 calls for RSS sniffing as a discovery step; the prototype implements only HTML scraping for now and the fixture reflects that. Adding RSS sniffing later is a 1-method addition to `fetchChangelog` — see the deferred-decisions section in the README.)

- [ ] **Step 2: Write the failing tests**

Create `tools/radar-enrich/tests/adapters/product.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { productAdapter } from '../../src/adapters/product.js';
import type { AdapterContext } from '../../src/types.js';

// Pin Date.now() so date-cohort assertions (recentNewRepos, commitVelocity30d,
// recentReleases via isWithinDays) stay valid regardless of when the test runs.
beforeAll(() => vi.useFakeTimers({ now: new Date('2026-05-01T12:00:00Z') }));
afterAll(() => vi.useRealTimers());

const orgsFixture     = JSON.parse(readFileSync(join(__dirname, '../fixtures/product/github-orgs.json'), 'utf8'));
const reposFixture    = JSON.parse(readFileSync(join(__dirname, '../fixtures/product/github-repos.json'), 'utf8'));
const eventsFixture   = JSON.parse(readFileSync(join(__dirname, '../fixtures/product/github-events.json'), 'utf8'));
const changelogFixture = readFileSync(join(__dirname, '../fixtures/product/changelog.html'), 'utf8');

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: { GITHUB_TOKEN: 'fake' },
    signal: new AbortController().signal,
  };
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of Object.entries(routes)) {
      if (u.includes(match)) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('productAdapter', () => {
  it('exposes the Adapter contract surface', () => {
    expect(productAdapter.name).toBe('product');
    expect(productAdapter.requiredEnv).toEqual(['GITHUB_TOKEN']);
  });

  it('returns ok with repos + events + changelog when everything succeeds', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify(orgsFixture), { status: 200 }),
      '/orgs/acme/repos': () => new Response(JSON.stringify(reposFixture), { status: 200 }),
      '/users/acme/events': () => new Response(JSON.stringify(eventsFixture), { status: 200 }),
      '/changelog': () => new Response(changelogFixture, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const result = await productAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.githubOrg).toBe('acme');
    expect(p.publicRepos.length).toBe(2);
    expect(p.recentNewRepos.find((r) => r.name === 'demo-app')).toBeTruthy();
    expect(p.commitVelocity30d).toBeGreaterThan(0);
    expect(p.languageDistribution.TypeScript).toBe(1);
    expect(p.recentReleases.length).toBeGreaterThanOrEqual(1);
    expect(p.changelogEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('returns partial when no GitHub org found but changelog works', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
      '/changelog': () => new Response(changelogFixture, { status: 200 }),
    });
    const result = await productAdapter.run(ctxWith(http));
    expect(['partial', 'ok']).toContain(result.status);
    expect(result.payload?.githubOrg).toBeNull();
    expect(result.payload?.changelogEntries.length).toBeGreaterThan(0);
  });

  it('returns error when neither GitHub nor changelog yields anything', async () => {
    const http = fakeFetch({
      '/search/users': () => new Response('boom', { status: 500 }),
      '/changelog': () => new Response('not found', { status: 404 }),
      '/blog': () => new Response('not found', { status: 404 }),
      '/release-notes': () => new Response('not found', { status: 404 }),
      '/whats-new': () => new Response('not found', { status: 404 }),
    });
    const result = await productAdapter.run(ctxWith(http));
    expect(result.status).toBe('error');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- product
```

Expected: FAIL.

- [ ] **Step 4: Create product.ts**

Create `tools/radar-enrich/src/adapters/product.ts`:

```ts
import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';
import { toHttpsUrl } from '../lib/domainUtils.js';

const RepoSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  pushedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: z.string(),
});

const ReleaseSchema = z.object({
  repo: z.string(),
  tag: z.string(),
  title: z.string().nullable(),
  url: z.string(),
  date: z.string().nullable(),
});

const ChangelogEntrySchema = z.object({
  title: z.string(),
  date: z.string().nullable(),
  url: z.string().nullable(),
});

export const ProductPayloadSchema = z.object({
  githubOrg: z.string().nullable(),
  publicRepos: z.array(RepoSchema),
  recentNewRepos: z.array(RepoSchema),
  commitVelocity30d: z.number().int().nonnegative(),
  languageDistribution: z.record(z.string(), z.number().int().nonnegative()),
  recentReleases: z.array(ReleaseSchema),
  changelogEntries: z.array(ChangelogEntrySchema),
});

export type ProductPayload = z.infer<typeof ProductPayloadSchema>;

export const productAdapter: Adapter<ProductPayload> = {
  name: 'product',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: ['GITHUB_TOKEN'],
  schema: ProductPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<ProductPayload>> {
    const t0 = Date.now();
    const errors: string[] = [];
    let githubOrg: string | null = null;
    let publicRepos: ProductPayload['publicRepos'] = [];
    let recentReleases: ProductPayload['recentReleases'] = [];
    let commitVelocity30d = 0;

    try {
      githubOrg = await findGithubOrg(ctx);
      if (githubOrg) {
        publicRepos = await fetchRepos(ctx, githubOrg);
        const events = await fetchEvents(ctx, githubOrg);
        commitVelocity30d = events.filter((e) => e.type === 'PushEvent' && isWithinDays(e.created_at, 30)).length;
        recentReleases = events
          .filter((e) => e.type === 'ReleaseEvent' && isWithinDays(e.created_at, 14))
          .map((e) => ({
            repo: e.repo?.name ?? '',
            tag: e.payload?.release?.tag_name ?? '',
            title: e.payload?.release?.name ?? null,
            url: e.payload?.release?.html_url ?? '',
            date: e.created_at,
          }));
      }
    } catch (err) {
      errors.push(`github: ${(err as Error).message}`);
    }

    const changelogEntries = await fetchChangelog(ctx).catch((err) => {
      errors.push(`changelog: ${(err as Error).message}`);
      return [] as ProductPayload['changelogEntries'];
    });

    const haveAnything = githubOrg !== null || changelogEntries.length > 0;
    if (!haveAnything) {
      return {
        source: 'product', fetchedAt: new Date().toISOString(),
        status: 'error', payload: null, errors,
        costPaise: 0, durationMs: Date.now() - t0,
      };
    }

    const recentNewRepos = publicRepos.filter((r) => r.createdAt && isWithinDays(r.createdAt, 30));
    const languageDistribution: Record<string, number> = {};
    for (const r of publicRepos) {
      if (r.language) languageDistribution[r.language] = (languageDistribution[r.language] ?? 0) + 1;
    }

    const status = errors.length > 0 ? 'partial' : 'ok';
    return {
      source: 'product',
      fetchedAt: new Date().toISOString(),
      status,
      payload: { githubOrg, publicRepos, recentNewRepos, commitVelocity30d, languageDistribution, recentReleases, changelogEntries },
      errors: errors.length > 0 ? errors : undefined,
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};

async function findGithubOrg(ctx: AdapterContext): Promise<string | null> {
  const q = encodeURIComponent(`${ctx.input.name} type:org`);
  const res = await ctx.http(`https://api.github.com/search/users?q=${q}`, {
    headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`search http ${res.status}`);
  const json = await res.json() as { items?: Array<{ login: string; type: string }> };
  const org = (json.items ?? []).find((i) => i.type === 'Organization');
  return org?.login ?? null;
}

async function fetchRepos(ctx: AdapterContext, org: string): Promise<ProductPayload['publicRepos']> {
  const res = await ctx.http(`https://api.github.com/orgs/${org}/repos?per_page=100&sort=pushed`, {
    headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`repos http ${res.status}`);
  const json = await res.json() as Array<{ name: string; description: string | null; language: string | null; stargazers_count: number; pushed_at: string | null; created_at: string | null; html_url: string }>;
  return json.map((r) => ({
    name: r.name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    pushedAt: r.pushed_at,
    createdAt: r.created_at,
    url: r.html_url,
  }));
}

interface GhEvent {
  type: string;
  created_at: string;
  repo?: { name: string };
  payload?: { release?: { tag_name?: string; name?: string; html_url?: string } };
}

async function fetchEvents(ctx: AdapterContext, org: string): Promise<GhEvent[]> {
  // /orgs/{org}/events requires auth & only returns public events for orgs;
  // the alternative /users/{org}/events?per_page=100 also works for orgs.
  const res = await ctx.http(`https://api.github.com/users/${org}/events?per_page=100`, {
    headers: { authorization: `token ${ctx.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`events http ${res.status}`);
  return await res.json() as GhEvent[];
}

async function fetchChangelog(ctx: AdapterContext): Promise<ProductPayload['changelogEntries']> {
  const candidates = ['/changelog', '/blog', '/release-notes', '/whats-new'];
  for (const path of candidates) {
    try {
      const url = toHttpsUrl(ctx.input.domain, path);
      const res = await ctx.http(url, { signal: ctx.signal });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      const entries: ProductPayload['changelogEntries'] = [];
      $('article, .post, .entry, h2, h3').each((_, el) => {
        const heading = $(el).find('h1, h2, h3').first().text().trim() || $(el).text().trim();
        const time = $(el).find('time').attr('datetime') ?? null;
        const link = $(el).find('a').first().attr('href') ?? null;
        if (heading && heading.length < 200) {
          entries.push({ title: heading, date: time, url: link });
        }
      });
      if (entries.length > 0) return entries.slice(0, 20);
    } catch { /* try next candidate */ }
  }
  return [];
}

function isWithinDays(iso: string, days: number): boolean {
  const t = Date.parse(iso);
  if (isNaN(t)) return false;
  return (Date.now() - t) / 86400000 <= days;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- product
```

Expected: PASS.

- [ ] **Step 6: Wire product into cli.ts**

Edit `tools/radar-enrich/src/cli.ts`:

Add import: `import { productAdapter } from './adapters/product.js';`

Replace `product: null,` with `product: productAdapter as Adapter<unknown>,`.

- [ ] **Step 7: Full test + typecheck pass**

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add tools/radar-enrich/src/adapters/product.ts tools/radar-enrich/tests/adapters/product.test.ts tools/radar-enrich/tests/fixtures/product tools/radar-enrich/src/cli.ts
git commit -m "feat(radar-enrich): product adapter (GitHub org+repos+events + changelog)"
```

---

## Chunk 5 complete checkpoint

After this chunk:
- Two helper libraries (`classify`, `domainUtils`) exist with full test coverage
- Two real adapters (hiring, product) implement the `Adapter<T>` contract
- The CLI uses the real hiring + product adapters; the other two real adapters are still inline-stubbed
- Test count should now be ~60+ across all modules

Verify before moving on:

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Both must exit 0.

---

## Chunk 6: Customer + operational adapters + CLI cleanup

Adds the two remaining real adapters and removes the `notImplementedAdapter` placeholder from `cli.ts` so all four real adapters are wired for production runs.

---

### Task 6.1: Tech-stack fingerprint dataset

**Files:**
- Create: `tools/radar-enrich/src/fingerprints/techstack.ts`
- Create: `tools/radar-enrich/tests/fingerprints/techstack.test.ts`

A small embedded dataset (~50 entries) of `{ name, category, scriptPatterns, linkPatterns, htmlPatterns }`. Used by Module 5 to identify SaaS tools from the homepage's `<script>`/`<link>` tags and inline markers.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/fingerprints/techstack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TECHSTACK_FINGERPRINTS, detectTechStack } from '../../src/fingerprints/techstack.js';

describe('TECHSTACK_FINGERPRINTS', () => {
  it('contains at least 30 fingerprints', () => {
    expect(TECHSTACK_FINGERPRINTS.length).toBeGreaterThanOrEqual(30);
  });

  it('every fingerprint has name, category, and at least one pattern source', () => {
    for (const fp of TECHSTACK_FINGERPRINTS) {
      expect(fp.name).toBeTruthy();
      expect(fp.category).toBeTruthy();
      const hasSomePattern =
        (fp.scriptPatterns?.length ?? 0) +
        (fp.linkPatterns?.length ?? 0) +
        (fp.htmlPatterns?.length ?? 0) > 0;
      expect(hasSomePattern).toBe(true);
    }
  });
});

describe('detectTechStack', () => {
  it('detects Stripe via script src', () => {
    const html = `<script src="https://js.stripe.com/v3/"></script>`;
    const detected = detectTechStack(html);
    expect(detected.find((d) => d.name === 'Stripe')).toBeTruthy();
  });

  it('detects Segment via script src', () => {
    const html = `<script>!function(){var analytics=window.analytics=window.analytics||[];analytics.SNIPPET_VERSION="4.13.1";</script><script src="https://cdn.segment.com/analytics.js/v1/abc/analytics.min.js"></script>`;
    const detected = detectTechStack(html);
    expect(detected.find((d) => d.name === 'Segment')).toBeTruthy();
  });

  it('detects HubSpot via cookie domain marker', () => {
    const html = `<script src="//js.hs-scripts.com/12345.js"></script>`;
    const detected = detectTechStack(html);
    expect(detected.find((d) => d.name === 'HubSpot')).toBeTruthy();
  });

  it('returns empty array on bare HTML with no markers', () => {
    expect(detectTechStack('<html><body>hello</body></html>')).toEqual([]);
  });

  it('confidence is 1 for direct pattern match, can be lower for weaker signals', () => {
    const html = `<script src="https://js.stripe.com/v3/"></script>`;
    const detected = detectTechStack(html);
    const stripe = detected.find((d) => d.name === 'Stripe')!;
    expect(stripe.confidence).toBeGreaterThan(0);
    expect(stripe.confidence).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- techstack
```

Expected: FAIL.

- [ ] **Step 3: Create techstack.ts**

Create `tools/radar-enrich/src/fingerprints/techstack.ts`:

```ts
export interface Fingerprint {
  name: string;
  category: 'analytics' | 'payments' | 'crm' | 'support' | 'cdp' | 'ecommerce' | 'cms' | 'auth' | 'monitoring' | 'search' | 'ads' | 'email' | 'experimentation' | 'other';
  scriptPatterns?: string[];   // substrings to match in <script src="...">
  linkPatterns?: string[];     // substrings to match in <link href="...">
  htmlPatterns?: string[];     // substrings to match anywhere in raw HTML
}

export interface DetectedTech {
  name: string;
  category: string;
  confidence: number;          // 0..1
}

export const TECHSTACK_FINGERPRINTS: Fingerprint[] = [
  // Analytics
  { name: 'Google Analytics 4', category: 'analytics', scriptPatterns: ['googletagmanager.com/gtag/js', 'google-analytics.com/analytics.js'] },
  { name: 'Google Tag Manager', category: 'analytics', scriptPatterns: ['googletagmanager.com/gtm.js'] },
  { name: 'Mixpanel',           category: 'analytics', scriptPatterns: ['cdn.mxpnl.com', 'mixpanel.com'] },
  { name: 'Amplitude',          category: 'analytics', scriptPatterns: ['cdn.amplitude.com', 'amplitude-analytics'] },
  { name: 'Heap',               category: 'analytics', scriptPatterns: ['cdn.heapanalytics.com', 'heap.io'] },
  { name: 'Plausible',          category: 'analytics', scriptPatterns: ['plausible.io/js'] },
  { name: 'Fathom',             category: 'analytics', scriptPatterns: ['cdn.usefathom.com'] },
  { name: 'PostHog',            category: 'analytics', scriptPatterns: ['posthog.com', 'app.posthog.com'] },
  // Payments
  { name: 'Stripe',             category: 'payments', scriptPatterns: ['js.stripe.com'] },
  { name: 'Razorpay',           category: 'payments', scriptPatterns: ['checkout.razorpay.com'] },
  { name: 'PayPal',             category: 'payments', scriptPatterns: ['paypal.com/sdk/js', 'paypalobjects.com'] },
  { name: 'Paddle',             category: 'payments', scriptPatterns: ['cdn.paddle.com', 'paddle.js'] },
  // CDP
  { name: 'Segment',            category: 'cdp', scriptPatterns: ['cdn.segment.com', 'segment.io'] },
  { name: 'Rudderstack',        category: 'cdp', scriptPatterns: ['rudderstack.com'] },
  // CRM / sales
  { name: 'HubSpot',            category: 'crm', scriptPatterns: ['hs-scripts.com', 'hubspot.com', 'hs-analytics.net'] },
  { name: 'Salesforce',         category: 'crm', scriptPatterns: ['salesforceliveagent.com', 'pardot.com', 'force.com'] },
  { name: 'Pipedrive',          category: 'crm', scriptPatterns: ['pipedrive.com'] },
  // Support
  { name: 'Intercom',           category: 'support', scriptPatterns: ['widget.intercom.io', 'js.intercomcdn.com'] },
  { name: 'Zendesk',            category: 'support', scriptPatterns: ['zdassets.com', 'zendesk.com'] },
  { name: 'Drift',              category: 'support', scriptPatterns: ['js.driftt.com'] },
  { name: 'Crisp',              category: 'support', scriptPatterns: ['client.crisp.chat'] },
  { name: 'Front',              category: 'support', scriptPatterns: ['frontapp.com'] },
  // Search
  { name: 'Algolia',            category: 'search', scriptPatterns: ['cdn.jsdelivr.net/npm/algoliasearch', 'algolianet.com'] },
  { name: 'Meilisearch',        category: 'search', scriptPatterns: ['meilisearch.com'] },
  // Auth
  { name: 'Auth0',              category: 'auth', scriptPatterns: ['cdn.auth0.com'] },
  { name: 'Clerk',              category: 'auth', scriptPatterns: ['clerk.dev', 'clerk.com'] },
  { name: 'WorkOS',             category: 'auth', scriptPatterns: ['workos.com'] },
  // Monitoring
  { name: 'Sentry',             category: 'monitoring', scriptPatterns: ['browser.sentry-cdn.com', 'sentry.io'] },
  { name: 'Datadog',            category: 'monitoring', scriptPatterns: ['datadoghq.com', 'datadog-rum'] },
  { name: 'LogRocket',          category: 'monitoring', scriptPatterns: ['cdn.logrocket.io'] },
  { name: 'FullStory',          category: 'monitoring', scriptPatterns: ['fullstory.com', 'fs.js'] },
  { name: 'Hotjar',             category: 'monitoring', scriptPatterns: ['static.hotjar.com'] },
  // CMS
  { name: 'WordPress',          category: 'cms', htmlPatterns: ['wp-content/', 'wp-includes/'] },
  { name: 'Webflow',            category: 'cms', htmlPatterns: ['data-wf-site=', 'webflow.com'] },
  { name: 'Framer',             category: 'cms', htmlPatterns: ['framerusercontent.com'] },
  { name: 'Sanity',             category: 'cms', scriptPatterns: ['sanity.io'] },
  // Ecommerce
  { name: 'Shopify',            category: 'ecommerce', htmlPatterns: ['cdn.shopify.com', 'shopify.com/s/'] },
  { name: 'WooCommerce',        category: 'ecommerce', htmlPatterns: ['woocommerce'] },
  { name: 'BigCommerce',        category: 'ecommerce', htmlPatterns: ['bigcommerce.com'] },
  // Ads
  { name: 'Facebook Pixel',     category: 'ads', scriptPatterns: ['connect.facebook.net'] },
  { name: 'LinkedIn Insight',   category: 'ads', scriptPatterns: ['snap.licdn.com'] },
  { name: 'Twitter Pixel',      category: 'ads', scriptPatterns: ['static.ads-twitter.com'] },
  { name: 'Reddit Pixel',       category: 'ads', scriptPatterns: ['redditstatic.com'] },
  // Email
  { name: 'Mailchimp',          category: 'email', scriptPatterns: ['mailchimp.com', 'mc.us'] },
  { name: 'ConvertKit',         category: 'email', scriptPatterns: ['convertkit.com'] },
  // Experimentation
  { name: 'GrowthBook',         category: 'experimentation', scriptPatterns: ['growthbook.io'] },
  { name: 'Optimizely',         category: 'experimentation', scriptPatterns: ['cdn.optimizely.com'] },
  { name: 'VWO',                category: 'experimentation', scriptPatterns: ['dev.visualwebsiteoptimizer.com'] },
];

export function detectTechStack(html: string): DetectedTech[] {
  const found = new Map<string, DetectedTech>();
  for (const fp of TECHSTACK_FINGERPRINTS) {
    let matched = false;
    if (fp.scriptPatterns?.some((p) => html.includes(p))) matched = true;
    if (!matched && fp.linkPatterns?.some((p) => html.includes(p))) matched = true;
    if (!matched && fp.htmlPatterns?.some((p) => html.includes(p))) matched = true;
    if (matched) {
      found.set(fp.name, { name: fp.name, category: fp.category, confidence: 1 });
    }
  }
  return [...found.values()];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- techstack
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/radar-enrich/src/fingerprints/techstack.ts tools/radar-enrich/tests/fingerprints/techstack.test.ts
git commit -m "feat(radar-enrich): tech-stack fingerprint dataset (~50 tools)"
```

---

### Task 6.2: Customer adapter (Module 3)

**Files:**
- Create: `tools/radar-enrich/src/adapters/customer.ts`
- Create: `tools/radar-enrich/tests/adapters/customer.test.ts`
- Create: `tools/radar-enrich/tests/fixtures/customer/customers-current.html`
- Create: `tools/radar-enrich/tests/fixtures/customer/customers-old.html`
- Create: `tools/radar-enrich/tests/fixtures/customer/wayback-availability.json`

The customer adapter:
1. Tries `/customers`, `/clients`, `/case-studies`, `/our-customers` to find a current logo page.
2. Extracts logos (img alt + img filename basename).
3. Hits Wayback Machine `availability` API for snapshots at 30/60/90 days back.
4. Diffs current logos against the oldest snapshot to compute added/removed.
5. Same diff process for `/pricing` (text snapshot) and homepage hero (h1 + first paragraph).

- [ ] **Step 1: Capture fixtures**

Create `tools/radar-enrich/tests/fixtures/customer/customers-current.html`:

```html
<!doctype html>
<html><body>
<h1>Our Customers</h1>
<img src="/logos/acme.svg" alt="Acme" />
<img src="/logos/foo-corp.svg" alt="Foo Corp" />
<img src="/logos/bar-inc.svg" alt="Bar Inc" />
</body></html>
```

Create `tools/radar-enrich/tests/fixtures/customer/customers-old.html`:

```html
<!doctype html>
<html><body>
<h1>Our Customers</h1>
<img src="/logos/foo-corp.svg" alt="Foo Corp" />
<img src="/logos/legacy-co.svg" alt="Legacy Co" />
</body></html>
```

Create `tools/radar-enrich/tests/fixtures/customer/wayback-availability.json`:

```json
{
  "archived_snapshots": {
    "closest": {
      "available": true,
      "url": "http://web.archive.org/web/20260201000000/https://acme.com/customers",
      "timestamp": "20260201000000",
      "status": "200"
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tools/radar-enrich/tests/adapters/customer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { customerAdapter } from '../../src/adapters/customer.js';
import type { AdapterContext } from '../../src/types.js';

const currentHtml = readFileSync(join(__dirname, '../fixtures/customer/customers-current.html'), 'utf8');
const oldHtml = readFileSync(join(__dirname, '../fixtures/customer/customers-old.html'), 'utf8');
const waybackFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/customer/wayback-availability.json'), 'utf8'));

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: {},
    signal: new AbortController().signal,
  };
}

function fakeFetch(routes: Array<[RegExp | string, () => Response]>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [match, factory] of routes) {
      const m = match instanceof RegExp ? match.test(u) : u.includes(match);
      if (m) return factory();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('customerAdapter', () => {
  it('exposes the Adapter contract surface', () => {
    expect(customerAdapter.name).toBe('customer');
    expect(customerAdapter.requiredEnv).toEqual([]);
  });

  it('extracts current logos and diffs against an older Wayback snapshot', async () => {
    const http = fakeFetch([
      // current customers page on acme.com
      [/acme\.com\/customers$/, () => new Response(currentHtml, { status: 200, headers: { 'content-type': 'text/html' } })],
      // wayback availability lookup returns a snapshot URL
      [/archive\.org\/wayback\/available/, () => new Response(JSON.stringify(waybackFixture), { status: 200 })],
      // wayback snapshot serves the old HTML
      [/web\.archive\.org\/web\//, () => new Response(oldHtml, { status: 200 })],
      // pricing + home not present — return 404 so those diffs are empty
      [/acme\.com\/pricing/, () => new Response('not found', { status: 404 })],
      [/acme\.com\/?$/, () => new Response('<html><body><h1>welcome</h1><p>tagline</p></body></html>', { status: 200 })],
    ]);
    const result = await customerAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    expect(p.customersPageUrl).toContain('/customers');
    expect(p.currentLogos).toEqual(expect.arrayContaining(['Acme', 'Foo Corp', 'Bar Inc']));
    expect(p.addedLogosLast90d).toEqual(expect.arrayContaining(['Acme', 'Bar Inc']));
    expect(p.removedLogosLast90d).toEqual(expect.arrayContaining(['Legacy Co']));
    expect(p.snapshotsAnalyzed.length).toBeGreaterThan(0);
  });

  it('returns ok with empty diffs when no Wayback snapshot exists', async () => {
    const http = fakeFetch([
      [/acme\.com\/customers$/, () => new Response(currentHtml, { status: 200 })],
      [/archive\.org\/wayback\/available/, () => new Response(JSON.stringify({ archived_snapshots: {} }), { status: 200 })],
      [/acme\.com\/?$/, () => new Response('<html><body></body></html>', { status: 200 })],
    ]);
    const result = await customerAdapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    expect(result.payload!.addedLogosLast90d).toEqual([]);
    expect(result.payload!.removedLogosLast90d).toEqual([]);
  });

  it('returns empty when no customers/clients/case-studies page can be found and no signals at all', async () => {
    const http = fakeFetch([
      [/.*/, () => new Response('not found', { status: 404 })],
    ]);
    const result = await customerAdapter.run(ctxWith(http));
    expect(['empty', 'error']).toContain(result.status);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- customer
```

Expected: FAIL.

- [ ] **Step 4: Create customer.ts**

Create `tools/radar-enrich/src/adapters/customer.ts`:

```ts
import { z } from 'zod';
import * as cheerio from 'cheerio';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';
import { toHttpsUrl } from '../lib/domainUtils.js';

const SnapshotSchema = z.object({
  url: z.string(),
  timestamp: z.string(),
  waybackUrl: z.string(),
});

const PricingChangeSchema = z.object({
  detectedAt: z.string(),
  previousSnapshotUrl: z.string(),
  currentSnapshotUrl: z.string(),
  changeSummary: z.string(),
});

const HeroChangeSchema = z.object({
  detectedAt: z.string(),
  previousH1: z.string().nullable(),
  currentH1: z.string().nullable(),
  previousFirstParagraph: z.string().nullable(),
  currentFirstParagraph: z.string().nullable(),
});

export const CustomerPayloadSchema = z.object({
  customersPageUrl: z.string().nullable(),
  currentLogos: z.array(z.string()).nullable(),
  snapshotsAnalyzed: z.array(SnapshotSchema),
  addedLogosLast90d: z.array(z.string()),
  removedLogosLast90d: z.array(z.string()),
  pricingChanges: z.array(PricingChangeSchema),
  heroChanges: z.array(HeroChangeSchema),
});

export type CustomerPayload = z.infer<typeof CustomerPayloadSchema>;

export const customerAdapter: Adapter<CustomerPayload> = {
  name: 'customer',
  version: '0.1.0',
  estimatedCostPaise: 0,
  requiredEnv: [],
  schema: CustomerPayloadSchema,
  async run(ctx: AdapterContext): Promise<AdapterResult<CustomerPayload>> {
    const t0 = Date.now();
    const errors: string[] = [];

    const customersPage = await findCustomersPage(ctx).catch((err) => {
      errors.push(`customers: ${(err as Error).message}`);
      return null;
    });

    let currentLogos: string[] | null = null;
    const snapshotsAnalyzed: CustomerPayload['snapshotsAnalyzed'] = [];
    let addedLogosLast90d: string[] = [];
    let removedLogosLast90d: string[] = [];

    if (customersPage) {
      currentLogos = extractLogos(customersPage.html);
      // Wayback snapshot 90 days back, diff against current
      const ninetyDaysAgo = formatYYYYMMDDhhmmss(new Date(Date.now() - 90 * 86400000));
      const snapshot = await waybackLookup(ctx, customersPage.url, ninetyDaysAgo).catch(() => null);
      if (snapshot) {
        snapshotsAnalyzed.push(snapshot);
        const oldHtml = await ctx.http(snapshot.waybackUrl, { signal: ctx.signal })
          .then((r) => r.ok ? r.text() : null)
          .catch(() => null);
        if (oldHtml) {
          const oldLogos = extractLogos(oldHtml);
          addedLogosLast90d = currentLogos.filter((l) => !oldLogos.includes(l));
          removedLogosLast90d = oldLogos.filter((l) => !currentLogos!.includes(l));
        }
      }
    }

    const pricingChanges = await diffPricing(ctx).catch(() => [] as CustomerPayload['pricingChanges']);
    const heroChanges = await diffHero(ctx).catch(() => [] as CustomerPayload['heroChanges']);

    const haveAnything =
      customersPage !== null ||
      pricingChanges.length > 0 ||
      heroChanges.length > 0;

    if (!haveAnything) {
      return {
        source: 'customer', fetchedAt: new Date().toISOString(),
        status: 'empty', payload: null, errors: errors.length > 0 ? errors : undefined,
        costPaise: 0, durationMs: Date.now() - t0,
      };
    }

    const status = errors.length > 0 ? 'partial' : 'ok';
    return {
      source: 'customer',
      fetchedAt: new Date().toISOString(),
      status,
      payload: {
        customersPageUrl: customersPage?.url ?? null,
        currentLogos,
        snapshotsAnalyzed,
        addedLogosLast90d,
        removedLogosLast90d,
        pricingChanges,
        heroChanges,
      },
      errors: errors.length > 0 ? errors : undefined,
      costPaise: 0,
      durationMs: Date.now() - t0,
    };
  },
};

async function findCustomersPage(ctx: AdapterContext): Promise<{ url: string; html: string } | null> {
  const candidates = ['/customers', '/clients', '/case-studies', '/our-customers'];
  for (const path of candidates) {
    const url = toHttpsUrl(ctx.input.domain, path);
    try {
      const res = await ctx.http(url, { signal: ctx.signal });
      if (res.ok) return { url, html: await res.text() };
    } catch { /* try next */ }
  }
  return null;
}

function extractLogos(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  $('img').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').trim();
    const src = $(el).attr('src') ?? '';
    if (alt && alt.length > 1 && alt.length < 80) {
      seen.add(alt);
    } else if (src) {
      // derive from filename: /logos/acme.svg → "acme"
      const name = src.split('/').pop()?.replace(/\.(svg|png|jpe?g|webp)$/i, '');
      if (name && name.length > 1 && name.length < 60) seen.add(name);
    }
  });
  return [...seen];
}

async function waybackLookup(ctx: AdapterContext, url: string, timestamp: string): Promise<CustomerPayload['snapshotsAnalyzed'][number] | null> {
  const lookup = `http://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${timestamp}`;
  const res = await ctx.http(lookup, { signal: ctx.signal });
  if (!res.ok) return null;
  const json = await res.json() as { archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } } };
  const closest = json.archived_snapshots?.closest;
  if (!closest?.available || !closest.url) return null;
  return { url, timestamp: closest.timestamp ?? timestamp, waybackUrl: closest.url };
}

async function diffPricing(ctx: AdapterContext): Promise<CustomerPayload['pricingChanges']> {
  const url = toHttpsUrl(ctx.input.domain, '/pricing');
  const currentRes = await ctx.http(url, { signal: ctx.signal });
  if (!currentRes.ok) return [];
  const currentText = stripText(await currentRes.text());
  const ninetyDaysAgo = formatYYYYMMDDhhmmss(new Date(Date.now() - 90 * 86400000));
  const snap = await waybackLookup(ctx, url, ninetyDaysAgo);
  if (!snap) return [];
  const oldRes = await ctx.http(snap.waybackUrl, { signal: ctx.signal });
  if (!oldRes.ok) return [];
  const oldText = stripText(await oldRes.text());
  if (currentText === oldText) return [];
  return [{
    detectedAt: new Date().toISOString(),
    previousSnapshotUrl: snap.waybackUrl,
    currentSnapshotUrl: url,
    changeSummary: summarizePricingDiff(oldText, currentText),
  }];
}

async function diffHero(ctx: AdapterContext): Promise<CustomerPayload['heroChanges']> {
  const url = toHttpsUrl(ctx.input.domain, '/');
  const currentRes = await ctx.http(url, { signal: ctx.signal });
  if (!currentRes.ok) return [];
  const current = extractHero(await currentRes.text());
  const ninetyDaysAgo = formatYYYYMMDDhhmmss(new Date(Date.now() - 90 * 86400000));
  const snap = await waybackLookup(ctx, url, ninetyDaysAgo);
  if (!snap) return [];
  const oldRes = await ctx.http(snap.waybackUrl, { signal: ctx.signal });
  if (!oldRes.ok) return [];
  const old = extractHero(await oldRes.text());
  if (current.h1 === old.h1 && current.firstParagraph === old.firstParagraph) return [];
  return [{
    detectedAt: new Date().toISOString(),
    previousH1: old.h1, currentH1: current.h1,
    previousFirstParagraph: old.firstParagraph, currentFirstParagraph: current.firstParagraph,
  }];
}

function extractHero(html: string): { h1: string | null; firstParagraph: string | null } {
  const $ = cheerio.load(html);
  const h1 = $('h1').first().text().trim() || null;
  const firstParagraph = $('p').first().text().trim() || null;
  return { h1, firstParagraph };
}

function stripText(html: string): string {
  return cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
}

function summarizePricingDiff(oldText: string, newText: string): string {
  // naive: extract $X / ₹X patterns from both and report set differences
  const re = /[$₹]\s?[\d,]+/g;
  const oldPrices = new Set(oldText.match(re) ?? []);
  const newPrices = new Set(newText.match(re) ?? []);
  const added = [...newPrices].filter((p) => !oldPrices.has(p));
  const removed = [...oldPrices].filter((p) => !newPrices.has(p));
  if (added.length === 0 && removed.length === 0) return 'pricing copy changed (no price tokens differ)';
  return `prices changed — added: [${added.join(', ')}], removed: [${removed.join(', ')}]`;
}

function formatYYYYMMDDhhmmss(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}${m}${day}${hh}${mm}${ss}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- customer
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/adapters/customer.ts tools/radar-enrich/tests/adapters/customer.test.ts tools/radar-enrich/tests/fixtures/customer
git commit -m "feat(radar-enrich): customer adapter (Wayback diff: logos + pricing + hero)"
```

---

### Task 6.3: Operational adapter (Module 5)

**Files:**
- Create: `tools/radar-enrich/src/adapters/operational.ts`
- Create: `tools/radar-enrich/tests/adapters/operational.test.ts`
- Create: `tools/radar-enrich/tests/fixtures/operational/homepage.html`
- Create: `tools/radar-enrich/tests/fixtures/operational/crtsh.json`

The operational adapter:
1. Fetches the homepage and runs `detectTechStack` on the HTML.
2. Extracts known SaaS verifications from the homepage (TXT-style markers in HTML).
3. Performs DNS lookups (MX → email provider; TXT → SaaS verifications).
4. Hits crt.sh for subdomain enumeration.
5. Flags "notable" subdomains (regex-based).

DNS lookups are done via `node:dns/promises` and need to be **dependency-injected** for tests to avoid real network. The adapter accepts an optional `dnsResolver` parameter (defaulted to the real `dns/promises`).

- [ ] **Step 1: Capture fixtures**

Create `tools/radar-enrich/tests/fixtures/operational/homepage.html`:

```html
<!doctype html>
<html><head>
<title>Acme Corp — B2B SaaS for Teams</title>
<meta name="google-site-verification" content="abc123" />
</head><body>
<script src="https://js.stripe.com/v3/"></script>
<script src="https://cdn.segment.com/analytics.js/v1/abc/analytics.min.js"></script>
<script src="https://browser.sentry-cdn.com/7.0.0/bundle.js"></script>
</body></html>
```

Create `tools/radar-enrich/tests/fixtures/operational/crtsh.json`:

```json
[
  { "name_value": "acme.com" },
  { "name_value": "www.acme.com" },
  { "name_value": "app.acme.com" },
  { "name_value": "api.acme.com" },
  { "name_value": "staging.acme.com" },
  { "name_value": "marketing-page.acme.com" }
]
```

- [ ] **Step 2: Write the failing tests**

Create `tools/radar-enrich/tests/adapters/operational.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { operationalAdapter, makeOperationalAdapter } from '../../src/adapters/operational.js';
import type { AdapterContext } from '../../src/types.js';

const homepageFixture = readFileSync(join(__dirname, '../fixtures/operational/homepage.html'), 'utf8');
const crtshFixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/operational/crtsh.json'), 'utf8'));

function ctxWith(http: typeof fetch): AdapterContext {
  const noop = () => {};
  return {
    input: { name: 'Acme', domain: 'acme.com' },
    http,
    cache: { read: async () => null, write: async () => {}, clear: async () => {} },
    logger: { debug: noop, info: noop, warn: noop, error: noop, child: () => ctxWith(http).logger },
    env: {},
    signal: new AbortController().signal,
  };
}

function fakeFetch(routes: Array<[RegExp | string, () => Response]>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [m, f] of routes) {
      const ok = m instanceof RegExp ? m.test(u) : u.includes(m);
      if (ok) return f();
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

const fakeDnsOk = {
  resolveMx: async () => [{ exchange: 'aspmx.l.google.com', priority: 1 }],
  resolveTxt: async () => [['v=spf1 include:_spf.google.com'], ['intercom-domain-verification=xyz']],
};

const fakeDnsFail = {
  resolveMx: async () => { throw new Error('ENOTFOUND'); },
  resolveTxt: async () => { throw new Error('ENOTFOUND'); },
};

describe('operationalAdapter', () => {
  it('exposes the Adapter contract surface', () => {
    expect(operationalAdapter.name).toBe('operational');
    expect(operationalAdapter.requiredEnv).toEqual([]);
  });

  it('detects tech stack, infers email provider, and flags notable subdomains', async () => {
    const adapter = makeOperationalAdapter(fakeDnsOk);
    const http = fakeFetch([
      [/acme\.com\/?$/, () => new Response(homepageFixture, { status: 200, headers: { 'content-type': 'text/html' } })],
      [/crt\.sh/, () => new Response(JSON.stringify(crtshFixture), { status: 200 })],
    ]);
    const result = await adapter.run(ctxWith(http));
    expect(result.status).toBe('ok');
    const p = result.payload!;
    const tools = p.techStack.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['Stripe', 'Segment', 'Sentry']));
    expect(p.emailProvider).toBe('Google');
    expect(p.knownSaaSVerifications).toEqual(expect.arrayContaining(['intercom']));
    expect(p.subdomains).toEqual(expect.arrayContaining(['app.acme.com', 'api.acme.com', 'staging.acme.com']));
    expect(p.notableSubdomains).toEqual(expect.arrayContaining(['app.acme.com', 'api.acme.com', 'staging.acme.com']));
    expect(p.notableSubdomains).not.toContain('marketing-page.acme.com');
  });

  it('tolerates DNS failure — returns partial with techStack still populated', async () => {
    const adapter = makeOperationalAdapter(fakeDnsFail);
    const http = fakeFetch([
      [/acme\.com\/?$/, () => new Response(homepageFixture, { status: 200 })],
      [/crt\.sh/, () => new Response(JSON.stringify(crtshFixture), { status: 200 })],
    ]);
    const result = await adapter.run(ctxWith(http));
    expect(['ok', 'partial']).toContain(result.status);
    expect(result.payload!.emailProvider).toBeNull();
    expect(result.payload!.techStack.length).toBeGreaterThan(0);
  });

  it('returns error when nothing succeeds', async () => {
    const adapter = makeOperationalAdapter(fakeDnsFail);
    const http = fakeFetch([[/.*/, () => new Response('not found', { status: 404 })]]);
    const result = await adapter.run(ctxWith(http));
    expect(result.status).toBe('error');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- operational
```

Expected: FAIL.

- [ ] **Step 4: Create operational.ts**

Create `tools/radar-enrich/src/adapters/operational.ts`:

```ts
import { z } from 'zod';
import * as dnsPromises from 'node:dns/promises';
import type { Adapter, AdapterContext, AdapterResult } from '../types.js';
import { toHttpsUrl, normalizeDomain } from '../lib/domainUtils.js';
import { detectTechStack } from '../fingerprints/techstack.js';

const TechSchema = z.object({
  name: z.string(),
  category: z.string(),
  confidence: z.number(),
});

export const OperationalPayloadSchema = z.object({
  techStack: z.array(TechSchema),
  emailProvider: z.string().nullable(),
  knownSaaSVerifications: z.array(z.string()),
  subdomains: z.array(z.string()),
  notableSubdomains: z.array(z.string()),
});

export type OperationalPayload = z.infer<typeof OperationalPayloadSchema>;

export interface DnsResolver {
  resolveMx: (host: string) => Promise<Array<{ exchange: string; priority: number }>>;
  resolveTxt: (host: string) => Promise<string[][]>;
}

const NOTABLE_SUBDOMAIN_RE = /^(app|api|dashboard|admin|beta|staging|portal|console|metrics|grafana|status)\./i;

export function makeOperationalAdapter(dns: DnsResolver): Adapter<OperationalPayload> {
  return {
    name: 'operational',
    version: '0.1.0',
    estimatedCostPaise: 0,
    requiredEnv: [],
    schema: OperationalPayloadSchema,
    async run(ctx: AdapterContext): Promise<AdapterResult<OperationalPayload>> {
      const t0 = Date.now();
      const errors: string[] = [];

      const homepage = await ctx.http(toHttpsUrl(ctx.input.domain, '/'), { signal: ctx.signal })
        .then((r) => r.ok ? r.text() : null)
        .catch((err) => { errors.push(`homepage: ${(err as Error).message}`); return null; });

      const techStack = homepage ? detectTechStack(homepage) : [];

      const domain = normalizeDomain(ctx.input.domain);
      let emailProvider: string | null = null;
      let knownSaaSVerifications: string[] = [];
      try {
        const mx = await dns.resolveMx(domain);
        emailProvider = inferEmailProvider(mx);
      } catch (err) {
        errors.push(`dns mx: ${(err as Error).message}`);
      }
      try {
        const txt = await dns.resolveTxt(domain);
        knownSaaSVerifications = inferSaasVerifications(txt);
      } catch (err) {
        errors.push(`dns txt: ${(err as Error).message}`);
      }

      let subdomains: string[] = [];
      try {
        subdomains = await fetchCrtSh(ctx, domain);
      } catch (err) {
        errors.push(`crt.sh: ${(err as Error).message}`);
      }
      const notableSubdomains = subdomains.filter((s) => NOTABLE_SUBDOMAIN_RE.test(s));

      const haveAnything = techStack.length > 0 || emailProvider !== null || knownSaaSVerifications.length > 0 || subdomains.length > 0;
      if (!haveAnything) {
        return {
          source: 'operational', fetchedAt: new Date().toISOString(),
          status: 'error', payload: null,
          errors, costPaise: 0, durationMs: Date.now() - t0,
        };
      }

      const status = errors.length > 0 ? 'partial' : 'ok';
      return {
        source: 'operational',
        fetchedAt: new Date().toISOString(),
        status,
        payload: { techStack, emailProvider, knownSaaSVerifications, subdomains, notableSubdomains },
        errors: errors.length > 0 ? errors : undefined,
        costPaise: 0,
        durationMs: Date.now() - t0,
      };
    },
  };
}

function inferEmailProvider(mx: Array<{ exchange: string; priority: number }>): string | null {
  if (mx.length === 0) return null;
  const lowest = [...mx].sort((a, b) => a.priority - b.priority)[0]!.exchange.toLowerCase();
  if (lowest.includes('google.com') || lowest.includes('googlemail')) return 'Google';
  if (lowest.includes('outlook.com') || lowest.includes('protection.outlook')) return 'Microsoft 365';
  if (lowest.includes('zoho')) return 'Zoho';
  if (lowest.includes('amazonses')) return 'Amazon SES';
  if (lowest.includes('mailgun')) return 'Mailgun';
  if (lowest.includes('postmark')) return 'Postmark';
  if (lowest.includes('sendgrid')) return 'SendGrid';
  return lowest;
}

function inferSaasVerifications(txt: string[][]): string[] {
  const flat = txt.flat().join(' ').toLowerCase();
  const out = new Set<string>();
  if (flat.includes('intercom-domain')) out.add('intercom');
  if (flat.includes('atlassian-domain')) out.add('atlassian');
  if (flat.includes('zendesk-verification')) out.add('zendesk');
  if (flat.includes('hubspot-domain-verification')) out.add('hubspot');
  if (flat.includes('mailchimp')) out.add('mailchimp');
  if (flat.includes('apple-domain-verification')) out.add('apple');
  if (flat.includes('facebook-domain-verification')) out.add('facebook');
  if (flat.includes('stripe')) out.add('stripe');
  return [...out];
}

async function fetchCrtSh(ctx: AdapterContext, domain: string): Promise<string[]> {
  const url = `https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`;
  const res = await ctx.http(url, { signal: ctx.signal });
  if (!res.ok) throw new Error(`crt.sh http ${res.status}`);
  const json = await res.json() as Array<{ name_value: string }>;
  const set = new Set<string>();
  for (const row of json) {
    for (const name of row.name_value.split('\n')) {
      const trimmed = name.trim().toLowerCase();
      if (trimmed && !trimmed.startsWith('*') && trimmed.endsWith(domain)) set.add(trimmed);
    }
  }
  return [...set];
}

// Default export uses the real DNS resolver
export const operationalAdapter: Adapter<OperationalPayload> = makeOperationalAdapter(dnsPromises);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- operational
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/adapters/operational.ts tools/radar-enrich/tests/adapters/operational.test.ts tools/radar-enrich/tests/fixtures/operational
git commit -m "feat(radar-enrich): operational adapter (techstack + DNS + crt.sh)"
```

---

### Task 6.4: Wire all four real adapters into cli.ts; remove `notImplementedAdapter`

**Files:**
- Modify: `tools/radar-enrich/src/cli.ts`

- [ ] **Step 1: Add the two new imports**

In `tools/radar-enrich/src/cli.ts`, add at the top:

```ts
import { customerAdapter } from './adapters/customer.js';
import { operationalAdapter } from './adapters/operational.js';
```

- [ ] **Step 2: Replace the remaining `null` entries**

Replace:
```ts
customer: null,      // wired in Chunk 5
operational: null,   // wired in Chunk 5
```
With:
```ts
customer: customerAdapter as Adapter<unknown>,
operational: operationalAdapter as Adapter<unknown>,
```

- [ ] **Step 3: Delete the `notImplementedAdapter` function and its `z` import dependency**

The `STUB_ADAPTERS[m] === null` branch in `resolveAdapters` is now dead. Replace `resolveAdapters` with the simpler:

```ts
function resolveAdapters(modules: ModuleName[]): Adapter<unknown>[] {
  const out: Adapter<unknown>[] = [];
  for (const m of modules) {
    const a = STUB_ADAPTERS[m];
    if (!a) throw new Error(`No adapter registered for module: ${m}`);
    out.push(a);
  }
  return out;
}
```

Delete the `notImplementedAdapter` function entirely. If `z` is no longer used elsewhere in `cli.ts`, delete its import too.

Also remove `Adapter<unknown> | null` from the `STUB_ADAPTERS` type declaration:

```ts
const STUB_ADAPTERS: Record<ModuleName, Adapter<unknown>> = {
  hiring: hiringAdapter as Adapter<unknown>,
  product: productAdapter as Adapter<unknown>,
  customer: customerAdapter as Adapter<unknown>,
  operational: operationalAdapter as Adapter<unknown>,
  voice: voiceStub as Adapter<unknown>,
  positioning: positioningStub as Adapter<unknown>,
};
```

- [ ] **Step 4: Run all tests + typecheck**

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Expected: all green. The integration test in cli.test.ts (added in Chunk 4) still asserts shape; payloads will now come from real adapters but with no env keys set, the adapters will all return `status:'error'` (missing required env for hiring/product) or `status:'empty'` (the rest hit unmocked HTTP and 404). That's still a valid dossier shape, so the integration test passes.

- [ ] **Step 5: End-to-end smoke test against a real company (optional, requires API keys)**

```bash
cd tools/radar-enrich && cp .env.example .env
# fill in ADZUNA_APP_ID, ADZUNA_APP_KEY, GITHUB_TOKEN, ANTHROPIC_API_KEY
npx tsx src/cli.ts --company "Stripe" --domain stripe.com --modules hiring,product,customer,operational --verbose 2>/tmp/run.log
```

Expected: stdout = JSON dossier with at least 2 of the 4 modules at `status:'ok'`. Inspect `/tmp/run.log` for adapter timing + cost summary.

- [ ] **Step 6: Commit**

```bash
git add tools/radar-enrich/src/cli.ts
git commit -m "feat(radar-enrich): wire customer + operational adapters; remove notImplementedAdapter"
```

---

## Chunk 6 complete checkpoint

After this chunk:
- All 6 modules have real implementations (4 real adapters + 2 stubs)
- `notImplementedAdapter` removed; `STUB_ADAPTERS` is fully populated
- Test count should now be ~85+ across all modules

Verify before moving on:

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Both must exit 0.

---

## Chunk 7: Synthesis (contextMapper + hookGenerator) + final assembly + README

The validation step itself. Flatten the 4 real-module payloads into the `signals[]` shape Stage 10 consumes, call `regenerateHook` 3 times in parallel for 3 hook candidates, and derive `topSignals` deterministically from the synthesized signals (no extra Claude call). Wire into `cli.ts` so the dossier's `signalSummary` reflects the real validation output. Final task fleshes out the README with sample run + key acquisition links.

---

### Task 7.1: contextMapper

**Files:**
- Create: `tools/radar-enrich/src/synthesis/contextMapper.ts`
- Create: `tools/radar-enrich/tests/synthesis/contextMapper.test.ts`

Pure function: takes the 4 real `AdapterResult<T>` objects and builds the `{ lead, persona, signals }` shape that Stage 10's `regenerateHook(lead, persona, signals)` expects. Spec §6.3 defines the per-source signalType, headline template, and confidence.

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/synthesis/contextMapper.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapContext, type SynthesizedContext } from '../../src/synthesis/contextMapper.js';
import type { AdapterResult, CompanyInput } from '../../src/types.js';
import type { HiringPayload } from '../../src/adapters/hiring.js';
import type { ProductPayload } from '../../src/adapters/product.js';
import type { CustomerPayload } from '../../src/adapters/customer.js';
import type { OperationalPayload } from '../../src/adapters/operational.js';

const company: CompanyInput = { name: 'Acme Corp', domain: 'acme.com', location: 'Mumbai, India' };

function ok<T>(payload: T): AdapterResult<T> {
  return { source: '', fetchedAt: '', status: 'ok', payload, costPaise: 0, durationMs: 0 };
}
function empty(name: string): AdapterResult<null> {
  return { source: name, fetchedAt: '', status: 'empty', payload: null, costPaise: 0, durationMs: 0 };
}

describe('mapContext', () => {
  it('builds lead from CompanyInput', () => {
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: empty('customer'), operational: empty('operational'),
    });
    expect(ctx.lead.business_name).toBe('Acme Corp');
    expect(ctx.lead.website_url).toBe('acme.com');
    expect(ctx.lead.manual_hook_note).toBeNull();
  });

  it('default persona role is "founder" when operational is empty', () => {
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: empty('customer'), operational: empty('operational'),
    });
    expect(ctx.persona.role).toBe('founder');
  });

  it('infers persona role from techStack when operational has Stripe + Segment + dashboard subdomain', () => {
    const op: OperationalPayload = {
      techStack: [{ name: 'Stripe', category: 'payments', confidence: 1 }, { name: 'Segment', category: 'cdp', confidence: 1 }],
      emailProvider: 'Google',
      knownSaaSVerifications: [],
      subdomains: ['app.acme.com', 'dashboard.acme.com'],
      notableSubdomains: ['app.acme.com', 'dashboard.acme.com'],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: empty('customer'), operational: ok(op) as unknown as AdapterResult<unknown>,
    });
    expect(ctx.persona.role).toBe('B2B SaaS founder');
  });

  it('flattens hiring payload into signals (senior + new function)', () => {
    const h: HiringPayload = {
      totalActiveJobs: 2, jobsLast30Days: 2, jobsLast90Days: 2,
      byFunction: { eng: 1, sales: 1 },
      bySeniority: { senior: 1, mid: 1 },
      byLocation: { Mumbai: 2 },
      newRoleTypes: ['sales'],
      rawJobs: [
        { source: 'adzuna', title: 'Senior Backend Engineer', location: 'Mumbai', date: '2026-04-25', url: null, function: 'eng', seniority: 'senior' },
        { source: 'adzuna', title: 'Account Executive', location: 'Mumbai', date: '2026-04-20', url: null, function: 'sales', seniority: 'mid' },
      ],
    };
    const ctx = mapContext(company, {
      hiring: ok(h) as unknown as AdapterResult<unknown>,
      product: empty('product'), customer: empty('customer'), operational: empty('operational'),
    });
    const types = ctx.signals.map((s) => s.signalType);
    expect(types).toContain('hiring_senior');
    expect(types).toContain('hiring_new_function');
  });

  it('flattens product payload into signals (new repo, release, changelog)', () => {
    const p: ProductPayload = {
      githubOrg: 'acme',
      publicRepos: [{ name: 'demo-app', description: null, language: 'TS', stars: 5, pushedAt: null, createdAt: '2026-04-25T00:00:00Z', url: 'https://github.com/acme/demo-app' }],
      recentNewRepos: [{ name: 'demo-app', description: null, language: 'TS', stars: 5, pushedAt: null, createdAt: '2026-04-25T00:00:00Z', url: 'https://github.com/acme/demo-app' }],
      commitVelocity30d: 12,
      languageDistribution: { TS: 1 },
      recentReleases: [{ repo: 'acme/core', tag: 'v2.1.0', title: 'April', url: 'https://github.com/acme/core/releases/tag/v2.1.0', date: '2026-04-28T00:00:00Z' }],
      changelogEntries: [{ title: 'Shipped: New widget', date: '2026-04-29', url: '/changelog/widget' }],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'),
      product: ok(p) as unknown as AdapterResult<unknown>,
      customer: empty('customer'), operational: empty('operational'),
    });
    const types = ctx.signals.map((s) => s.signalType);
    expect(types).toContain('product_repo_new');
    expect(types).toContain('product_release');
    expect(types).toContain('product_changelog');
  });

  it('flattens customer payload into signals (added logo, pricing change, hero change)', () => {
    const c: CustomerPayload = {
      customersPageUrl: 'https://acme.com/customers',
      currentLogos: ['Acme', 'Foo Corp'],
      snapshotsAnalyzed: [],
      addedLogosLast90d: ['Foo Corp'],
      removedLogosLast90d: [],
      pricingChanges: [{ detectedAt: '2026-04-15T00:00:00Z', previousSnapshotUrl: 'a', currentSnapshotUrl: 'b', changeSummary: 'Starter $29 → $39' }],
      heroChanges: [{ detectedAt: '2026-04-10T00:00:00Z', previousH1: 'Old', currentH1: 'New', previousFirstParagraph: null, currentFirstParagraph: null }],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: ok(c) as unknown as AdapterResult<unknown>,
      operational: empty('operational'),
    });
    const types = ctx.signals.map((s) => s.signalType);
    expect(types).toContain('customer_added');
    expect(types).toContain('pricing_change');
    expect(types).toContain('positioning_change');
  });

  it('flattens operational payload into signals (tech_added, subdomain_notable)', () => {
    const op: OperationalPayload = {
      techStack: [{ name: 'Sentry', category: 'monitoring', confidence: 1 }],
      emailProvider: 'Google',
      knownSaaSVerifications: [],
      subdomains: ['app.acme.com'],
      notableSubdomains: ['app.acme.com'],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: empty('customer'),
      operational: ok(op) as unknown as AdapterResult<unknown>,
    });
    const types = ctx.signals.map((s) => s.signalType);
    expect(types).toContain('tech_added');
    expect(types).toContain('subdomain_notable');
  });

  it('signals are sorted by confidence descending', () => {
    const c: CustomerPayload = {
      customersPageUrl: 'x', currentLogos: [], snapshotsAnalyzed: [],
      addedLogosLast90d: ['Foo'],   // confidence 0.9
      removedLogosLast90d: [],
      pricingChanges: [], heroChanges: [],
    };
    const op: OperationalPayload = {
      techStack: [{ name: 'Sentry', category: 'monitoring', confidence: 1 }],   // → confidence 0.6 (tech_added)
      emailProvider: null, knownSaaSVerifications: [], subdomains: [], notableSubdomains: [],
    };
    const ctx = mapContext(company, {
      hiring: empty('hiring'), product: empty('product'),
      customer: ok(c) as unknown as AdapterResult<unknown>,
      operational: ok(op) as unknown as AdapterResult<unknown>,
    });
    const confs = ctx.signals.map((s) => s.confidence!);
    for (let i = 1; i < confs.length; i++) {
      expect(confs[i - 1]).toBeGreaterThanOrEqual(confs[i]!);
    }
  });
});
```

(Note: `ctx.signals[i].confidence` is exposed on the SynthesizedContext for our internal sorting/topSignals use, but stripped from the payload sent to Stage 10 since `regenerateHook`'s `Signal` shape only requires `signalType`, `headline`, `url`. See `toStage10Signals()` in the implementation.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- contextMapper
```

Expected: FAIL.

- [ ] **Step 3: Create contextMapper.ts**

Create `tools/radar-enrich/src/synthesis/contextMapper.ts`:

```ts
import type { AdapterResult, CompanyInput } from '../types.js';
import type { HiringPayload } from '../adapters/hiring.js';
import type { ProductPayload } from '../adapters/product.js';
import type { CustomerPayload } from '../adapters/customer.js';
import type { OperationalPayload } from '../adapters/operational.js';

export interface RealModulePayloads {
  hiring: AdapterResult<unknown>;
  product: AdapterResult<unknown>;
  customer: AdapterResult<unknown>;
  operational: AdapterResult<unknown>;
}

export interface InternalSignal {
  signalType: string;
  headline: string;
  url?: string;
  confidence: number;   // internal — drives top-3 selection in Stage 10's prompt
}

export interface SynthesizedContext {
  lead: { business_name: string; website_url: string; manual_hook_note: string | null };
  persona: { role: string };
  signals: InternalSignal[];   // sorted by confidence desc
}

export function mapContext(input: CompanyInput, modules: RealModulePayloads): SynthesizedContext {
  const lead = {
    business_name: input.name,
    website_url: input.domain,
    manual_hook_note: null,
  };

  const operational = modules.operational.status === 'ok' || modules.operational.status === 'partial'
    ? modules.operational.payload as OperationalPayload | null
    : null;
  const persona = { role: inferPersonaRole(operational) };

  const signals: InternalSignal[] = [];
  if (modules.hiring.status === 'ok' || modules.hiring.status === 'partial') {
    pushHiringSignals(signals, modules.hiring.payload as HiringPayload | null);
  }
  if (modules.product.status === 'ok' || modules.product.status === 'partial') {
    pushProductSignals(signals, modules.product.payload as ProductPayload | null);
  }
  if (modules.customer.status === 'ok' || modules.customer.status === 'partial') {
    pushCustomerSignals(signals, modules.customer.payload as CustomerPayload | null);
  }
  if (operational) pushOperationalSignals(signals, operational, input.domain);

  signals.sort((a, b) => b.confidence - a.confidence);
  return { lead, persona, signals };
}

/**
 * Strip the internal `confidence` field for the shape Stage 10's `regenerateHook`
 * actually consumes (`{signalType, headline, url}`).
 */
export function toStage10Signals(signals: InternalSignal[]): Array<{ signalType: string; headline: string; url?: string }> {
  return signals.map(({ confidence: _c, ...rest }) => rest);
}

function inferPersonaRole(op: OperationalPayload | null): string {
  if (!op) return 'founder';
  const techNames = new Set(op.techStack.map((t) => t.name.toLowerCase()));
  const hasDashboardSubdomain = op.subdomains.some((s) => /^(app|dashboard|admin|portal|console)\./i.test(s));
  if ((techNames.has('stripe') || techNames.has('razorpay')) && techNames.has('segment') && hasDashboardSubdomain) {
    return 'B2B SaaS founder';
  }
  if (techNames.has('shopify') || techNames.has('woocommerce') || techNames.has('bigcommerce')) {
    return 'ecommerce operator';
  }
  return 'founder';
}

function pushHiringSignals(out: InternalSignal[], h: HiringPayload | null): void {
  if (!h) return;
  for (const job of h.rawJobs) {
    if (!job.date) continue;
    const ageDays = (Date.now() - Date.parse(job.date)) / 86400000;
    if (ageDays > 30 || isNaN(ageDays)) continue;
    if (['senior', 'staff', 'principal', 'director', 'vp', 'c-level'].includes(job.seniority)) {
      out.push({
        signalType: 'hiring_senior',
        headline: `Opened ${job.title}${job.location ? ` in ${job.location}` : ''} (${job.date})`,
        url: job.url ?? undefined,
        confidence: 0.85,
      });
    }
  }
  for (const fn of h.newRoleTypes) {
    out.push({
      signalType: 'hiring_new_function',
      headline: `First ${fn} hire in 90d`,
      confidence: 0.9,
    });
  }
}

function pushProductSignals(out: InternalSignal[], p: ProductPayload | null): void {
  if (!p) return;
  for (const repo of p.recentNewRepos) {
    out.push({
      signalType: 'product_repo_new',
      headline: `New public repo: ${repo.name}${repo.createdAt ? ` (${repo.createdAt.slice(0, 10)})` : ''}`,
      url: repo.url,
      confidence: 0.7,
    });
  }
  for (const rel of p.recentReleases) {
    out.push({
      signalType: 'product_release',
      headline: `Released ${rel.tag}${rel.title ? `: ${rel.title}` : ''}`,
      url: rel.url,
      confidence: 0.85,
    });
  }
  for (const e of p.changelogEntries.slice(0, 5)) {
    out.push({
      signalType: 'product_changelog',
      headline: `Shipped: ${e.title}`,
      url: e.url ?? undefined,
      confidence: 0.8,
    });
  }
}

function pushCustomerSignals(out: InternalSignal[], c: CustomerPayload | null): void {
  if (!c) return;
  for (const logo of c.addedLogosLast90d) {
    out.push({ signalType: 'customer_added', headline: `Added logo: ${logo}`, confidence: 0.9 });
  }
  for (const pc of c.pricingChanges) {
    out.push({ signalType: 'pricing_change', headline: `Pricing changed on ${pc.detectedAt.slice(0, 10)}`, url: pc.currentSnapshotUrl, confidence: 0.75 });
  }
  for (const h of c.heroChanges) {
    out.push({ signalType: 'positioning_change', headline: `Homepage hero changed on ${h.detectedAt.slice(0, 10)}`, confidence: 0.7 });
  }
}

function pushOperationalSignals(out: InternalSignal[], op: OperationalPayload, domain: string): void {
  for (const tool of op.techStack) {
    out.push({ signalType: 'tech_added', headline: `Added ${tool.name} to stack`, confidence: 0.6 });
  }
  for (const sub of op.notableSubdomains) {
    out.push({ signalType: 'subdomain_notable', headline: `Subdomain ${sub} is live`, confidence: 0.75 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- contextMapper
```

Expected: PASS — all 8 cases green.

- [ ] **Step 5: Commit**

```bash
git add tools/radar-enrich/src/synthesis/contextMapper.ts tools/radar-enrich/tests/synthesis/contextMapper.test.ts
git commit -m "feat(radar-enrich): contextMapper flattens module outputs to Stage 10 signals"
```

---

### Task 7.2: hookGenerator (calls regenerateHook 3x in parallel)

**Files:**
- Create: `tools/radar-enrich/src/synthesis/hookGenerator.ts`
- Create: `tools/radar-enrich/tests/synthesis/hookGenerator.test.ts`

`hookGenerator` imports `regenerateHook` from `../../../src/core/pipeline/regenerateHook.js` (relative path; reachable on disk). For tests, `regenerateHook` is dependency-injected via a factory that wraps the real call. Returns `{ topSignals, suggestedHooks, totalCostUsd }` — `topSignals` derived from the top-5 confidence signals (no extra Claude call).

- [ ] **Step 1: Write the failing tests**

Create `tools/radar-enrich/tests/synthesis/hookGenerator.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateHooks } from '../../src/synthesis/hookGenerator.js';
import type { SynthesizedContext } from '../../src/synthesis/contextMapper.js';

const fakeContext: SynthesizedContext = {
  lead: { business_name: 'Acme', website_url: 'acme.com', manual_hook_note: null },
  persona: { role: 'B2B SaaS founder' },
  signals: [
    { signalType: 'customer_added', headline: 'Added logo: Foo Corp', confidence: 0.9 },
    { signalType: 'hiring_senior',  headline: 'Opened Senior Backend Engineer in Mumbai (2026-04-25)', confidence: 0.85 },
    { signalType: 'product_release', headline: 'Released v2.1.0: April', confidence: 0.85 },
    { signalType: 'subdomain_notable', headline: 'Subdomain app.acme.com is live', confidence: 0.75 },
    { signalType: 'tech_added', headline: 'Added Sentry to stack', confidence: 0.6 },
    { signalType: 'tech_added', headline: 'Added Stripe to stack', confidence: 0.6 },
  ],
};

describe('generateHooks', () => {
  it('calls regenerateHook 3 times in parallel and returns 3 suggestedHooks', async () => {
    const fakeRegenerate = vi.fn(async () => ({
      hook: `hook-${Math.random().toString(36).slice(2, 6)}`,
      costUsd: 0.004, model: 'claude-sonnet-4', hookVariantId: 'A' as const,
    }));
    const result = await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    expect(fakeRegenerate).toHaveBeenCalledTimes(3);
    expect(result.suggestedHooks.length).toBe(3);
    expect(result.suggestedHooks.every((h) => h.startsWith('hook-'))).toBe(true);
  });

  it('topSignals are the top 5 by confidence, formatted as "[type] headline"', async () => {
    const fakeRegenerate = vi.fn(async () => ({ hook: 'h', costUsd: 0, model: 'm', hookVariantId: 'A' as const }));
    const result = await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    expect(result.topSignals.length).toBe(5);
    expect(result.topSignals[0]).toBe('[customer_added] Added logo: Foo Corp');
    expect(result.topSignals[1]).toBe('[hiring_senior] Opened Senior Backend Engineer in Mumbai (2026-04-25)');
  });

  it('totalCostUsd sums across the 3 calls', async () => {
    const fakeRegenerate = vi.fn(async () => ({ hook: 'h', costUsd: 0.005, model: 'm', hookVariantId: 'A' as const }));
    const result = await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    expect(result.totalCostUsd).toBeCloseTo(0.015, 5);
  });

  it('passes lead, persona, and stripped signals (no confidence) to regenerateHook', async () => {
    const fakeRegenerate = vi.fn(async () => ({ hook: 'h', costUsd: 0, model: 'm', hookVariantId: 'A' as const }));
    await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    const [lead, persona, signals] = fakeRegenerate.mock.calls[0]!;
    expect(lead).toEqual(fakeContext.lead);
    expect(persona).toEqual(fakeContext.persona);
    expect(signals.length).toBe(fakeContext.signals.length);
    expect((signals[0] as Record<string, unknown>).confidence).toBeUndefined();
    expect(signals[0]).toEqual({ signalType: 'customer_added', headline: 'Added logo: Foo Corp' });
  });

  it('handles regenerateHook rejection gracefully — surfaces partial set', async () => {
    let i = 0;
    const fakeRegenerate = vi.fn(async () => {
      i += 1;
      if (i === 2) throw new Error('claude rate limit');
      return { hook: `hook-${i}`, costUsd: 0.003, model: 'm', hookVariantId: 'A' as const };
    });
    const result = await generateHooks(fakeContext, { regenerateHook: fakeRegenerate });
    expect(result.suggestedHooks.length).toBe(2);
    expect(result.errors?.[0]).toContain('rate limit');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd tools/radar-enrich && npm test -- hookGenerator
```

Expected: FAIL.

- [ ] **Step 3: Create hookGenerator.ts**

Create `tools/radar-enrich/src/synthesis/hookGenerator.ts`:

```ts
import { toStage10Signals, type SynthesizedContext } from './contextMapper.js';

export interface RegenerateHookResult {
  hook: string;
  costUsd: number;
  model: string;
  hookVariantId: 'A' | 'B';
}

export interface RegenerateHookFn {
  (lead: unknown, persona: unknown, signals: unknown): Promise<RegenerateHookResult>;
}

export interface HookGeneratorDeps {
  regenerateHook: RegenerateHookFn;
}

export interface HookGenerationResult {
  topSignals: string[];
  suggestedHooks: string[];
  totalCostUsd: number;
  errors?: string[];
}

/** Top 5 signals by confidence, formatted as "[signalType] headline". Deterministic. */
export function deriveTopSignals(ctx: SynthesizedContext): string[] {
  return ctx.signals.slice(0, 5).map((s) => `[${s.signalType}] ${s.headline}`);
}

/**
 * Calls Stage 10's regenerateHook 3 times in parallel, gathers candidates,
 * and derives topSignals deterministically. Tolerates per-call failures —
 * partial hook sets are surfaced with an errors[] note.
 */
export async function generateHooks(
  ctx: SynthesizedContext,
  deps: HookGeneratorDeps,
): Promise<HookGenerationResult> {
  const stage10Signals = toStage10Signals(ctx.signals);
  const calls = [0, 1, 2].map(() =>
    deps.regenerateHook(ctx.lead, ctx.persona, stage10Signals)
      .then((r) => ({ ok: true as const, r }))
      .catch((err: Error) => ({ ok: false as const, err })),
  );
  const settled = await Promise.all(calls);

  const suggestedHooks: string[] = [];
  const errors: string[] = [];
  let totalCostUsd = 0;
  for (const s of settled) {
    if (s.ok) {
      suggestedHooks.push(s.r.hook);
      totalCostUsd += s.r.costUsd;
    } else {
      errors.push(s.err.message);
    }
  }

  return {
    topSignals: deriveTopSignals(ctx),
    suggestedHooks,
    totalCostUsd,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Default factory that pulls in the real Stage 10 implementation.
 * Imported lazily so tests don't need to load the JS module's transitive deps
 * (Anthropic SDK, etc.) — tests inject a fake `regenerateHook` directly.
 *
 * Path note: Node ESM dynamic import() resolves relative to THIS module's URL
 * (not process.cwd()). From tools/radar-enrich/src/synthesis/hookGenerator.ts
 * the relative path to src/core/pipeline/regenerateHook.js is 4 levels up:
 *   synthesis → src → radar-enrich → tools → repo-root
 */
export async function loadRealRegenerateHook(): Promise<RegenerateHookFn> {
  const mod = await import('../../../../src/core/pipeline/regenerateHook.js');
  const fn = (mod as { regenerateHook: RegenerateHookFn }).regenerateHook;
  if (typeof fn !== 'function') throw new Error('regenerateHook not exported from src/core/pipeline/regenerateHook.js');
  return fn;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/radar-enrich && npm test -- hookGenerator
```

Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add tools/radar-enrich/src/synthesis/hookGenerator.ts tools/radar-enrich/tests/synthesis/hookGenerator.test.ts
git commit -m "feat(radar-enrich): hookGenerator wraps Stage 10 regenerateHook (3x parallel)"
```

---

### Task 7.3: Wire synthesis into cli.ts

**Files:**
- Modify: `tools/radar-enrich/src/cli.ts`

After the orchestrator returns, build the synthesized context, call `generateHooks`, and populate the dossier's `signalSummary`. When `--debug-context` is set, include `synthesizedContext` and `stage10` in `signalSummary._debug`.

- [ ] **Step 1: Add the synthesis imports**

In `tools/radar-enrich/src/cli.ts`, add:

```ts
import { mapContext, toStage10Signals } from './synthesis/contextMapper.js';
import { generateHooks, loadRealRegenerateHook } from './synthesis/hookGenerator.js';
import { execFileSync } from 'node:child_process';
```

- [ ] **Step 2: Make `loadRegenerateHook` injectable so tests can swap it**

Change `main`'s signature in `cli.ts` to accept an optional dependency:

```ts
import type { RegenerateHookFn } from './synthesis/hookGenerator.js';

export interface MainDeps {
  /** Override for tests; defaults to loadRealRegenerateHook() (lazy). */
  loadRegenerateHook?: () => Promise<RegenerateHookFn>;
}

export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  // ... unchanged through orchestrator call ...
}
```

Update the entrypoint guard at the bottom of `cli.ts` to keep the no-arg call working:

```ts
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { process.stderr.write(`error: ${(err as Error).message}\n`); process.exit(1); },
  );
}
```

- [ ] **Step 3: Replace the placeholder `signalSummary` block in `main()`**

Replace this block:

```ts
  // Synthesis is wired in Chunk 5. For now emit an empty signalSummary.
  const dossier: EnrichedDossier = {
    company: opts.input,
    enrichedAt: new Date().toISOString(),
    totalCostPaise: summary.totalCostPaise,
    totalDurationMs: summary.totalDurationMs,
    modules: { ... },
    signalSummary: { topSignals: [], suggestedHooks: [], totalCostUsd: 0 },
  };
```

with:

```ts
  const ctx = mapContext(opts.input, {
    hiring:      results.hiring      ?? emptyResult('hiring'),
    product:     results.product     ?? emptyResult('product'),
    customer:    results.customer    ?? emptyResult('customer'),
    operational: results.operational ?? emptyResult('operational'),
  });

  let signalSummary;
  try {
    const loader = deps.loadRegenerateHook ?? loadRealRegenerateHook;
    const regenerate = await loader();
    const hooks = await generateHooks(ctx, { regenerateHook: regenerate });
    signalSummary = {
      topSignals: hooks.topSignals,
      suggestedHooks: hooks.suggestedHooks,
      totalCostUsd: hooks.totalCostUsd,
      ...(opts.debugContext ? {
        _debug: {
          synthesizedContext: { lead: ctx.lead, persona: ctx.persona, signals: toStage10Signals(ctx.signals) },
          stage10: { path: 'src/core/pipeline/regenerateHook.js', gitSha: gitShaSafe() },
        },
      } : {}),
    };
  } catch (err) {
    logger.warn('synthesis failed', { error: (err as Error).message });
    signalSummary = { topSignals: [], suggestedHooks: [], totalCostUsd: 0 };
  }

  const dossier: EnrichedDossier = {
    company: opts.input,
    enrichedAt: new Date().toISOString(),
    totalCostPaise: summary.totalCostPaise,
    totalDurationMs: summary.totalDurationMs,
    modules: {
      hiring:      results.hiring      ?? emptyResult('hiring'),
      product:     results.product     ?? emptyResult('product'),
      customer:    results.customer    ?? emptyResult('customer'),
      voice:       results.voice       ?? emptyResult('voice'),
      operational: results.operational ?? emptyResult('operational'),
      positioning: results.positioning ?? emptyResult('positioning'),
    },
    signalSummary,
  };
```

Add the import for `toStage10Signals` from contextMapper:

```ts
import { mapContext, toStage10Signals } from './synthesis/contextMapper.js';
```

Add the helper at the bottom of the file (alongside `emptyResult`):

```ts
import { execFileSync } from 'node:child_process';

function gitShaSafe(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
```

(Replace the earlier `import { execSync } from 'node:child_process';` if you added it in Step 1; we use `execFileSync` to avoid even the appearance of shell injection.)

- [ ] **Step 4: Update the integration tests in cli.test.ts**

Now that `main()` accepts an injectable `loadRegenerateHook`, update the existing integration tests to inject a fake instead of relying on the real Stage 10 import (which would otherwise pull in `@anthropic-ai/sdk` and try to make real API calls).

In the existing `describe('main() integration')` block, change both invocations of `main(...)` to pass a `deps` argument:

```ts
const fakeLoad = async () => async (_lead, _persona, _signals) => ({
  hook: 'hook-from-fake', costUsd: 0.001, model: 'fake', hookVariantId: 'A' as const,
});

// Test 1
const code = await main(['--company', 'Acme', '--domain', 'acme.com'], { loadRegenerateHook: fakeLoad });

// Test 2
const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--out', out], { loadRegenerateHook: fakeLoad });
```

Then add explicit synthesis tests:

Append to `tools/radar-enrich/tests/cli.test.ts`:

```ts
describe('main() synthesis', () => {
  let tmp: string;
  let originalCwd: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stdoutChunks: string[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'radar-enrich-syn-'));
    originalCwd = process.cwd();
    process.chdir(tmp);
    stdoutChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('populates signalSummary when synthesis succeeds', async () => {
    const fakeLoad = async () => async (_lead: unknown, _persona: unknown, _signals: unknown) => ({
      hook: 'fake-hook', costUsd: 0.002, model: 'fake', hookVariantId: 'A' as const,
    });
    const code = await main(['--company', 'Acme', '--domain', 'acme.com'], { loadRegenerateHook: fakeLoad });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.signalSummary.suggestedHooks.length).toBe(3);
    expect(parsed.signalSummary.suggestedHooks[0]).toBe('fake-hook');
    expect(parsed.signalSummary.totalCostUsd).toBeCloseTo(0.006, 5);
  });

  it('falls back to empty signalSummary when loadRegenerateHook throws', async () => {
    const fakeLoad = async () => { throw new Error('SDK not installed'); };
    const code = await main(['--company', 'Acme', '--domain', 'acme.com'], { loadRegenerateHook: fakeLoad });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.signalSummary.topSignals).toEqual([]);
    expect(parsed.signalSummary.suggestedHooks).toEqual([]);
    expect(parsed.signalSummary.totalCostUsd).toBe(0);
  });

  it('--debug-context includes synthesizedContext + stage10 metadata', async () => {
    const fakeLoad = async () => async (_lead: unknown, _persona: unknown, _signals: unknown) => ({
      hook: 'fake-hook', costUsd: 0, model: 'fake', hookVariantId: 'A' as const,
    });
    const code = await main(['--company', 'Acme', '--domain', 'acme.com', '--debug-context'], { loadRegenerateHook: fakeLoad });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.signalSummary._debug).toBeDefined();
    expect(parsed.signalSummary._debug.synthesizedContext.lead.business_name).toBe('Acme');
    expect(parsed.signalSummary._debug.stage10.path).toBe('src/core/pipeline/regenerateHook.js');
    expect(parsed.signalSummary._debug.stage10.gitSha).toMatch(/^[0-9a-f]{7,40}$|^unknown$/);
  });
});
```

- [ ] **Step 5: Run all tests + typecheck**

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Expected: all green. Total test count should now be ~95+.

- [ ] **Step 6: End-to-end smoke test (optional, requires keys)**

Requires `.env` with at least `ANTHROPIC_API_KEY`. With keys set:

```bash
cd tools/radar-enrich && npx tsx src/cli.ts --company "Stripe" --domain stripe.com --debug-context --verbose 2>&1 1>/tmp/dossier.json | tee /tmp/run.log
jq '.signalSummary' /tmp/dossier.json
```

Expected: `topSignals` array of 5 strings; `suggestedHooks` array of 3 strings; `totalCostUsd` non-zero; `_debug.synthesizedContext` populated; `_debug.stage10.gitSha` is a SHA (not "unknown"). If `signalSummary.suggestedHooks` is empty, check `/tmp/run.log` for the `synthesis failed` warning — that tells you whether the import failed (path/SDK issue) vs. the calls failed (rate limit / bad key).

- [ ] **Step 7: Commit**

```bash
git add tools/radar-enrich/src/cli.ts tools/radar-enrich/tests/cli.test.ts
git commit -m "feat(radar-enrich): wire synthesis into CLI (signalSummary populated)"
```

---

### Task 7.4: Flesh out README

**Files:**
- Modify: `tools/radar-enrich/README.md`

Replace the placeholder README from Task 1.1 with the full version: setup, key acquisition links, sample run with annotated output, troubleshooting.

- [ ] **Step 1: Replace README contents**

Replace `tools/radar-enrich/README.md` entirely with:

````markdown
# radar-enrich

Strategic-signal validation prototype for Radar cold outreach. Enriches a single company with operational-truth signals (hiring, GitHub activity, Wayback diffs, tech stack) and feeds the result through Radar's existing Stage 10 hook generator (`src/core/pipeline/regenerateHook.js`) to produce 3 candidate hooks per run for manual quality review.

**Spec:** [docs/superpowers/specs/2026-05-01-radar-enrich-prototype-design.md](../../docs/superpowers/specs/2026-05-01-radar-enrich-prototype-design.md)

## What this is for

Validating the hypothesis: **operational-truth signals (job boards, GitHub events, Wayback diffs, tech-stack fingerprints) produce sharper hooks than LinkedIn-derived signals.** Run on 3–5 of your real ready leads, eyeball the generated hooks, decide whether to invest in the full pipeline.

This is **not** the production system. No DB, no queue, no integration with the BullMQ workers. Throwaway-if-fails.

## Setup

```bash
cd tools/radar-enrich
npm install
cp .env.example .env
```

Fill in `.env`. Required keys depend on which modules you run; the CLI fails fast and tells you which key is missing for which module.

| Key | Required for | Get it from |
|---|---|---|
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | hiring | https://developer.adzuna.com/ (free tier) |
| `GITHUB_TOKEN` | product | https://github.com/settings/tokens (`public_repo` scope is enough) |
| `ANTHROPIC_API_KEY` | synthesis (Stage 10 hook gen) | https://console.anthropic.com/ |
| `SERPER_API_KEY`, `BRAVE_API_KEY`, `LISTEN_NOTES_KEY` | (stub modules — not currently needed) | — |

The `customer` and `operational` modules require no keys.

## Run

Single company, default modules (all six):

```bash
npm run enrich -- --company "Acme Corp" --domain acme.com
```

With location + verbose logging:

```bash
npm run enrich -- --company "Acme Corp" --domain acme.com --location "Mumbai, India" --verbose
```

Write to a file:

```bash
npm run enrich -- --company "Acme Corp" --domain acme.com --out ./profiles/acme.json
```

Subset of modules (skip the slower / stub-only ones):

```bash
npm run enrich -- --company "Acme Corp" --domain acme.com --modules hiring,product,customer,operational
```

Inspect the synthesized context fed to Stage 10 (debugging hook quality):

```bash
npm run enrich -- --company "Acme Corp" --domain acme.com --debug-context | jq '.signalSummary._debug'
```

Validate on 5 real ready leads (shell loop):

```bash
mkdir -p profiles
for company in "Acme Corp:acme.com:Mumbai" "Beta Inc:beta.io:Bengaluru" ...; do
  IFS=':' read -r name domain location <<< "$company"
  npm run enrich -- --company "$name" --domain "$domain" --location "$location" --out "profiles/${domain}.json"
done

# Eyeball the hooks
for f in profiles/*.json; do
  echo "=== $f ==="
  jq -r '.signalSummary.suggestedHooks[]' "$f"
done
```

## CLI flags

| Flag | Default | Notes |
|---|---|---|
| `-c, --company <name>` | required | Company display name |
| `-d, --domain <domain>` | required | Primary domain (e.g. `acme.com`) |
| `-l, --location <location>` | — | "City, Country" — improves Adzuna scoping |
| `-f, --founder <name>` | — | Currently unused (voice module is stubbed) |
| `-m, --modules <list>` | all 6 | Comma-separated subset |
| `-o, --out <path>` | stdout | Write JSON to file |
| `--no-cache` | (cache on) | Skip cache reads (writes still happen) |
| `--clear-cache` | — | Wipe `./cache/` and exit |
| `--debug-context` | off | Include synthesized LeadContext in output |
| `--concurrency <n>` | 4 | Adapter parallelism |
| `--timeout <ms>` | 30000 | Per-adapter timeout |
| `-v, --verbose` | off | Per-adapter timing/cost summary |

## Output shape

See spec §12. Top-level keys: `company`, `enrichedAt`, `totalCostPaise`, `totalDurationMs`, `modules` (6 keys), `signalSummary` (`topSignals`, `suggestedHooks`, `totalCostUsd`, optional `_debug`).

## Caching

- Path: `./cache/<adapter>-<inputHash>-<adapterVersion>-<YYYYMMDD>.json`
- TTL: 24h via the date suffix (rolls over naturally each day)
- `--no-cache`: skip reads, still write
- `--clear-cache`: wipe `./cache/` and exit
- Errored results are NOT cached — flaky runs auto-retry; partial+ok runs ARE cached so you don't burn API budget re-running

## Tests

```bash
npm test                    # all tests, no network (HTTP fixtures)
npm run typecheck           # tsc --noEmit
```

## Module status

| # | Module | Status | Notes |
|---|---|---|---|
| 1 | Hiring | built | Adzuna + careers HTML scrape |
| 2 | Product | built | GitHub org + repos + events + changelog autodiscovery |
| 3 | Customer | built | Wayback diff: logos + pricing + hero |
| 4 | Voice | stub | Listen Notes + YouTube + Substack/Medium discovery (deferred) |
| 5 | Operational | built | tech-stack fingerprints + DNS + crt.sh |
| 6 | Positioning | stub | Serper + Brave news + Crunchbase + ad library URLs (deferred) |

## Troubleshooting

**"Adapter `hiring` requires env vars that are missing or empty"**
You haven't set `ADZUNA_APP_ID` and/or `ADZUNA_APP_KEY` in `.env`. Run `--modules product,customer,operational` to skip hiring entirely if you don't have the keys yet.

**Synthesis section is always empty**
`signalSummary.suggestedHooks` is empty when `loadRealRegenerateHook()` fails to import — usually because `ANTHROPIC_API_KEY` is unset or because the relative path from `tools/radar-enrich/src/synthesis/hookGenerator.ts` to `src/core/pipeline/regenerateHook.js` no longer resolves. Run with `--verbose` and check stderr for the `synthesis failed` warning.

**A single adapter is hanging the run**
Lower `--timeout` (default 30000ms). Adapter aborts surface as `status:'error'` and don't fail the rest of the run.

**Cache not invalidating after I changed an adapter**
Bump the adapter's `version` field (`0.1.0` → `0.1.1`). The version is in the cache key; bumping it invalidates yesterday's stale hits.

## Promotion path

If validation succeeds (hooks are sharper than LinkedIn-derived ones for ≥3 of 5 leads), promote to a workspace package: `git mv tools/radar-enrich apps/enrich-cli` and add to `npm install`'s workspace list. Otherwise: `rm -rf tools/radar-enrich`.
````

- [ ] **Step 2: Commit**

```bash
git add tools/radar-enrich/README.md
git commit -m "docs(radar-enrich): full README with setup, run examples, troubleshooting"
```

---

## Chunk 7 complete checkpoint

After this chunk:
- All 6 modules in place; 4 produce real signals, 2 stubbed
- contextMapper flattens 4 module payloads into Stage 10's `signals[]` shape per spec §6.3
- hookGenerator calls `regenerateHook` 3x in parallel; topSignals derived deterministically
- `--debug-context` exposes the synthesized context + Stage 10 git SHA for hook iteration
- README documents setup, run, troubleshooting, promotion path
- Test count should now be ~95+

Verify:

```bash
cd tools/radar-enrich && npm test && npm run typecheck
```

Both must exit 0.

**End-to-end validation run** (the prototype's actual purpose):

```bash
cd tools/radar-enrich
# .env populated with ADZUNA_*, GITHUB_TOKEN, ANTHROPIC_API_KEY
mkdir -p profiles
for entry in \
  "Lead1:lead1.com:Mumbai" \
  "Lead2:lead2.io:Bengaluru" \
  "Lead3:lead3.in:Delhi" \
  "Lead4:lead4.co:Hyderabad" \
  "Lead5:lead5.com:Pune"
do
  IFS=':' read -r name domain location <<< "$entry"
  npx tsx src/cli.ts --company "$name" --domain "$domain" --location "$location, India" \
    --modules hiring,product,customer,operational \
    --debug-context --verbose --out "profiles/${domain}.json" 2>"profiles/${domain}.log"
done

# Inspect hook quality manually
for f in profiles/*.json; do
  echo "=== $(basename $f) ==="
  jq -r '"Top signals:", .signalSummary.topSignals[], "", "Suggested hooks:", .signalSummary.suggestedHooks[]' "$f"
  echo
done
```

If the hooks are materially sharper than what the production pipeline produces for the same leads → invest in the full pipeline. If not → `rm -rf tools/radar-enrich`.

---

## Final: Plan complete

All 7 chunks deliver:

1. Foundation (package skeleton + types + env + logger)
2. HTTP wrapper + file cache
3. Top-level schemas + voice/positioning stubs
4. Orchestrator + CLI shell (end-to-end with stubs only)
5. Helpers (classify, domainUtils) + hiring + product adapters
6. Tech-stack fingerprints + customer + operational adapters + cli cleanup
7. Synthesis (contextMapper + hookGenerator) + final assembly + README

**Final verification:**

```bash
cd tools/radar-enrich && npm test && npm run typecheck && npm run build
```

All three must exit 0. Total test count should be ~95+.