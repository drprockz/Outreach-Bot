// PM2 ecosystem config — MUST be CommonJS (.cjs) because PM2 loads it via
// require() internally. The project's package.json has "type": "module",
// so a .js file here would be interpreted as ESM and PM2 would fail with
// "No script path - aborting" (it can't read import/export default).
//
// LEGACY processes (radar-cron, radar-dashboard) keep running the old single-tenant
// JS engines + Express server until cutover.
//
// NEW processes (radar-api-v2, radar-workers-v2) run the productized monorepo:
//   apps/api/dist/server.js     — TypeScript build of GraphQL + REST + WS
//   apps/api/dist/workers/index — BullMQ scheduler + worker runners
// Build first with: npm run build:api && npm run build:shared
//
// During cutover, either run both side-by-side on different ports, or
// stop legacy and start v2.

const { resolve } = require('path');

const root = resolve(__dirname, '..');

module.exports = {
  apps: [
    // ─── LEGACY (single-tenant) ────────────────────────────────────
    {
      name: 'radar-cron',
      script: resolve(root, 'src/scheduler/cron.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'radar-dashboard',
      script: resolve(root, 'src/api/server.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', PORT: 3001 }
    },

    // ─── PRODUCTIZED (multi-tenant SaaS — radar v2) ────────────────
    // Start with: pm2 start ecosystem.config.cjs --only radar-api-v2,radar-workers-v2
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
        DASHBOARD_PORT: 3002  // different port to avoid conflict with legacy radar-dashboard
      }
    },
    {
      name: 'radar-workers-v2',
      script: resolve(root, 'apps/api/dist/workers/index.js'),
      cwd: root,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' }
    }
  ]
};
