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
