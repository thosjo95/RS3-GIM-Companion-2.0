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

const live = db.prepare(`INSERT INTO player_live_state (player_id, updated_at, world, position_json, inventory_json, equipment_json, bank_json, group_storage_json, group_storage_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
// The group's shared storage (same for everyone; the newest snapshot wins).
const GROUP_STORAGE = [ITEMS.whip(1), ITEMS.rune(3000), ITEMS.logs(900), ITEMS.shark(450), ITEMS.crystal(5), ITEMS.coins(2_500_000)];
const ledger = db.prepare(`INSERT INTO storage_ledger (player_id, store, item_id, item_name, delta, value_each, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const tokens = [];
players.forEach((p, i) => {
  const ago = [1, 4, 90][i] * 60_000;                           // minutes since last update: live, live, stale
  live.run(p.id, new Date(Date.now() - ago).toISOString(), [12, 12, 88][i], JSON.stringify({ x: 3200 + i * 7, y: 3200, z: 0 }),
    JSON.stringify(states[i].inventory), JSON.stringify(states[i].equipment), JSON.stringify(states[i].bank),
    i === 0 ? JSON.stringify(GROUP_STORAGE) : null, i === 0 ? new Date(Date.now() - ago).toISOString() : null);
  const token = 'gimp_' + crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO plugin_tokens (player_id, token_hash, last_used_at) VALUES (?, ?, ?)').run(p.id, crypto.createHash('sha256').update(token).digest('hex'), new Date(Date.now() - ago).toISOString());
  tokens.push({ rsn: p.rsn, token });
});
const moves = [[0, 'group', ITEMS.whip(1), -1, 20], [1, 'group', ITEMS.shark(200), 200, 55], [2, 'group', ITEMS.rune(1000), 1000, 130], [0, 'group', ITEMS.logs(500), 500, 240], [1, 'bank', ITEMS.coins(250_000), 250_000, 300]];
for (const [pi, store, it, delta, minsAgo] of moves) ledger.run(players[pi].id, store, it.id, it.name, delta, it.value, new Date(Date.now() - minsAgo * 60_000).toISOString());

// Quests (as the plugin reports them) and area tasks, with different progress per player.
const QUESTS = [["Cook's Assistant",1,0],['Demon Slayer',3,0],['Dragon Slayer',2,1],['Rune Mysteries',1,0],['Priest in Peril',1,1],['Ernest the Chicken',4,0],['Plague City',1,1],
  ['Fremennik Trials',3,1],['Desert Treasure',3,1],["Mourning's End Part I",2,1],['Recipe for Disaster',10,1],['While Guthix Sleeps',5,1],["Nomad's Requiem",3,1],['Missing My Mummy',2,1],['The Void Stares Back',1,1],['Fate of the Gods',2,1]];
const q = db.prepare('INSERT INTO player_quests (player_id, quest_id, name, state, members, points, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
players.forEach((p, pi) => QUESTS.forEach(([name, pts, members], qi) => {
  const done = qi < [14, 9, 5][pi], started = !done && qi < [15, 11, 8][pi];
  q.run(p.id, qi, name, done ? 'finished' : started ? 'started' : 'not_started', members, pts, new Date().toISOString());
}));
const DIARIES = ['diary_varrock','diary_falador','diary_karamja','diary_ardougne','diary_seers_village','diary_fremennik','diary_morytania','diary_desert'];
const TIERS = ['easy','medium','hard','elite'];
const ach = db.prepare("INSERT OR IGNORE INTO achievements (player_id, type, key, achieved, achieved_at) VALUES (?, 'diary', ?, 1, CURRENT_TIMESTAMP)");
players.forEach((p, pi) => DIARIES.forEach((d, di) => TIERS.forEach((t, ti) => { if (di * 4 + ti < [26, 17, 8][pi]) ach.run(p.id, d + '_' + t); })));

// Achievements the plugin reported (first few at the baseline = no completion time, the last ones were completed while playing).
const ACHS = [['Varrock Easy Tasks',5,1,0,1],['Varrock Medium Tasks',5,2,0,2],['Falador Easy Tasks',6,1,0,1],['Ardougne Hard Tasks',7,3,1,5],['Fremennik Easy Tasks',8,1,1,1],['Quest Cape',2,0,1,50],['Maxed Out',3,0,0,100],['Slayer Master',4,2,1,10]];
const pa = db.prepare('INSERT OR IGNORE INTO player_achievements (player_id, achievement_id, name, category, sub_category, members, rune_score, completed_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
players.forEach((p, pi) => ACHS.forEach(([name, cat, sub, members, score], ai) => {
  if (ai < [8, 5, 3][pi]) pa.run(p.id, 100 + ai, name, cat, sub, members, score, ai >= [6, 3, 2][pi] ? new Date(Date.now() - (ai + 1) * 3_600_000).toISOString() : null, new Date().toISOString());
}));

// Group Ironman journey (category 5483): tier achievements plus their steps; completed:false = not done yet.
const STEPS = { 0: ['Collect Ironman Armour', 'Cooks assistant', 'Total level'], 1: ['Restless ghost', 'The Provider of Misthalin', 'Total level'], 2: ['Priest in Peril', 'Slayer 10', 'Total level', 'Lumbridge Set Tasks - Easy'],
  3: ['Dragon Slayer', 'Total Quest Points', 'Total level', 'Wonderful Walls'], 4: ['King Black Dragon', 'One Small Favour', 'Total level'], 5: ['Desert Treasure', 'Kalphite Queen', 'Total level'] };
const jIns = db.prepare('INSERT OR IGNORE INTO player_achievements (player_id, achievement_id, name, category, sub_category, members, rune_score, completed_at, seen_at, completed, description, reward, tally_progress, tally_target) VALUES (?, ?, ?, 5483, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?)');
const DETAIL = { 'Total level': ['Reach the total level shown.', 'Ironman armour upgrade', 'level'], 'Total Quest Points': ['Earn the quest points shown.', 'Ironman armour upgrade', 'qp'] };
players.forEach((p, pi) => { let aid = 900; const upTo = [4, 2, 1][pi];
  Object.entries(STEPS).forEach(([tier, steps]) => { const t = Number(tier);
    jIns.run(p.id, aid++, 'Journey Tier ' + t, -1, new Date().toISOString(), t < upTo ? 1 : 0);
    steps.forEach((step, si) => { const done = t < upTo || (t === upTo && si < 2) ? 1 : 0; const d = DETAIL[step]; const target = d ? (d[2] === 'level' ? 1000 + t * 250 : 40 + t * 40) : null; const prog = d && !done ? Math.round(target * (0.55 + pi * 0.15)) : (d ? target : null);
      jIns.run(p.id, aid++, 'Journey Tier ' + t + ': ' + step, 5484 + t, new Date().toISOString(), done, d ? d[0] : (si === 0 ? 'Complete this once to progress the tier.' : null), d ? d[1] : null, prog, target); }); }); });

console.log(`Demo group "${NAME}" created (id ${gid}). Unlock it in the app with secret: ${SECRET}`);
console.log('Plugin tokens for the simulator:');
for (const t of tokens) console.log(`  ${t.rsn.padEnd(12)} ${t.token}`);
process.exit(0);
