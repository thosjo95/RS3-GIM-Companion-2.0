/**
 * Writes services/demoTemplate.json from one character that has plugin data in the dev database. Only GAME DEFINITIONS and a
 * sample backpack / gear / skill curve go in; the demo group's names, completion and numbers are made up from them.
 *   node server/scripts/exportDemoTemplate.js [player id]      (default: the newest player with plugin data)
 */
const fs = require('fs'), path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
const id = Number(process.argv[2]) || db.prepare('SELECT player_id FROM player_live_state WHERE equipment_json IS NOT NULL ORDER BY updated_at DESC LIMIT 1').get()?.player_id;
if (!id) { console.error('No player with plugin data.'); process.exit(1); }
const live = db.prepare('SELECT inventory_json, equipment_json FROM player_live_state WHERE player_id = ?').get(id);
const tpl = {
  skills: db.prepare('SELECT skill_name, level, xp FROM skills WHERE player_id = ?').all(id),
  inventory: JSON.parse(live.inventory_json || '[]'),
  equipment: JSON.parse(live.equipment_json || '[]'),
  quests: db.prepare('SELECT quest_id, name, members, points FROM player_quests WHERE player_id = ?').all(id),
  achievements: db.prepare('SELECT achievement_id, name, category, sub_category, members, rune_score, description, reward, tally_target FROM player_achievements WHERE player_id = ?').all(id),
  bosses: db.prepare('SELECT key, name, combat_req, is_group FROM player_boss_kills WHERE player_id = ?').all(id),
  killVars: db.prepare('SELECT name, value FROM player_kill_vars WHERE player_id = ?').all(id),
};
const out = path.join(__dirname, '..', 'services', 'demoTemplate.json');
fs.writeFileSync(out, JSON.stringify(tpl));
console.log(`Wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB): ${tpl.quests.length} quests, ${tpl.achievements.length} achievements, ${tpl.bosses.length} bosses.`);
