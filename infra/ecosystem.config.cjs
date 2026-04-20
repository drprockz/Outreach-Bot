// PM2 ecosystem config — MUST be CommonJS (.cjs) because PM2 loads it via
// require() internally. The project's package.json has "type": "module",
// so a .js file here would be interpreted as ESM and PM2 would fail with
// "No script path - aborting" (it can't read import/export default).
//
// The engine scripts themselves (src/scheduler/cron.js, src/api/server.js)
// stay as ESM — Node loads them normally when PM2 spawns them.

const { resolve } = require('path');

const root = resolve(__dirname, '..');

module.exports = {
  apps: [
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
    }
  ]
};
