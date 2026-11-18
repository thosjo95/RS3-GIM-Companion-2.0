/** DEV ONLY — shows the Group Ironman Journey achievements (category 5483) the plugin delivered. */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
const rows = db.prepare("SELECT a.name, a.sub_category sub FROM player_achievements a JOIN players p ON p.id = a.player_id WHERE p.rsn LIKE 'Degree%' AND a.category = 5483 ORDER BY a.name").all();
console.log(rows.length, 'completed journey achievements');
for (const r of rows) console.log(`  ${r.name}  [sub ${r.sub}]`);
process.exit(0);
