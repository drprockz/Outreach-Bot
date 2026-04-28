// PM2 ecosystem config — MUST be CommonJS (.cjs) because PM2 loads it via
// require() internally. The project's package.json has "type": "module".
//
// ── DUPLICATE-RUN GUARD ────────────────────────────────────────────
// `radar-cron` (legacy node-cron) AND `radar-workers-v2` (BullMQ scheduler)
// schedule the SAME engines at the SAME times. Running both = double email
// sends + double Gemini quota burn. ONLY ONE may be running at a time.
//
// Default mode (recommended for production): only the v2 stack auto-starts.
// `radar-cron` is here as a fallback but flagged autorestart:false + script
// disabled by default. Re-enable manually if you need to roll back to legacy.
//
// `radar-dashboard` (legacy Express on :3001) is kept running because the
// legacy SPA still uses /api/leads, /api/replies, /api/overview, etc. — the
// new app only owns /api/me, /api/auth/*, /graphql, /api/billing/*. Nginx
// reverse-proxies /api/me, /api/auth, /graphql, /api/billing, /admin/queues,
// /auth/google to :3002 and everything else to :3001. See infra/nginx-radar.conf.
//
// Build before deploy: npm run build:shared && npm run build:api

const { resolve } = require('path');

const root = resolve(__dirname, '..');

module.exports = {
  apps: [
    // ─── PRODUCTIZED v2 (default) ──────────────────────────────────
    {
      name: 'radar-api-v2',
      script: resolve(root, 'apps/api/dist/server.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        DASHBOARD_PORT: 3002,
      },
    },
    {
      name: 'radar-workers-v2',
      // Owns BOTH the BullMQ workers AND the cron scheduler. Replaces radar-cron.
      script: resolve(root, 'apps/api/dist/workers/index.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' },
    },

    // ─── LEGACY DASHBOARD (kept running) ───────────────────────────
    // Serves the SPA + the 18 legacy REST routes the SPA still uses.
    // Will be retired once those routes are ported to apps/api/.
    {
      name: 'radar-dashboard',
      script: resolve(root, 'src/api/server.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', PORT: 3001 },
    },

    // ─── LEGACY CRON (DISABLED — DO NOT START) ─────────────────────
    // Kept in this config purely as a rollback option. If you need to run
    // it (e.g. v2 workers down for maintenance), `pm2 start radar-cron-legacy`
    // explicitly AND first `pm2 stop radar-workers-v2`.
    //
    // LEGACY_CRON_ENABLED=true is REQUIRED here. Without it, src/scheduler/cron.js
    // skips its schedule registrations (so importing the module from
    // radar-dashboard's startup path is safe and does NOT fire engines).
    {
      name: 'radar-cron-legacy',
      script: resolve(root, 'src/scheduler/cron.js'),
      cwd: root,
      instances: 1,
      autorestart: false, // explicit: never auto-start, never restart
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', LEGACY_CRON_ENABLED: 'true' },
    },
  ],
};
