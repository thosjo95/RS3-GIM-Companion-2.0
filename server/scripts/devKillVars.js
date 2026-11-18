/** DEV ONLY — the game's raw kill tracker values the plugin delivered (bslay_*). */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
const rows = db.prepare("SELECT v.name, v.value, v.updated_at FROM player_kill_vars v JOIN players p ON p.id = v.player_id WHERE p.rsn LIKE 'Degree%' ORDER BY v.name").all();
console.log(rows.length, 'variables stored for Degree C; last update', rows.map(r => r.updated_at).sort().pop());
console.log(rows.map(r => `${r.name}=${r.value}`).join('\n'));
process.exit(0);
