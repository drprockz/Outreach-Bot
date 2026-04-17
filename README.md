# Radar

Automated cold email client acquisition engine for Simple Inc. Finds Indian SMB websites with outdated tech, verifies a decision-maker email, writes a personalized plain-text cold email, sends it through a warmed inbox, threads follow-ups, classifies replies, and reports — all from a single SQLite database and a React dashboard.

Target: **34 emails/day** through two Google Workspace inboxes on `trysimpleinc.com`, ramping on a warmup schedule. Goal: ₹1 lakh/month recurring from cold outreach.

## Quick start

```bash
# Install
npm install
(cd web && npm install)

# Configure
cp .env.example .env
# fill in INBOX_*, GEMINI_API_KEY, ANTHROPIC_API_KEY, MEV_API_KEY,
# TELEGRAM_*, DASHBOARD_PASSWORD, JWT_SECRET

# Verify everything builds and tests pass
npm test

# Dev — API + web
node src/api/server.js              # :3001 (serves /api/*)
(cd web && npm run dev)             # :5173 (vite, proxies /api → :3001)

# Prod — PM2 on VPS
pm2 start infra/ecosystem.config.js
```

## Repo layout

```
src/engines/       cron jobs — one per engine
src/api/           Express server + per-resource route modules
src/core/          shared libs (db, ai, email, integrations, lib)
src/scheduler/     node-cron wiring
web/               React 18 + Vite SPA (dashboard)
db/                schema.sql + runtime SQLite (gitignored)
infra/             PM2 config + backup.sh
tests/             vitest — mirrors src/
scripts/           manual smoke/test scripts (not cron-run)
```

See [CLAUDE.md](./CLAUDE.md) for full context: engines, environment variables, anti-spam policy, rules, and roadmap.

## The engines

| Engine | When (IST) | What |
|---|---|---|
| `findLeads.js` | 09:00 Mon–Sat | 11-stage pipeline: Gemini discovery → extraction → ICP scoring → Claude hook + body. ~150 raw → ~34 ready. |
| `sendEmails.js` | 09:30 Mon–Sat | Round-robins two GWS inboxes, plain text only, 3–7 min random delays, content-validated pre-send. |
| `sendFollowups.js` | 18:00 daily | 5-step threaded sequence (day 0/3/7/14/90) using `inReplyTo` + `references`. |
| `checkReplies.js` | 14:00, 16:00, 20:00 | IMAP fetch both inboxes, Claude Haiku classify (hot/schedule/soft_no/unsubscribe/ooo/other), Telegram alerts. |
| `dailyReport.js` | 20:30 | Telegram one-liner + HTML email digest. |
| `healthCheck.js` | 02:00 Sun | DNS checks against Spamhaus, Barracuda, SURBL. |
| `backup.sh` | 02:00 daily | SQLite snapshot → Backblaze B2 via rclone. |

All scheduled by `src/scheduler/cron.js` running under PM2.

## Anti-spam

Four layers, enforced in code:

1. **DNS auth** — SPF, DKIM, DMARC
2. **Behavior** — send caps, randomized delays, send window, holidays blocked
3. **Content validator** — plain text, 40–90 words, no URLs in step 0–1, SPAM_WORDS blocklist
4. **Health monitor** — bounce >2% → auto-pause; unsub >1% → alert; weekly DNS blacklist sweep

See [CLAUDE.md §5 & §7](./CLAUDE.md) for the non-negotiable rules — plain text only, no tracking, no links in cold steps, etc.

## Dashboard

React SPA at `radar.simpleinc.cloud` (Nginx → `:3001`). Password + JWT auth. Views: Overview, Lead Pipeline, Send Log, Reply Feed, Sequence Tracker, Cron Job Status, Health Monitor, Cost Tracker, Error Log, Engine Config, ICP Rules, Email Persona, Funnel Analytics.

## Tests

```bash
npm test                              # all 109 tests
npm test -- tests/engines             # just engines
npm test -- tests/api                 # API + auth + routes
npm test -- tests/core                # core libs
```

Tests spin up a temp SQLite per test via `DB_PATH` override + `resetDb()` from `src/core/db/index.js`.

## Roadmap

- **Phase 1** (current) — 1 domain, 2 inboxes, warmup → 34/day
- **Phase 1.5** (next month) — Postgres migration, personal server, PWA polish, multi-tenant prep
- **Phase 2** — 2nd domain, 68/day, Postmaster API
- **Phase 3** — Multi-tenant SaaS productization

## License

Proprietary — Simple Inc.
