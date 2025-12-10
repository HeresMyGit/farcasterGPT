module.exports = {
  apps: [{
    name: 'farcasterGPT',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    // Restart if app becomes unresponsive
    min_uptime: '10s',
    max_restarts: 10,
    // Health check - restart if no activity for too long
    restart_delay: 4000,
    // Log management
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
