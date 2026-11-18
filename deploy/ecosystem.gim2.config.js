// PM2 process for GIM Companion 2.0 (runs as the `gim` user on its own server).
//   pm2 start deploy/ecosystem.gim2.config.js && pm2 save
module.exports = {
  apps: [{
    name: 'gim2',
    cwd: '/opt/gim2/server',
    script: 'index.js',
    // Node 22 or newer is required (the built-in SQLite module)
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      GIM_DATA_DIR: '/var/lib/gim2',       // the database and its backups
    },
    max_memory_restart: '600M',
    time: true,
  }],
};
