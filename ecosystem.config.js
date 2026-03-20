export default {
  apps: [
    {
      name: 'radar-cron',
      script: './cron.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'radar-dashboard',
      script: './dashboard/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production', PORT: 3001 }
    }
  ]
};
