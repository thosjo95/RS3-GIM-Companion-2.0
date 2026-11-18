/** DEV ONLY — summarises the quest data the plugin delivered (beta debugging). */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
console.log(db.prepare("SELECT p.rsn, q.state, COUNT(*) c, SUM(q.members) members, SUM(q.points) qp FROM player_quests q JOIN players p ON p.id = q.player_id GROUP BY p.rsn, q.state").all());
const rows = db.prepare("SELECT q.name, q.state, q.members, q.points FROM player_quests q JOIN players p ON p.id=q.player_id WHERE p.rsn LIKE 'Degree%' ORDER BY q.quest_id").all();
console.log('first 25:', rows.slice(0, 25).map(r => `${r.name}|${r.state}|${r.points}`).join(' ; '));
console.log('finished sample:', rows.filter(r => r.state === 'finished').slice(0, 25).map(r => `${r.name}(${r.points})`).join(' ; '));
console.log('not_started sample:', rows.filter(r => r.state === 'not_started').slice(200, 230).map(r => `${r.name}(${r.points})`).join(' ; '));
const dupes = db.prepare("SELECT name, COUNT(*) c FROM player_quests q JOIN players p ON p.id=q.player_id WHERE p.rsn LIKE 'Degree%' GROUP BY name HAVING c>1 LIMIT 10").all();
console.log('duplicate names:', dupes);
process.exit(0);
