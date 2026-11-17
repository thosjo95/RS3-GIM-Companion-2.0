/**
 * DEV ONLY — creates a demo group with fake players, plugin tokens, live items and a bank ledger,
 * so the Items tab can be explored locally without the game.
 *
 *   node server/scripts/devDemo.js
 *
 * Safe to re-run (replaces the demo group). Refuses to run when NODE_ENV=production.
 */
if (process.env.NODE_ENV === 'production') { console.error('Refusing to run in production.'); process.exit(1); }

const path = require('path');
process.chdir(path.join(__dirname, '..'));
const crypto = require('crypto');
const db = require('../database');
const { hashPassword } = require('../utils/auth');

const NAME = 'GIM 2.0 Demo';
const SECRET = 'DEMO-DEMO-DEMO';           // local dev database only

const old = db.prepare('SELECT id FROM groups WHERE name = ?').get(NAME);
if (old) { db.prepare('DELETE FROM players WHERE group_id = ?').run(old.id); db.prepare('DELETE FROM groups WHERE id = ?').run(old.id); }

const pw = hashPassword(SECRET);
const gid = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, password_hash, password_salt, last_activity) VALUES (?, 'custom', 3, ?, ?, CURRENT_TIMESTAMP)").run(NAME, pw.hash, pw.salt).lastInsertRowid);

const players = ['Demo Mayo', 'Demo Nuggz', 'Demo Vex'].map(rsn => ({
  rsn, id: Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run(rsn, gid).lastInsertRowid),
}));

const item = (id, name, count, value) => ({ id, name, count, value });
const ITEMS = {
  coins: (n) => item(995, 'Coins', n, 1), whip: (n) => item(4151, 'Abyssal whip', n, 120000),
  shark: (n) => item(385, 'Shark', n, 800), rune: (n) => item(560, 'Death rune', n, 200),
  brew: (n) => item(6685, 'Saradomin brew (4)', n, 1500), pick: (n) => item(11920, 'Dragon pickaxe', n, 1_000_000),
  logs: (n) => item(1513, 'Magic logs', n, 1100), ore: (n) => item(449, 'Adamantite ore', n, 1400),
  amulet: (n) => item(1712, 'Amulet of glory (4)', n, 25000), crystal: (n) => item(23951, 'Crystal key', n, 5000),
};
const states = [
  { inventory: [ITEMS.shark(12), ITEMS.brew(4), ITEMS.coins(25_000)], equipment: [ITEMS.whip(1), ITEMS.amulet(1)], bank: [ITEMS.coins(8_400_000), ITEMS.rune(4500), ITEMS.logs(2200), ITEMS.shark(300)] },
  { inventory: [ITEMS.pick(1), ITEMS.shark(5)], equipment: [], bank: [ITEMS.coins(1_250_000), ITEMS.ore(840), ITEMS.crystal(3), ITEMS.brew(22)] },
  { inventory: [ITEMS.rune(200)], equipment: [ITEMS.amulet(1)], bank: [ITEMS.coins(95_000), ITEMS.logs(150), ITEMS.whip(1)] },
];

const live = db.prepare(`INSERT INTO player_live_state (player_id, updated_at, world, position_json, inventory_json, equipment_json, bank_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const ledger = db.prepare(`INSERT INTO storage_ledger (player_id, store, item_id, item_name, delta, value_each, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const tokens = [];
players.forEach((p, i) => {
  const ago = [1, 4, 90][i] * 60_000;                           // minutes since last update: live, live, stale
  live.run(p.id, new Date(Date.now() - ago).toISOString(), [12, 12, 88][i], JSON.stringify({ x: 3200 + i * 7, y: 3200, z: 0 }),
    JSON.stringify(states[i].inventory), JSON.stringify(states[i].equipment), JSON.stringify(states[i].bank));
  const token = 'gimp_' + crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO plugin_tokens (player_id, token_hash, last_used_at) VALUES (?, ?, ?)').run(p.id, crypto.createHash('sha256').update(token).digest('hex'), new Date(Date.now() - ago).toISOString());
  tokens.push({ rsn: p.rsn, token });
});
const moves = [[0, 'group', ITEMS.whip(1), -1, 20], [1, 'group', ITEMS.shark(200), 200, 55], [2, 'group', ITEMS.rune(1000), 1000, 130], [0, 'group', ITEMS.logs(500), 500, 240], [1, 'bank', ITEMS.coins(250_000), 250_000, 300]];
for (const [pi, store, it, delta, minsAgo] of moves) ledger.run(players[pi].id, store, it.id, it.name, delta, it.value, new Date(Date.now() - minsAgo * 60_000).toISOString());

console.log(`Demo group "${NAME}" created (id ${gid}). Unlock it in the app with secret: ${SECRET}`);
console.log('Plugin tokens for the simulator:');
for (const t of tokens) console.log(`  ${t.rsn.padEnd(12)} ${t.token}`);
process.exit(0);
