// PM2 process for GIM Companion 2.0. Its own name, port and data folder, so it never touches the 1.x process or database.
//   pm2 start deploy/ecosystem.gim2.config.js && pm2 save
module.exports = {
  apps: [{
    name: 'gim2',
    cwd: '/opt/gim2/server',
    script: 'index.js',
    // Node 22 or newer is required (the built-in SQLite module)
    env: {
      NODE_ENV: 'production',
      PORT: 3002,                          // 1.x keeps its own port
      GIM_DATA_DIR: '/var/lib/gim2',       // 2.0 database (a separate file from 1.x)
    },
    max_memory_restart: '600M',
    time: true,
  }],
};
