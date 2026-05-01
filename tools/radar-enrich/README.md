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
`signalSummary.suggestedHooks` is empty when `loadRealRegenerateHook()` fails to import — usually because `ANTHROPIC_API_KEY` is unset or because the relative path from `tools/radar-enrich/src/synthesis/hookGenerator.ts` to `src/core/pipeline/regenerateHook.js` no longer resolves. Run with `--verbose` and check stderr for the `synthesis failed` warning. Also check whether the Claude calls themselves rejected (rate limit / bad key) — the per-call errors are logged at `warn` level.

**A single adapter is hanging the run**
Lower `--timeout` (default 30000ms). Adapter aborts surface as `status:'error'` and don't fail the rest of the run.

**Cache not invalidating after I changed an adapter**
Bump the adapter's `version` field (`0.1.0` → `0.1.1`). The version is in the cache key; bumping it invalidates yesterday's stale hits.

## Promotion path

If validation succeeds (hooks are sharper than LinkedIn-derived ones for ≥3 of 5 leads), promote to a workspace package: `git mv tools/radar-enrich apps/enrich-cli` and add to `npm install`'s workspace list. Otherwise: `rm -rf tools/radar-enrich`.
