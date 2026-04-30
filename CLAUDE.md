# CLAUDE.md — Radar by Simple Inc

Complete project context for Claude Code working in this repo.

---

## 1. Project Identity

| Field | Value |
|---|---|
| **System name** | Radar |
| **Owner** | Darshan Parmar — Simple Inc (simpleinc.in) |
| **Purpose** | Automated cold email client acquisition engine, productizing into a multi-tenant SaaS for B2B agencies |
| **Goal** | ₹1 lakh/month recurring revenue from cold outreach + agency subscriptions |
| **Monthly expense floor** | ₹50,000 |
| **Dashboard URL** | radar.simpleinc.cloud |
| **Host** | Ubuntu 24 VPS, PM2-managed (migration to personal server in progress) |
| **Primary domain** | simpleinc.in (NEVER used for outreach) |
| **Outreach domain** | trysimpleinc.com (separate GWS account) |
| **Inboxes** | darshan@trysimpleinc.com, hello@trysimpleinc.com |
| **Database** | PostgreSQL via Prisma 6 (migrated from SQLite during the multi-tenant rebuild) |
| **Queue / cache** | Redis + BullMQ (replaces legacy node-cron for engines) |

---

## 2. Repository Layout

This is an **npm workspace monorepo**. Two coexisting code paths during the multi-tenant migration:

- **`apps/`** — the new TypeScript stack being productized (the future).
- **`src/`** — the original single-tenant JS engines + Express dashboard (still operational, being phased out as workers migrate to BullMQ).

```
/
├── apps/
│   ├── api/                          # NEW — TypeScript API + workers
│   │   ├── src/
│   │   │   ├── server.ts             # Express + GraphQL Yoga + WS subscriptions + Bull Board
│   │   │   ├── graphql/
│   │   │   │   ├── builder.ts        # Pothos builder + pubsub
│   │   │   │   ├── schema.ts         # SDL composition
│   │   │   │   ├── context.ts        # auth + scoped Prisma per-request
│   │   │   │   └── resolvers/        # me · leads · orgs · admin (superadmin)
│   │   │   ├── routes/               # auth · otp · billing (REST)
│   │   │   ├── webhooks/             # google (oauth callback) · razorpay (idempotent + signed)
│   │   │   ├── workers/              # BullMQ workers — replace legacy cron engines
│   │   │   │   ├── findLeads.worker.ts
│   │   │   │   ├── sendEmails.worker.ts
│   │   │   │   ├── sendFollowups.worker.ts
│   │   │   │   ├── checkReplies.worker.ts
│   │   │   │   ├── dailyReport.worker.ts
│   │   │   │   ├── healthCheck.worker.ts
│   │   │   │   ├── trialExpiry.worker.ts
│   │   │   │   ├── scheduler.ts      # node-cron → BullMQ producer
│   │   │   │   └── index.ts          # process entrypoint (PM2: radar-workers)
│   │   │   ├── middleware/           # requireAuth · requireSuperadmin · requireRole · enforcePlan · rateLimits
│   │   │   └── lib/                  # jwt · redis · mailer · telegram · multiTenantGuard · tokenRevocation
│   │   └── package.json
│   │
│   └── web/                          # NEW — React 18 + Vite + Tailwind + urql GraphQL client
│       ├── src/
│       │   ├── App.jsx, main.jsx, api.js, index.css
│       │   ├── components/
│       │   │   ├── AppShell.tsx, Sidebar.jsx, AuthGate.tsx
│       │   │   ├── billing/{TrialBanner, GraceBanner, PaywallPage}.tsx
│       │   │   ├── radar/                  # RADAR design system
│       │   │   │   ├── Icon.jsx            # custom thin-stroke icon set
│       │   │   │   ├── RadarUI.jsx         # Button · Badge · StatCard · UsageBar · Status
│       │   │   │   │                       # · Card · Modal · Sparkline · LineChart · Donut
│       │   │   │   │                       # · Input · Select · Checkbox · RadarLogo · Kbd
│       │   │   │   ├── PageHeader.jsx      # sectioned topbar (breadcrumb · title · subtitle · action · bell · ⌘K)
│       │   │   │   └── AuthShell.jsx       # emerald-gradient brand panel + form-card split layout
│       │   │   └── ui/{button,input}.tsx   # shadcn primitives (legacy)
│       │   ├── pages/
│       │   │   ├── Today.jsx, Engines.jsx, Leads.jsx, SentEmails.jsx,
│       │   │   ├── Followups.jsx, Replies.jsx, Funnel.jsx,
│       │   │   ├── Niches.jsx, OfferAndIcp.jsx, EmailVoice.jsx,
│       │   │   ├── Spend.jsx, EmailHealth.jsx, Errors.jsx, ScheduleLogs.jsx,
│       │   │   ├── auth/{Login, Otp, Welcome, Onboarding}.tsx
│       │   │   ├── settings/{Billing, Team, Org, Profile}.tsx
│       │   │   ├── superadmin/{Orgs, OrgDetail, Users, Metrics}.tsx
│       │   │   └── leads/                  # decision-cockpit sub-components
│       │   │       └── KpiStrip · FilterBar · LeadsTable · BulkActionBar · LeadDetailPanel · SavedViews
│       │   └── lib/                        # urqlClient, auth helpers, redirects
│       ├── tailwind.config.ts              # slate-base shadcn config
│       └── package.json
│
├── packages/
│   └── shared/
│       └── src/
│           ├── prismaClient.ts             # singleton Prisma client
│           └── scopedPrisma.ts             # tenant-scoping wrapper (orgId injected on every query)
│
├── prisma/
│   ├── schema.prisma                       # PostgreSQL schema — 23 models
│   └── migrations/                         # Prisma migration history
│
├── src/                                    # LEGACY — original single-tenant codebase
│   ├── engines/                            # node-cron engines (still used until BullMQ migration completes)
│   │   ├── findLeads.js, sendEmails.js, sendFollowups.js,
│   │   ├── checkReplies.js, dailyReport.js, healthCheck.js
│   ├── api/                                # original Express server (port 3001)
│   │   ├── server.js                       # mounts /api/* routers
│   │   ├── middleware/{auth,perOrg}.js
│   │   └── routes/                         # 20+ resource routers (overview, leads, replies, etc.)
│   ├── core/                               # shared libs used by BOTH legacy + apps/api
│   │   ├── db/             # Prisma client wrappers + helpers
│   │   ├── ai/             # claude.js (Anthropic SDK), gemini.js (Google SDK)
│   │   ├── email/          # mailer, imap, contentValidator
│   │   ├── pipeline/       # 11-stage findLeads pipeline (regenerateHook, rescoreIcp, verifyEmail, …)
│   │   ├── signals/        # signal aggregator (LinkedIn, Crunchbase, etc.)
│   │   ├── integrations/   # telegram · mev · blacklistCheck
│   │   ├── lib/            # sleep, concurrency, utils
│   │   └── config/         # env loader
│   └── scheduler/cron.js                   # legacy node-cron wiring
│
├── infra/
│   ├── docker-compose.yml                  # local Postgres 16 + Redis 7
│   ├── ecosystem.config.cjs                # PM2 — runs radar-cron · radar-dashboard · radar-workers
│   ├── nginx-radar.conf                    # reverse proxy → :3001
│   └── backup.sh                           # Postgres → Backblaze B2, daily 02:00
│
├── tests/                                  # vitest, mirrors src/
│   ├── engines/, api/, core/{db,ai,email,integrations,lib,pipeline,signals}/
├── scripts/
│   ├── db-tunnel.sh                        # SSH tunnel to prod Postgres
│   └── seedStarterSettings.js
├── docs/
│   ├── runbooks/                           # incident playbooks
│   └── superpowers/{plans,specs,research,status}
├── .env.example
├── package.json                            # workspace root — npm scripts orchestrate apps/*
├── CLAUDE.md
└── README.md
```

**Workspace rules:**
- `apps/api` and `apps/web` import from `packages/shared` via the `shared` package name (never relative).
- `apps/api` workers import legacy pipeline helpers from `../../../src/core/pipeline/` during the transition.
- New code goes in `apps/`. Don't add to `src/` unless patching a legacy engine still in production.
- Never reintroduce `web/`, `dashboard/`, or top-level `utils/` — those were removed during the apps/ migration.

---

## 3. Multi-Tenancy Model

The Postgres schema enforces tenancy at the data layer:

- **`Org`** — workspace (owner: Darshan for Simple Inc; new orgs onboard via signup).
- **`User`** — authenticated identity, can belong to multiple orgs via `OrgMembership { role: owner | admin }`.
- **`OrgSubscription`** — Razorpay-managed plan + status (`trial` | `active` | `grace` | `locked` | `cancelled`).
- **`Plan`** — Trial / Starter / Growth / Agency pricing rows.
- Every business table (`Lead`, `Email`, `Reply`, `Niche`, `Offer`, `IcpProfile`, `CronLog`, `ErrorLog`, `Config`, …) has an `orgId` column. The legacy single-tenant rows are seeded under `orgId = 1` (Simple Inc).
- **`packages/shared/scopedPrisma.ts`** wraps Prisma with `orgId` auto-injection on every query — request handlers must use `ctx.scopedPrisma`, never raw `prisma`.
- Superadmin (Darshan only, `User.isSuperadmin = true`) bypasses scoping for the `/superadmin/*` GraphQL resolvers and the impersonation flow.

---

## 4. Engines

The 6 engines run on a daily IST schedule. Both the legacy node-cron path (`src/scheduler/cron.js` + `src/engines/*.js`) and the new BullMQ workers (`apps/api/src/workers/*.worker.ts`) are wired up; the cutover is staged per engine.

| Engine | Schedule (IST) | Legacy file | New worker | Purpose |
|---|---|---|---|---|
| Lead Intelligence | 09:00 Mon–Sat | `src/engines/findLeads.js` | `apps/api/src/workers/findLeads.worker.ts` | 11-stage pipeline → ~34 ready leads/day |
| Email Sending | 09:30 Mon–Sat | `src/engines/sendEmails.js` | `sendEmails.worker.ts` | Round-robin inboxes, plain text only |
| Follow-ups | 18:00 daily | `src/engines/sendFollowups.js` | `sendFollowups.worker.ts` | 5-step threaded sequence |
| Reply Intelligence | 14:00, 16:00, 20:00 | `src/engines/checkReplies.js` | `checkReplies.worker.ts` | IMAP fetch + Haiku classify |
| Reporting | 20:30 daily | `src/engines/dailyReport.js` | `dailyReport.worker.ts` | Telegram digest + email digest |
| Health Check | 02:00 Sun | `src/engines/healthCheck.js` | `healthCheck.worker.ts` | DNS blacklist zones |
| Trial Expiry | 02:30 daily | — (new) | `trialExpiry.worker.ts` | Locks orgs whose grace period ended |
| Backup | 02:00 daily | `infra/backup.sh` | (shell) | Postgres → Backblaze B2 |

`apps/api/src/workers/scheduler.ts` produces BullMQ jobs from cron triggers; failed jobs alert via Telegram after 3 attempts.

### findLeads 11-Stage Pipeline (150 raw → ~34 ready)

| # | Stage | Model | Drop rate |
|---|---|---|---|
| 1 | Discovery | Gemini Flash (grounded) | — |
| 2 | Extraction | Gemini Flash | ~10% |
| 3 | Tech fingerprinting | Gemini Flash | — |
| 4 | Business signals | Gemini Flash + signal adapters | — |
| G1 | Gate 1 | — | ~30% (drop modern stacks) |
| 5 | Quality judge | Gemini Flash | inline |
| 6 | DM finder | Gemini Flash | ~15% |
| 7 | Email verify | MyEmailVerifier | ~20% |
| G2 | Gate 2 | — | ~20% |
| 8 | Dedup + cooldown + reject_list | Postgres | variable |
| G3 | Gate 3 | — | ~15% (ICP C → nurture) |
| 9 | ICP scorer | Gemini Flash | — |
| 10 | Hook generation | Claude Sonnet 4.6 | — |
| 11 | Email body | Claude Haiku 4.5 | — |

Each stage is exposed as a reusable helper from `src/core/pipeline/` so the bulk-retry endpoint can re-run a single stage on demand.

### Daily Category Rotation
Mon D2C · Tue Real estate · Wed Funded startups · Thu Food · Fri Agencies · Sat Healthcare

---

## 5. Anti-Spam (Four Layers)

1. **DNS auth** — SPF, DKIM (`google._domainkey` CNAME), DMARC `p=none`
2. **Sending behavior** — `DAILY_SEND_LIMIT` cap, 3–7 min random delays, 9:30–17:30 IST, Mon–Sat, holidays blocked
3. **Content validator** — plain text only, 40–90 words, no URLs in step 0–1, `SPAM_WORDS` blocklist, regenerate once on fail
4. **Health monitoring** — bounce >2% → `DAILY_SEND_LIMIT=0`; unsub >1% 7d rolling → Telegram; weekly DNS blacklist check; manual mail-tester.com entry

---

## 6. API Layer

### `apps/api` — the new TypeScript service

- **Express + GraphQL Yoga + Pothos** — `/graphql` (queries, mutations, subscriptions over WS).
- **REST endpoints** kept for: `/auth/*` (OAuth + OTP), `/api/billing/*` (Razorpay portal + cancel), `/api/me`, `/webhooks/google`, `/webhooks/razorpay` (signed + idempotent via `RazorpayWebhookEvent` table).
- **Bull Board** at `/admin/queues` (gated by `requireSuperadmin`).
- **Auth** — Google OAuth (passport) + OTP fallback → JWT cookie; `/api/me` returns `{ user, org, plan, subscription }`.
- **Plan enforcement** — `enforcePlan` middleware blocks `locked` orgs from anything except `/settings/billing` (which the web's `<AuthGate>` handles by rendering the Paywall instead).
- **Rate limits** — per-org rate limit on lead operations; per-IP on OTP send and Google OAuth start.
- **Logs** — Pino structured JSON; `pino-http` per request.

**GraphQL coverage** — every dashboard read/write that maps cleanly onto a typed query is now served from `/graphql`. 22 resolver modules under `apps/api/src/graphql/resolvers/` cover: `me`, `orgs`, `admin` (superadmin), `config`, `niches`, `offer`, `icpProfile`, `sequences`, `savedViews`, `engineGuardrails`, `overview`, `funnel`, `sendLog`, `costs`, `errors`, `cronStatus`, `replies`, `engines`, `runEngine`, `health`, `bulkRetry` (estimate query + subscription), and the `leads` lookup queries (`leadFacets` etc.). 86 vitest cases under `apps/api/src/graphql/resolvers/__tests__/` exercise auth gates, tenant isolation, and the error-prone branches.

`apps/web/src/api.js` is the GraphQL adapter the legacy `.jsx` pages use — every method in there reshapes the camelCase GraphQL payload into the snake_case shape the legacy REST routes used to return, so the pages don't change.

### `src/api` — the legacy Express dashboard (REST holdouts only)

Still mounted at `:3001` (production) / `:3002` (dev), but only the REST holdouts the GraphQL adapter doesn't yet cover are reachable: lead list/detail/patch/status/signals (query-string parser still pending), `sendLog` (same), `runEngine` / `unlockEngine` / `engineStatus` (BullMQ enqueue semantics differ from the old polling contract), `exportLeadsCsv` (binary stream — stays REST permanently), and the bulk action endpoints (`bulkLeadStatus`, `bulkLeadRetryDryRun`). Removal of the now-unused routers (`config`, `niches`, `overview`, `funnel`, `sequences`, `cronStatus`, `health`, `costs`, `errors`, `offer`, `icpProfile`, `engines`, `engineGuardrails`, `savedViews`, `replies`) is the Phase 10 cleanup PR. `prisma/schema.prisma` is shared — schema migrations affect both servers.

---

## 7. Dashboard (`apps/web`)

React 18 + Vite SPA served by the legacy Express server from `apps/web/dist` (built via `npm run build:web`). Nginx reverse-proxies `radar.simpleinc.cloud` → `localhost:3001`.

**Design system — RADAR (light SaaS, emerald accent).** Tokens in [apps/web/src/index.css](apps/web/src/index.css), primitives in [apps/web/src/components/radar/](apps/web/src/components/radar/). Linear/Stripe energy: white cards, slate text, soft shadows, emerald-only accent. Sora display + JetBrains Mono.

**Pages:** Today · Engines · Leads (decision cockpit) · Sent Emails · Follow-ups · Replies · Funnel · Niches & Schedule · Offer & ICP · Email Voice · Spend · Email Health · Errors · Schedule & Logs · Settings (Billing, Team, Org, Profile) · Superadmin (Orgs, Org Detail, Users, Metrics).

**Auth screens:** Login (email + OTP, Google OAuth) · OTP verification · Welcome (3-card overview) · Onboarding (3-step wizard) · Paywall (when `subscription.status === 'locked'`).

**Auth flow:** `<AuthGate>` calls `GET /api/me` → on `401` redirects to `/login` → on `locked` org renders `<PaywallPage>` → otherwise renders the `<AppShell>` with sidebar + banners + outlet.

### Leads Decision Cockpit

The Lead Pipeline page is an operator console. URL state drives all filters so views are shareable.

- **KPI strip** — total / A·B·C distribution / ready-to-send / signals 7d / replies awaiting triage. Each tile shows `global · in-filter` when a filter is active.
- **Saved views** — chip row backed by the `saved_views` table.
- **Filters** — search, multi-status, ICP priority A·B·C, email status, category, city, country, signal type, business stage, employees, ICP score range, has-signals + min count, date ranges, in-reject-list toggle. Tech-stack and business-signals filtered via JSONB `?|` with `jsonb_typeof` guard.
- **Sort** — ICP score / quality / discovered / domain_last_contacted.
- **Bulk actions** (per-row checkbox + sticky bar):
  - `nurture` / `unsubscribed` / `reject` (writes to `reject_list`, absolute) / `requeue` (sets `status='ready'`; precondition: pending step-0 email row exists; ICP-C blocked).
  - `Retry ▾` runs one of six pipeline stages (`verify_email`, `regen_hook`, `regen_body`, `rescore_icp`, `reextract`, `rejudge`) with a dry-run cost preview. Capped at 25 leads/batch. Streamed via SSE. Gated by `BULK_RETRY_ENABLED=true`.
- **CSV export** — visible columns or all DB fields, streamed, escapes commas/quotes; auth via fetch+blob (not query-string token).

Backend: `src/api/routes/leads.js` + `src/api/routes/leads/{filterParser,bulkStatus,bulkRetry,csvExport}.js` and `src/api/routes/savedViews.js`. The bulk-retry handler imports stage helpers from `src/core/pipeline/` — also reused by the new `apps/api` BullMQ workers.

---

## 8. Environment Variables (.env)

```env
# ── OUTREACH IDENTITY ──────────────────────────────────────
OUTREACH_DOMAIN=trysimpleinc.com

# ── INBOXES (GWS app passwords — 2FA required) ─────────────
INBOX_1_USER=darshan@trysimpleinc.com
INBOX_1_PASS=xxxx xxxx xxxx xxxx
INBOX_2_USER=hello@trysimpleinc.com
INBOX_2_PASS=xxxx xxxx xxxx xxxx

# ── SMTP / IMAP ────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
IMAP_HOST=imap.gmail.com
IMAP_PORT=993

# ── SEND LIMITS ────────────────────────────────────────────
DAILY_SEND_LIMIT=0           # 34 after 4-week warmup
MAX_PER_INBOX=17
SEND_DELAY_MIN_MS=180000     # 3 minutes
SEND_DELAY_MAX_MS=420000     # 7 minutes
SEND_WINDOW_START_IST=9
SEND_WINDOW_END_IST=17

# ── AI MODELS ──────────────────────────────────────────────
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
ANTHROPIC_API_KEY=
MODEL_HOOK=claude-sonnet-4-20250514
MODEL_BODY=claude-haiku-4-5-20251001
MODEL_CLASSIFY=claude-haiku-4-5-20251001

# ── EMAIL VERIFICATION ─────────────────────────────────────
MEV_API_KEY=                 # MyEmailVerifier
MEV_COST_PER_CALL=0.0006     # fallback for bulk-retry cost preview

# ── ALERTS ─────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── SAFETY THRESHOLDS ──────────────────────────────────────
BOUNCE_RATE_HARD_STOP=0.02   # 2% — auto-pause sends
SPAM_RATE_HARD_STOP=0.001    # 0.1% — auto-pause sends
CLAUDE_DAILY_SPEND_CAP=3.00  # USD
MAX_EMAIL_WORDS=90
MIN_EMAIL_WORDS=40
DISABLE_OPEN_TRACKING=true
DISABLE_CLICK_TRACKING=true
HTML_EMAIL=false

SPAM_WORDS=free,guarantee,winner,prize,limited time,act now,click here,…

# ── DATABASE / QUEUE ───────────────────────────────────────
DATABASE_URL="postgresql://radar:CHANGE_ME@127.0.0.1:5432/radar?schema=public"
DATABASE_URL_TEST="postgresql://radar:CHANGE_ME@127.0.0.1:5432/radar_test?schema=public"
REDIS_URL=redis://localhost:6379

# ── DASHBOARD / API ────────────────────────────────────────
DASHBOARD_PORT=3001
DASHBOARD_URL=https://radar.simpleinc.cloud
DASHBOARD_PASSWORD=strong_password_here    # legacy single-tenant login
JWT_SECRET=64char_random_here
JWT_EXPIRES_IN=7d
VITE_API_URL=http://localhost:3001         # web → api in dev

# ── GOOGLE OAUTH (apps/api) ────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://radar.simpleinc.cloud/auth/google/callback

# ── RAZORPAY ───────────────────────────────────────────────
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# ── FEATURES ───────────────────────────────────────────────
BULK_RETRY_ENABLED=false     # Gates POST /api/leads/bulk/retry execution
SIGNALS_ENABLED=false        # Signal aggregator (Move #1)
SIGNALS_GLOBAL_TIMEOUT_MS=20000
SIGNALS_ADAPTERS_ENABLED=google_news,company_blog,indian_press,tech_stack,cert_transparency,pagespeed,careers_page,product_hunt,github,corp_filings
```

`BULK_RETRY_ENABLED` controls the bulk-retry execution endpoint. Dry-run cost previews always work; flip to `true` only after smoke-testing estimates, since each retry stage (`regen_hook`, `regen_body`, etc.) can spend real money on Claude/Gemini per call.

---

## 9. Non-Negotiable Rules

1. **Plain text only.** Never `html:` in nodemailer.
2. **No tracking pixels, opens, or clicks.**
3. **No links in cold step 0 or 1.**
4. **`contentValidator` runs before every send.**
5. **Bounce rate checked before each send.** >2% = immediate stop.
6. **Send window enforced** (9:30–17:30 IST, Mon–Sat).
7. **`cron_log` written at start AND end.** Status transitions running → success/failed.
8. **All errors → `error_log`.** Never swallow.
9. **Follow-ups use `inReplyTo` + `references` headers.**
10. **`reject_list` is absolute.** No code bypasses it.
11. **`DAILY_SEND_LIMIT=0` = hard stop.**
12. **All AI calls log model + cost** to `emails` and `daily_metrics`.
13. **From domain MUST be `trysimpleinc.com`.** Assert before send.
14. **simpleinc.in is never used for outreach.**
15. **ICP C → `status='nurture'`**, not discarded.
16. **Gemini grounding stays on free tier.** 150 queries/day << 1,500/day.
17. **Always use scoped Prisma in `apps/api` request handlers.** Never raw `prisma` — multi-tenant data leak risk.
18. **Razorpay webhooks are idempotent.** Insert into `razorpay_webhook_events` first, then process; on conflict skip.

---

## 10. Roadmap

### Phase 1 — Warmup + Pilot (Weeks 1–8, current)
1 domain, 2 inboxes, India targets. Ramp: 0 → 20 → 28 → 34/day.

### Phase 1.5 — Productization prep (in progress)
- ✅ SQLite → PostgreSQL via Prisma
- ✅ Multi-tenant schema (`Org` + `OrgMembership` + scoped Prisma)
- ✅ Razorpay subscriptions + webhook
- ✅ BullMQ worker scaffolding for engine cutover
- ✅ Trial / grace / locked / paywall flow
- ✅ RADAR design system pivot to light SaaS aesthetic
- ✅ Legacy REST → GraphQL migration (PR #16, Phases 1–9): 22 resolvers in `apps/api/src/graphql/resolvers/`, dashboard cutover via `apps/web/src/api.js` adapter, 86 vitest cases for the resolver suite
- 🔜 Phase 10 cleanup PR — delete the now-unused legacy routers in `src/api/routes/` plus their tests; trim `runEngine.js` and `leads.js` to just the holdouts
- 🔜 Move from VPS to personal server
- 🔜 Finish BullMQ migration for all engines (deprecate `src/scheduler`)
- 🔜 Sign-up flow + onboarding wizard wired into auth

### Phase 2 — Scale (Months 2–3)
2nd domain + 4 more inboxes → 68/day. Postmaster API once volume allows. US East Coast window 19:30–21:30 IST.

### Phase 3 — Multi-tenant SaaS (Months 4–6)
3 domains, 9 inboxes, 150/day. Productized as "done-for-you outbound setup" retainer. Plans: Trial / Starter ₹2,999 / Growth ₹6,999 / Agency ₹14,999.

---

## 11. Tech Stack

| Layer | Tool |
|---|---|
| Runtime | Node.js 20+ LTS, ES modules |
| Process manager | PM2 (`infra/ecosystem.config.cjs`) |
| Legacy scheduler | node-cron (`src/scheduler/cron.js`) |
| New queue | BullMQ + Redis 7 |
| ORM | Prisma 6 (Postgres 16) |
| GraphQL | Yoga + Pothos (code-first) |
| API | Express 4 (apps/api + legacy src/api) |
| SMTP | nodemailer |
| IMAP | imapflow |
| AI search/extract | @google/generative-ai (Gemini 2.5 Flash) |
| AI writing | @anthropic-ai/sdk (Sonnet 4.6 + Haiku 4.5) |
| Email verify | axios + MyEmailVerifier REST |
| Alerts | node-telegram-bot-api |
| Billing | Razorpay subscriptions + webhooks |
| Dashboard FE | React 18 + Vite + Tailwind + shadcn-ui + urql |
| Design system | RADAR — light SaaS, emerald accent (`apps/web/src/components/radar/`) |
| Auth | passport-google-oauth20 + OTP + bcrypt + jsonwebtoken |
| Logs | pino + pino-http |
| Tests | vitest |
| Web server | Nginx reverse-proxy |
| Backup | rclone → Backblaze B2 |

---

## 12. Local Dev Commands

```bash
# Install everything (workspace install)
npm install

# Start Postgres + Redis
docker compose -f infra/docker-compose.yml up -d

# Apply migrations
npx prisma migrate deploy
npx prisma generate

# Tests
npm test                                  # all workspaces
npm run test:api                          # apps/api
npm test --workspace=apps/web             # apps/web
npm test -- tests/engines                 # legacy engines

# Dev — new stack (apps/*)
npm run dev:api                           # apps/api  → :3001 (Yoga at /graphql)
npm run dev:web                           # apps/web  → :5173 (Vite, proxies /api → :3001)

# Dev — legacy single-tenant
node src/api/server.js                    # legacy Express dashboard on :3001
node src/engines/findLeads.js             # one-off engine run

# Build
npm run build                             # builds shared → api → web

# Production (VPS)
pm2 start infra/ecosystem.config.cjs      # radar-cron · radar-dashboard · radar-workers
pm2 logs radar-cron
pm2 logs radar-workers
pm2 logs radar-dashboard
```

---

## 13. Monthly Cost Reference

| Item | ₹/mo |
|---|---|
| AI/API (Claude + Gemini + MEV) | ~1,875 |
| Instantly Growth warmup | 3,100 |
| GWS 2 inboxes | 420 |
| trysimpleinc.com | 70 |
| VPS + Postgres | existing |
| **Total (single-tenant)** | **~5,465** |

ROI: 1 client @ ₹40,000 = 7.3× monthly system cost. Target SaaS unit economics: 80% gross margin per agency seat.
