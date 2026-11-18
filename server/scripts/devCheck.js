/** DEV ONLY — prints what the plugin has delivered for each player (for debugging the beta test). */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
const players = db.prepare('SELECT id, rsn FROM players').all();
for (const p of players) {
  const live = db.prepare('SELECT updated_at, world, position_json, length(skills_json) skills, length(inventory_json) inv, length(equipment_json) worn, length(bank_json) bank FROM player_live_state WHERE player_id = ?').get(p.id);
  const tok = db.prepare('SELECT last_used_at, revoked FROM plugin_tokens WHERE player_id = ? ORDER BY id DESC LIMIT 1').get(p.id);
  const q = db.prepare('SELECT COUNT(*) c FROM player_quests WHERE player_id = ?').get(p.id).c;
  const kills = db.prepare('SELECT COALESCE(SUM(kills),0) c FROM plugin_npc_kills WHERE player_id = ?').get(p.id).c;
  const drops = db.prepare("SELECT COUNT(*) c FROM drops WHERE player_id = ? AND source = 'plugin'").get(p.id).c;
  console.log(JSON.stringify({ rsn: p.rsn, token: tok, live, quests: q, kills, drops }));
}
process.exit(0);
