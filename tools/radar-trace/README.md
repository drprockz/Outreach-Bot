# Radar Trace

Structured digital-footprint collection layer for Radar. Phase 1A scope: ~30 ToS-clean data-collection adapters across 9 modules. **No AI synthesis (Phase 2).** **No temporal monitoring (Phase 1.5).**

**Spec:** [docs/superpowers/specs/2026-05-01-radar-trace-design.md](../../docs/superpowers/specs/2026-05-01-radar-trace-design.md)

## Setup

```bash
cd tools/radar-trace
npm install
cp .env.example .env
# fill in keys for the modules you plan to run
```

## Run

```bash
# Validation-cost mode (free + Serper + Brave only; ~₹2/lead)
npm run trace -- --company "Acme Corp" --domain acme.com --skip-paid

# Full trace (all modules including paid Apify; ~₹500-620/lead)
npm run trace -- --company "Acme Corp" --domain acme.com

# Subset of modules
npm run trace -- --company "Acme Corp" --domain acme.com --modules hiring,product,operational

# Subset of adapters (granular)
npm run trace -- --company "Acme Corp" --domain acme.com --adapters hiring.adzuna,operational.crtsh
```

## Test

```bash
npm test          # unit tests, no network
npm run typecheck # tsc --noEmit
```

(README is updated chunk-by-chunk; current state reflects only what's been built so far in Chunk 1.)
