# Radar

Automated cold email client acquisition engine for Simple Inc, productized as a multi-tenant SaaS for B2B agencies. Finds Indian SMB websites with outdated tech, verifies a decision-maker email, writes a personalized plain-text cold email, sends it through a warmed inbox, threads follow-ups, classifies replies, and reports — all from a single Postgres database, a React dashboard, and a queue-driven worker fleet.

Target: **34 emails/day** through two Google Workspace inboxes on `trysimpleinc.com`, ramping on a warmup schedule. Goal: ₹1 lakh/month recurring from cold outreach + agency subscriptions.

> Full context — engines, environment variables, anti-spam policy, non-negotiable rules, roadmap — lives in [CLAUDE.md](./CLAUDE.md).

## Quick start

```bash
# 1. Install (npm workspaces — one command covers apps/*, packages/*, root)
npm install

# 2. Configure
cp .env.example .env
# fill in INBOX_*, GEMINI_API_KEY, ANTHROPIC_API_KEY, MEV_API_KEY,
# TELEGRAM_*, JWT_SECRET, GOOGLE_CLIENT_*, RAZORPAY_*, DATABASE_URL, REDIS_URL

# 3. Spin up Postgres + Redis
docker compose -f infra/docker-compose.yml up -d

# 4. Apply schema
npx prisma migrate deploy
npx prisma generate

# 5. Verify
npx tsc --noEmit -p apps/api/tsconfig.json
npm test                     # vitest across all workspaces

# 6. Dev — three concurrent processes (api, legacy, web) under one Ctrl+C
npm run dev
#   apps/api      → :3001  (GraphQL Yoga at /graphql, WS subscriptions, OAuth, OTP, billing)
#   src/api       → :3002  (legacy Express — REST holdouts only)
#   apps/web      → :5173  (Vite, proxies /graphql + /auth → :3001, /api → :3002)

# 7. Prod — PM2 on the VPS
pm2 start infra/ecosystem.config.cjs
#   radar-cron · radar-dashboard · radar-workers
```

## Repo layout

```
apps/
  api/                  TypeScript API + BullMQ workers (Express + GraphQL Yoga + Pothos)
    src/graphql/        Pothos schema + 22 resolver modules + auth guards + tests
    src/workers/        BullMQ workers replacing the legacy node-cron engines
    src/routes/         REST (auth, otp, billing) + webhooks (google, razorpay)
    src/middleware/     requireAuth · requireSuperadmin · enforcePlan · rate limits
  web/                  React 18 + Vite + Tailwind + urql GraphQL client
    src/components/radar/   RADAR design system (light SaaS, emerald accent)
    src/pages/          Today · Engines · Leads · Spend · Email Health · Settings · Superadmin · …
    src/api.js          GraphQL adapter the legacy .jsx pages still use
packages/
  shared/               Singleton Prisma client + scopedPrisma (per-tenant query wrapper)
prisma/                 schema.prisma + migration history (Postgres 16)
src/                    Legacy single-tenant code path being phased out
  engines/              node-cron engines (cutover to apps/api/src/workers in progress)
  api/                  Legacy Express dashboard — REST holdouts only post-PR-#16
  core/                 Pipeline helpers + AI clients + email + signal adapters (still used by both stacks)
infra/                  docker-compose · ecosystem.config.cjs · nginx-radar.conf · backup.sh
tests/                  vitest — engines, api, core
scripts/                One-off helpers (db tunnel, seed)
```

`apps/*` and `packages/*` are an npm workspace monorepo. Workspace imports use the `shared` package name; never relative paths into `packages/`.

## The engines

Daily IST schedule. The legacy node-cron path (`src/scheduler/cron.js` + `src/engines/*.js`) and the new BullMQ workers (`apps/api/src/workers/*.worker.ts`) are both wired up; the cutover is staged per engine. PM2 runs the workers process; legacy cron is **off by default** (`LEGACY_CRON_ENABLED!=true`).

| Engine | When (IST) | What |
|---|---|---|
| Lead Intelligence | 09:00 Mon–Sat | 11-stage pipeline: Gemini discovery → extraction → ICP scoring → Claude hook + body. ~150 raw → ~34 ready. |
| Email Sending | 09:30 Mon–Sat | Round-robins two GWS inboxes, plain text only, 3–7 min random delays, content-validated pre-send. |
| Follow-ups | 18:00 daily | 5-step threaded sequence using `inReplyTo` + `references`. |
| Reply Intelligence | 14:00, 16:00, 20:00 | IMAP fetch both inboxes, Claude Haiku classify (hot/schedule/soft_no/unsubscribe/ooo/other), Telegram alerts. |
| Reporting | 20:30 | Telegram digest + email digest. |
| Health Check | 02:00 Sun | DNS checks against Spamhaus, Barracuda, SURBL. |
| Trial Expiry | 02:30 daily | Locks org subscriptions whose grace period ended. |
| Backup | 02:00 daily | Postgres dump → Backblaze B2 via rclone. |

## Anti-spam

Four layers, enforced in code:

1. **DNS auth** — SPF, DKIM, DMARC `p=none`
2. **Behavior** — `DAILY_SEND_LIMIT` cap, randomized delays, send window 9:30–17:30 IST Mon–Sat, holidays blocked
3. **Content validator** — plain text only, 40–90 words, no URLs in step 0–1, `SPAM_WORDS` blocklist, regenerate-once on fail
4. **Health monitor** — bounce >2% auto-pauses sends; unsub >1% over 7d alerts Telegram; weekly DNS blacklist sweep

See [CLAUDE.md §5 & §9](./CLAUDE.md) for the non-negotiable rules — plain text only, no tracking, no links in cold steps, etc.

## Dashboard

React SPA at `radar.simpleinc.cloud` (Nginx → `:3001`). Google OAuth + email-OTP fallback → JWT cookie. Multi-tenant with three roles (owner / admin / superadmin). Plan gating renders a paywall when `subscription.status === 'locked'`.

The SPA talks to two backends:

- **GraphQL** (`apps/api` at `:3001`) for almost everything — overview, funnel, costs, errors, replies, niches, offer/ICP, engine guardrails, saved views, bulkRetry estimates + subscription, etc. Pages that opted into urql (`settings/*`, `superadmin/*`) call it directly; the legacy `.jsx` pages call it via the adapter in `apps/web/src/api.js`.
- **Legacy REST** (`src/api` at `:3001` prod, `:3002` dev) for the holdouts that can't yet move: lead list/detail/patch/status/signals (URL query-string parser pending), `sendLog`, on-demand engine triggering (`runEngine` / `unlockEngine` / `engineStatus` — semantics changed in the BullMQ cutover), `exportLeadsCsv` (binary stream — stays REST permanently), and the bulk-action endpoints.

## Tests

```bash
npm test                                  # all workspaces
npm run test --workspace=apps/api         # apps/api (130+ tests)
npm test --workspace=apps/web             # apps/web
npm test -- tests/engines                 # legacy engines
```

Backend tests use a Postgres test database (`DATABASE_URL_TEST`) reset per-suite via helpers in `tests/helpers/testDb.js`. Resolver tests under `apps/api/src/graphql/resolvers/__tests__/` mock `ctx.db` so they don't hit the real database.

## Roadmap

- **Phase 1** (current) — 1 domain, 2 inboxes, warmup → 34/day
- **Phase 1.5** (in progress) — multi-tenant rebuild on Postgres + BullMQ + GraphQL; legacy REST cutover (PR #16) shipped, decommission cleanup pending
- **Phase 2** — 2nd domain, 68/day, Postmaster API, US East Coast send window
- **Phase 3** — Multi-tenant SaaS productization (Trial / Starter ₹2,999 / Growth ₹6,999 / Agency ₹14,999)

See [CLAUDE.md §10](./CLAUDE.md) for the per-phase checklist.

## License

Proprietary — Simple Inc.
