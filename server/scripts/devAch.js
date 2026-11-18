/** DEV ONLY — what achievements the plugin has delivered (beta debugging). */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
console.log(db.prepare("SELECT p.rsn, COUNT(*) n, SUM(a.completed_at IS NOT NULL) fresh FROM player_achievements a JOIN players p ON p.id = a.player_id GROUP BY p.rsn").all());
console.log('last live update:', db.prepare("SELECT p.rsn, s.updated_at FROM player_live_state s JOIN players p ON p.id = s.player_id WHERE p.rsn LIKE 'Degree%'").all());
process.exit(0);
