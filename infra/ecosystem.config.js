import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

export default {
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
