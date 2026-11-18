/** DEV ONLY — prints the plugin's kill counts and drops per player (beta debugging). */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
console.log('kills', db.prepare('SELECT p.rsn, k.npc, k.kills, k.last_seen FROM plugin_npc_kills k JOIN players p ON p.id = k.player_id ORDER BY k.kills DESC').all());
console.log('drops', db.prepare("SELECT p.rsn, d.item_name, d.boss_name, d.quantity, d.value_gp, d.dropped_at FROM drops d JOIN players p ON p.id = d.player_id WHERE d.source = 'plugin' ORDER BY d.id DESC LIMIT 20").all());
process.exit(0);
