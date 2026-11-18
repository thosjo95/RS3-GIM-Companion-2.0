/** DEV ONLY — shows the area task grid rows filled from the plugin for one player. */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
const p = db.prepare("SELECT id FROM players WHERE rsn LIKE 'Degree%'").get();
const rows = db.prepare("SELECT key, achieved, achieved_at, manual FROM achievements WHERE player_id = ? AND type = 'diary' ORDER BY key").all(p.id);
console.log(rows.length, 'area task rows:');
console.log(rows.map(r => `${r.key}${r.achieved ? '' : ' (not done)'}`).join('\n'));
console.log('\nset-task achievements the game reported:');
console.log(db.prepare("SELECT name FROM player_achievements WHERE player_id = ? AND name LIKE '% Set Tasks - %' ORDER BY name").all(p.id).map(r => r.name).join('\n'));
process.exit(0);
