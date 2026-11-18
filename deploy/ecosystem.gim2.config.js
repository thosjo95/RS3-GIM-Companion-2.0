// PM2 process for GIM Companion 2.0 (runs as the `gim` user on its own server).
//   pm2 start deploy/ecosystem.gim2.config.js && pm2 save
let extra = {};
try { extra = JSON.parse(require('fs').readFileSync('/var/lib/gim2/extra-env.json', 'utf8')); } catch { /* none set */ }

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
      // Per-server switches live in /var/lib/gim2/extra-env.json so a deploy never overwrites them, for example
      // {"GIM_PREVIEW":"1","GIM_PREVIEW_COPIED":"18 November 2026"}   (beta: shows the Preview banner)
      // beta: add "GIM_DEMO":"1" for the live demo group "Misthalin Five (Demo)" (built and fed by the server itself)
      // and on launch day add "GIM_PLUGIN_LIVE":"1" (removes the \"waiting for Jagex's approval\" note).
      ...extra,
    },
    max_memory_restart: '600M',
    time: true,
  }],
};
