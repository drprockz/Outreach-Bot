export default {
  apps: [{
    name: 'outreach-agent',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
    log_file: './logs/app.log',
    error_file: './logs/error.log',
    time: true
  }]
};
