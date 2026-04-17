# SQLite → PostgreSQL + Prisma Migration — Design Spec

**Date:** 2026-04-17
**Status:** Draft

---

## Problem

Radar runs on `better-sqlite3` in WAL mode at `/home/radar/db/radar.sqlite`. For reliable personal use today and a multi-tenant product tomorrow, SQLite is the wrong foundation:

- File-copy backups can capture a half-flushed WAL, risking silent corruption on restore
- Single-writer serialization creates lock contention as the dashboard reads while `cron.js` writes
- No native type system — booleans are `INTEGER (0/1)`, JSON is `TEXT`, money is `REAL` (floating-point drift)
- Productizing later means a second, painful migration on top of any schema changes already shipped

Switching to PostgreSQL + Prisma now buys: transactionally consistent backups via `pg_dump`, concurrent readers/writers without lock contention, a proper type system (`jsonb`, `Decimal`, `Boolean`, `Timestamptz`), and a schema source-of-truth (`schema.prisma`) that migrations are generated from deterministically.

---

## Goal

Replace SQLite with self-hosted PostgreSQL 16 on the existing Ubuntu VPS, managed through Prisma ORM. Translate every existing table, preserve every column/index/default, and rewrite every query in the 6 engine scripts + dashboard Express API to use Prisma Client.

No data migration — the current SQLite database is pre-launch state and can be discarded.

---

## Scope

**In scope**

- Install and configure PostgreSQL 16 locally on the VPS (localhost-only)
- Create `prisma/schema.prisma` translating all 9 tables + indices + foreign keys
- Rewrite `utils/db.js` to export a `PrismaClient` singleton
- Rewrite every query in: `findLeads.js`, `sendEmails.js`, `sendFollowups.js`, `checkReplies.js`, `dailyReport.js`, `healthCheck.js`
- Rewrite every query in `dashboard/server.js` and any dashboard route files
- Replace `backup.sh` with a `pg_dump | rclone` pipeline to Backblaze B2
- Update `.env` / `.env.example`, `package.json`, and (if needed) `ecosystem.config.js`
- Local-first validation (Docker Postgres) before any VPS changes
- Documented rollback plan for the first 48h after cutover

**Out of scope**

- Data migration from the existing `db/radar.sqlite` (fresh start chosen)
- Multi-tenancy / `workspace_id` / Row-Level Security (deferred to productization)
- Kysely, Drizzle, or any alternate query layer
- Managed Postgres (Supabase / Neon / Railway) — stays self-hosted
- PostgreSQL WAL archiving / point-in-time recovery (future work)
- Postmaster API, GlockApps, or other Phase 2 roadmap items

---

## Architecture

| Component | Choice |
|---|---|
| Database engine | PostgreSQL 16 (apt package on Ubuntu 24) |
| Host | Existing VPS, localhost-only (`listen_addresses = 'localhost'`) |
| Role / DB | `radar` user, `radar` database |
| Connection | `DATABASE_URL=postgresql://radar:PASS@127.0.0.1:5432/radar` |
| ORM | Prisma (`@prisma/client` runtime, `prisma` CLI dev-dep) |
| Client pattern | Single `PrismaClient` singleton exported from `utils/db.js`, reused across both PM2 processes (`radar-cron`, `radar-dashboard`) |
| Migrations | `prisma migrate dev` locally, `prisma migrate deploy` on VPS |
| Backups | `pg_dump --format=custom --compress=9` streamed to B2 via `rclone rcat` |

**Postgres tuning** (in `postgresql.conf`, one-time):

```
shared_buffers = 256MB      # assumes ≥2GB RAM on VPS
max_connections = 20        # cron + dashboard = ~5 concurrent
work_mem = 16MB
# all other settings: defaults
```

---

## Schema Translation

Every existing table (`leads`, `emails`, `bounces`, `replies`, `reject_list`, `cron_log`, `daily_metrics`, `error_log`, `sequence_state`) is ported 1:1 with the following type mapping.

### Type Mapping

| SQLite | Prisma / Postgres |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `Int @id @default(autoincrement())` |
| `DATETIME DEFAULT CURRENT_TIMESTAMP` | `DateTime @default(now()) @db.Timestamptz(6)` |
| `INTEGER` used as boolean (0/1) | `Boolean` |
| `TEXT` holding JSON arrays (`tech_stack`, `website_problems`, `business_signals`, `blacklist_zones`) | `Json` (Postgres `jsonb`) |
| `TEXT` status/category columns (`leads.status`, `emails.status`, `replies.category`, `sequence_state.status`, etc.) | `String` — kept as strings, **not enums**, so new states can be added without migrations |
| `REAL` (general) | `Float` |
| `REAL` for monetary values (`gemini_cost_usd`, `hook_cost_usd`, `body_cost_usd`, `total_cost_usd`, `classification_cost_usd`, `sonnet_cost_usd`, `haiku_cost_usd`, `mev_cost_usd`, `total_api_cost_usd`, `total_api_cost_inr`, `cost_usd`) | `Decimal @db.Decimal(10, 6)` — avoids floating-point drift on accumulated AI spend |
| `TEXT` date (`daily_metrics.date` as `YYYY-MM-DD`) | `String` (kept as text for compatibility with existing aggregation logic) |
| `TEXT` (general) | `String` |
| `FOREIGN KEY REFERENCES` | Prisma `@relation` |
| `CREATE INDEX` | `@@index([...])` |
| `UNIQUE` (`daily_metrics.date`, `reject_list.email`, `sequence_state.lead_id`) | `@unique` |

### Preserved As-Is

- Every column name (snake_case on the DB side; Prisma `@map` for any rename mismatches)
- Every default value (e.g. `status DEFAULT 'discovered'`, `country DEFAULT 'IN'`)
- Every index listed in CLAUDE.md §4 ("INDICES")
- The full `status` lifecycle strings for both `leads` and `emails`
- The 5-step `sequence_state` semantics (step 0 → 4, +3/+7/+14/+90 day offsets)

---

## Files Changed

| File | Action |
|---|---|
| `prisma/schema.prisma` | **New** — all 9 tables translated |
| `prisma/migrations/<ts>_init/` | **New** — generated by `prisma migrate dev --name init` |
| `utils/db.js` | **Rewrite** — export `PrismaClient` singleton |
| `findLeads.js` | Rewrite all queries to Prisma Client, `async` throughout |
| `sendEmails.js` | Rewrite all queries, `async` throughout |
| `sendFollowups.js` | Rewrite all queries, `async` throughout |
| `checkReplies.js` | Rewrite all queries, `async` throughout |
| `dailyReport.js` | Rewrite all queries, `async` throughout |
| `healthCheck.js` | Rewrite all queries, `async` throughout |
| `dashboard/server.js` (+ any route modules) | Rewrite Express route queries |
| `backup.sh` | Replace SQLite file copy with `pg_dump \| rclone rcat ...` |
| `.env` / `.env.example` | Add `DATABASE_URL`; remove `DB_PATH` |
| `package.json` | Remove `better-sqlite3`; add `@prisma/client`, `prisma` (dev) |
| `ecosystem.config.js` | No code change (PrismaClient inherits env from `dotenv`) |
| `db/radar.sqlite` | **Deleted** after 48h of clean Postgres runs |

### Query Rewrite Pattern

Mechanical, file-by-file. Example:

```js
// Before (better-sqlite3, sync)
const leads = db.prepare('SELECT * FROM leads WHERE status = ?').all('ready');
db.prepare('UPDATE leads SET status = ? WHERE id = ?').run('sent', id);

// After (Prisma, async)
const leads = await prisma.lead.findMany({ where: { status: 'ready' } });
await prisma.lead.update({ where: { id }, data: { status: 'sent' } });
```

All engine files become `async` end-to-end. Cron wrappers in `cron.js` must `await` each job's top-level function.

---

## Backups + Reliability

### New `backup.sh`

```bash
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h 127.0.0.1 -U radar -d radar \
  --format=custom --compress=9 \
  | rclone rcat "b2:radar-backups/radar-${TS}.dump"
# Retention: 30 daily + 12 monthly (B2 lifecycle rule)
```

### Reliability Wins

1. **Transactionally consistent backups** — `pg_dump` snapshots at a single LSN; no half-flushed-WAL risk
2. **Concurrent readers + writers** — dashboard reads don't block cron writes or vice versa
3. **Battle-tested crash recovery** — Postgres WAL replay on unclean VPS shutdown is proven at far larger scale than SQLite WAL
4. **No silent type coercion** — `Boolean` is `Boolean`, `Decimal` doesn't drift, `jsonb` validates JSON

### Migration Workflow in Production

- **Local:** `prisma migrate dev --name <change>` → generates + applies migration
- **VPS:** `prisma migrate deploy` → applies pending migrations, no prompts, safe for PM2 deploys

---

## Testing + Cutover

### Phase 1 — Local Validation (before touching VPS)

1. `docker run -d --name radar-pg -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16`
2. `npx prisma migrate dev --name init` — generates migration, creates schema
3. Run `findLeads.js` with a 3-lead cap — confirms full pipeline writes correctly
4. Run `sendEmails.js` with `DAILY_SEND_LIMIT=0` (current default) — confirms reads work
5. Start dashboard locally — click every page, spot-check every card loads with zero rows and with seeded rows
6. Run `checkReplies.js` against a real inbox with 1 test reply — confirms IMAP → classify → write path

### Phase 2 — VPS Cutover (one evening, after 8:30 PM `dailyReport` run)

1. `pm2 stop radar-cron radar-dashboard`
2. Install Postgres 16 (`sudo apt install postgresql-16`)
3. Create role + DB + password; apply `postgresql.conf` tuning; `systemctl restart postgresql`
4. `git pull` the migration branch
5. `npm install` (adds `@prisma/client`, removes `better-sqlite3`)
6. `npx prisma generate` + `npx prisma migrate deploy`
7. Update `.env` with `DATABASE_URL` and `DB_PASSWORD`
8. `pm2 start ecosystem.config.js`
9. Tail logs for next morning's 9 AM `findLeads` — verify first job writes cleanly to Postgres

### Phase 3 — Cleanup (after 48h clean run)

- Delete `db/radar.sqlite`
- Remove `better-sqlite3` lockfile entries
- Remove `DB_PATH` from `.env.example`

### Rollback Plan

If Postgres misbehaves within 48h of cutover:

1. `pm2 stop radar-cron radar-dashboard`
2. `git checkout <pre-migration-tag>` (tagged before step 4 of Phase 2)
3. `npm install`
4. `pm2 start ecosystem.config.js`

`db/radar.sqlite` stays on disk until Phase 3 completes, so rollback is a clean restore to the last known-good state.

---

## Non-Goals Reminder

This migration does **not** change any of the 16 non-negotiable rules in CLAUDE.md §13. In particular: plain-text-only emails, `contentValidator` before every send, bounce-rate hard stop, send window enforcement, `reject_list` as absolute, and `DAILY_SEND_LIMIT=0` as a hard stop all remain untouched. The change is purely the data layer.
