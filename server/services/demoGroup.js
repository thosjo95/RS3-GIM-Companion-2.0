/**
 * The public demo group "Misthalin Five (Demo)": five made-up players with a fully stocked dashboard, readable by everyone
 * and never writable. Built from services/demoTemplate.json (game definitions only: quest, achievement and boss lists,
 * a sample backpack and gear; exported from a real character by scripts/exportDemoTemplate.js). Names and numbers are
 * made up. The group has is_demo = 1: see utils/auth.js (read-only), routes/plugin.js (no plugin join), the hiscores sync
 * and cleanup (skipped). A feeder (below) keeps it looking alive. Switched on by GIM_DEMO=1.
 */
const crypto = require('crypto');
const db = require('../database');
const { hashPassword } = require('../utils/auth');

const NAME = 'Misthalin Five (Demo)';
const MEMBERS = ['Varrock Vee', 'Lumby Lou', 'Draynor Dee', 'Fally Finn', 'Ardy Tilly'];
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const iso = msAgo => new Date(Date.now() - msAgo).toISOString();

/** (Re)creates the demo group from a template object. Replaces an existing demo group. Returns { gid, players }. */
function createDemoGroup(tpl) {
// a deterministic random generator, so every build gives the same picture
let seed = 20261118;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];

// ── the group ────────────────────────────────────────────────────────────────
const old = db.prepare('SELECT id FROM groups WHERE is_demo = 1').get();
if (old) {
  for (const { id } of db.prepare('SELECT id FROM players WHERE group_id = ?').all(old.id)) db.prepare('DELETE FROM players WHERE id = ?').run(id);
  for (const t of ['goals', 'group_competitions']) db.prepare(`DELETE FROM ${t} WHERE group_id = ?`).run(old.id);
  db.prepare('DELETE FROM groups WHERE id = ?').run(old.id);
}
// nobody knows this secret: the group cannot be claimed, joined by the plugin or written to (checkGroupAuth refuses non-reads)
const pw = hashPassword(crypto.randomBytes(24).toString('hex'));
const gid = Number(db.prepare("INSERT INTO groups (name, group_rsn, gim_type, gim_size, password_hash, password_salt, is_demo, last_activity, notes) VALUES (?, NULL, 'competitive', 5, ?, ?, 1, NULL, ?)")
  .run(NAME, pw.hash, pw.salt, 'A demo group with made-up players. Everything here is read-only.').lastInsertRowid);

// ── skills from the template's hiscores, scaled per member ───────────────────
const baseSkills = tpl.skills.filter(s => s.skill_name !== 'Overall');
const xpForLevel = l => { let p = 0; for (let i = 1; i < l; i++) p += Math.floor(i + 300 * 2 ** (i / 7)); return Math.floor(p / 4); };
const levelForXp = xp => { let l = 1; while (l < 120 && xpForLevel(l + 1) <= xp) l++; return l; };
const FACTORS = [1.6, 1.15, 0.9, 0.7, 0.45];

const players = MEMBERS.map((rsn, i) => {
  const id = Number(db.prepare('INSERT INTO players (rsn, group_id, last_synced) VALUES (?, ?, CURRENT_TIMESTAMP)').run(rsn, gid).lastInsertRowid);
  const skills = {};
  let total = 0, xpTotal = 0;
  for (const s of baseSkills) {
    const xp = Math.max(1200, Math.floor(s.xp * FACTORS[i] * (0.6 + rnd() * 0.8)));
    // the combat skills stop at 99 (except Necromancy); Invention has its own curve, so keep it modest
    const cap = ['Attack', 'Strength', 'Defence', 'Ranged', 'Magic', 'Prayer', 'Constitution', 'Summoning'].includes(s.skill_name) ? 99 : 120;
    const level = s.skill_name === 'Invention' ? Math.min(120, Math.max(1, Math.round(s.level * (0.7 + 0.3 * FACTORS[i] / 1.6)))) : Math.min(cap, levelForXp(xp));
    skills[s.skill_name] = { xp, level };
    total += Math.min(level, 99); xpTotal += xp;
  }
  const up = db.prepare('INSERT INTO skills (player_id, skill_name, level, xp, rank) VALUES (?, ?, ?, ?, ?)');
  up.run(id, 'Overall', total, xpTotal, 90_000 + Math.floor(rnd() * 400_000));
  for (const [name, s] of Object.entries(skills)) up.run(id, name, s.level, s.xp, 50_000 + Math.floor(rnd() * 500_000));
  const combat = Math.min(152, Math.floor(80 + FACTORS[i] * 40));
  const clues = { 'Clue Scrolls Easy': Math.floor(rnd() * 120), 'Clue Scrolls Medium': Math.floor(rnd() * 90), 'Clue Scrolls Hard': Math.floor(rnd() * 70 * FACTORS[i]),
    'Clue Scrolls Elite': Math.floor(rnd() * 25 * FACTORS[i]), 'Clue Scrolls Master': Math.floor(rnd() * 6 * FACTORS[i]), RuneScore: 3000 + Math.floor(rnd() * 9000) };
  db.prepare('UPDATE players SET combat_level = ?, stats_json = ?, rune_score = ? WHERE id = ?').run(combat, JSON.stringify({ activities: clues }), clues.RuneScore, id);
  return { id, rsn, skills, total, xpTotal, factor: FACTORS[i], clues };
});

// ── live state: backpack, gear, bank, group storage, money pouch; most are online ──
const it = (id, name, count, value, extra = {}) => ({ id, name, count, value, ...extra });
const BANK_POOL = [
  it(995, 'Coins', 0, 1), it(385, 'Shark', 0, 800), it(536, 'Dragon bones', 0, 2000), it(1513, 'Magic logs', 0, 1100), it(1515, 'Yew logs', 0, 350),
  it(451, 'Runite ore', 0, 11000), it(453, 'Coal', 0, 150), it(2363, 'Runite bar', 0, 12000), it(2361, 'Adamantite bar', 0, 2000), it(560, 'Death rune', 0, 200),
  it(565, 'Blood rune', 0, 400), it(566, 'Soul rune', 0, 300), it(561, 'Nature rune', 0, 180), it(563, 'Law rune', 0, 250), it(9075, 'Astral rune', 0, 160),
  it(2434, 'Prayer potion (4)', 0, 190), it(3024, 'Super restore (4)', 0, 300), it(6685, 'Saradomin brew (4)', 0, 1500), it(1631, 'Uncut dragonstone', 0, 9000),
  it(5295, 'Ranarr seed', 0, 3000), it(5300, 'Snapdragon seed', 0, 5000), it(5316, 'Magic seed', 0, 60000), it(207, 'Grimy ranarr', 0, 2500), it(8782, 'Mahogany plank', 0, 1500),
  it(1779, 'Flax', 0, 20), it(314, 'Feather', 0, 4), it(989, 'Crystal key', 0, 5000), it(18830, 'Frost dragon bones', 0, 6000), it(383, 'Raw shark', 0, 700),
];
const tplInv = tpl.inventory.map(x => ({ ...x, slot: undefined }));
const tplEq = tpl.equipment;
const soon = new Date(Date.now() + 15 * MIN).toISOString();           // "online" for the next quarter of an hour
players.forEach((p, i) => {
  const inv = [];
  const pool = [...tplInv.filter(x => !x.note_of), ...BANK_POOL.slice(1, 20)];
  for (let s = 0; s < 28; s++) {
    if (rnd() < 0.18) continue;                                          // a few empty slots
    const x = pick(pool);
    inv.push({ ...x, count: x.count > 1 || [560, 565, 566, 561, 563, 9075, 314, 453].includes(x.id) ? Math.floor(50 + rnd() * 3000) : 1, slot: s });
  }
  const bank = BANK_POOL.map(x => ({ ...x, count: x.id === 995 ? Math.floor(2e6 + rnd() * 6e7 * p.factor) : Math.floor(1 + rnd() * 2500 * p.factor) })).filter(() => rnd() > 0.15);
  const storage = i === 0 ? [it(385, 'Shark', 420, 800), it(6685, 'Saradomin brew (4)', 64, 1500), it(2434, 'Prayer potion (4)', 120, 190), it(560, 'Death rune', 8000, 200),
    it(565, 'Blood rune', 5200, 400), it(5316, 'Magic seed', 6, 60000), it(2363, 'Runite bar', 40, 12000), it(1631, 'Uncut dragonstone', 9, 9000), it(989, 'Crystal key', 5, 5000)] : null;
  db.prepare(`INSERT INTO player_live_state (player_id, updated_at, world, position_json, skills_json, inventory_json, equipment_json, bank_json, group_storage_json, group_storage_at, money_pouch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, i < 3 ? soon : iso(DAY * (i - 1)), 70 + i, JSON.stringify({ x: 3200, y: 3200, z: 0 }), JSON.stringify(p.skills),
    JSON.stringify(inv), JSON.stringify(tplEq), JSON.stringify(bank), storage ? JSON.stringify(storage) : null, storage ? iso(20 * MIN) : null,
    Math.floor(1e5 + rnd() * 9e7 * p.factor));
});

// ── quests, achievements and the Journey: the template's definitions, completion made up ──
const quests = tpl.quests;
const achs = tpl.achievements;
players.forEach(p => {
  const done = 0.35 + 0.45 * Math.min(1, p.factor / 1.6);
  const q = db.prepare('INSERT INTO player_quests (player_id, quest_id, name, state, members, points, updated_at, can_start) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const x of quests) { const r = rnd(); q.run(p.id, x.quest_id, x.name, r < done ? 'finished' : r < done + 0.04 ? 'started' : 'not_started', x.members, x.points, iso(DAY), 1); }
  const a = db.prepare(`INSERT INTO player_achievements (player_id, achievement_id, name, category, sub_category, members, rune_score, completed_at, seen_at, completed, description, reward, tally_progress, tally_target)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const journeyTier = Math.min(10, Math.floor(3 + p.factor * 4));
  for (const x of achs) {
    let completed;
    if (x.category === 5483) {
      const tier = Number((x.name.match(/Tier (\d+)/) || [])[1] ?? 0);
      completed = tier < journeyTier || (tier === journeyTier && rnd() < 0.5) ? 1 : 0;
    } else completed = rnd() < done * 0.6 ? 1 : 0;
    const prog = x.tally_target ? (completed ? x.tally_target : Math.floor(x.tally_target * rnd())) : null;
    a.run(p.id, x.achievement_id, x.name, x.category, x.sub_category, x.members, x.rune_score, completed ? iso(rnd() * 60 * DAY) : null, iso(DAY), completed, x.description, x.reward, prog, x.tally_target);
  }
});

// ── boss kills (game counters), slayer counters, the plugin's kill tally ─────
const bosses = tpl.bosses;
const kv = tpl.killVars;
players.forEach(p => {
  const up = db.prepare('INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at, combat_req, is_group) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const b of bosses) if (rnd() < 0.75) up.run(p.id, b.key, b.name, Math.floor(rnd() * 180 * p.factor) + 1, iso(HOUR), b.combat_req, b.is_group);
  const v = db.prepare('INSERT INTO player_kill_vars (player_id, name, value, updated_at) VALUES (?, ?, ?, ?)');
  for (const x of kv) v.run(p.id, x.name, Math.floor(x.value * p.factor * (0.5 + rnd())), iso(HOUR));
});

// ── activity feed (Adventurer's Log style) ───────────────────────────────────
const SKILL_NAMES = Object.keys(players[0].skills);
const BOSS_LINES = [['I killed 4 Hermods.', 'I killed 4 Hermods, Spirits of War: phantoms born from the God Wars.'], ['I killed 2 Kree\'arras.', 'I killed 2 graceful followers of Armadyl.'],
  ['I defeated the Queen Black Dragon 3 times.', 'I defeated the Queen Black Dragon 3 times, returning her to a temporary slumber.'], ['I killed 6 Giant Moles.', 'I killed 6 Giant Moles.']];
const QUESTS_DONE = ['Troll Stronghold', 'Lunar Diplomacy', 'Desert Treasure', 'Dream Mentor', 'The Fremennik Isles', 'Recipe for Disaster: Freeing King Awowogei'];
const act = db.prepare('INSERT INTO player_activities (player_id, date_str, ts, text, details, saved_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
const fmtRm = d => `${String(d.getUTCDate()).padStart(2, '0')}-${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
players.forEach(p => {
  const feed = [];
  for (let k = 0; k < 14; k++) {
    const when = new Date(Date.now() - rnd() * 3 * DAY);
    const r = rnd();
    let text, details;
    if (r < 0.45) { const s = pick(SKILL_NAMES); text = `Levelled up ${s}.`; details = `I levelled my ${s} skill, I am now level ${Math.min(99, p.skills[s].level)}.`; }
    else if (r < 0.75) [text, details] = pick(BOSS_LINES);
    else if (r < 0.88) { const q = pick(QUESTS_DONE); text = `Quest complete: ${q}`; details = `I have completed the quest ${q}.`; }
    else [text, details] = pick(BOSS_LINES);
    act.run(p.id, fmtRm(when), when.toISOString(), text, details);
    feed.push({ when, date: fmtRm(when), text, details });
  }
  // the overview's feed reads the saved Adventurer's Log list on the player, newest first
  feed.sort((a, b) => b.when - a.when);
  db.prepare('UPDATE players SET activities_json = ? WHERE id = ?').run(JSON.stringify(feed.map(({ date, text, details }) => ({ date, text, details }))), p.id);
});

// ── drops, the Bank Journal, goals, competitions ─────────────────────────────
const DROPS = [['Armadyl helmet', "Kree'arra", 1, 2_100_000], ['Bandos chestplate', 'General Graardor', 1, 9_800_000], ['Dragon pickaxe', 'Chaos Elemental', 1, 1_000_000],
  ['Hermodic plate', 'Hermod, the Spirit of War', 1, 3_200_000], ['Dragon kiteshield', 'Queen Black Dragon', 1, 1_500_000], ['Ranarr seed', 'Giant Mole', 12, 3000], ['Onyx', 'Kalphite Queen', 1, 2_900_000]];
DROPS.forEach(([item, boss, qty, val], k) => db.prepare("INSERT INTO drops (player_id, item_name, boss_name, quantity, value_gp, notes, dropped_at, source, sig) VALUES (?, ?, ?, ?, ?, 'Detected by the plugin', ?, 'plugin', ?)")
  .run(players[k % players.length].id, item, boss, qty, val, iso(rnd() * 5 * DAY), `show-${k}`));
const led = db.prepare("INSERT INTO storage_ledger (player_id, store, item_id, item_name, delta, value_each, occurred_at) VALUES (?, 'group', ?, ?, ?, ?, ?)");
[[0, 385, 'Shark', 200, 800], [1, 2434, 'Prayer potion (4)', -20, 190], [2, 560, 'Death rune', 3000, 200], [3, 6685, 'Saradomin brew (4)', -12, 1500], [1, 5316, 'Magic seed', 6, 60000], [4, 989, 'Crystal key', 5, 5000], [0, 2363, 'Runite bar', -10, 12000]]
  .forEach(([pi, id, name, d, v], k) => led.run(players[pi].id, id, name, d, v, iso((k + 1) * 3 * HOUR)));
const goal = db.prepare('INSERT INTO goals (type, owner_id, group_id, title, category, skill, target_value, current_value, priority, status, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
goal.run('personal', players[0].id, gid, '99 Necromancy', 'skill', 'Necromancy', 99, players[0].skills.Necromancy?.level ?? 80, 'high', 'in_progress', null);
goal.run('personal', players[1].id, gid, '120 Slayer', 'skill', 'Slayer', 120, players[1].skills.Slayer?.level ?? 90, 'medium', 'in_progress', null);
goal.run('group', null, gid, 'Finish Journey tier 7 together', 'other', null, null, null, 'high', 'in_progress', null);
goal.run('personal', players[2].id, gid, 'Quest: Desert Treasure', 'quest', null, null, null, 'medium', 'not_started', JSON.stringify({ questName: 'Desert Treasure' }));
const mon = new Date(); mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7)); mon.setUTCHours(0, 0, 0, 0);
db.prepare('INSERT INTO group_competitions (group_id, title, metric, target, starts_at, ends_at, goal) VALUES (?, ?, ?, ?, ?, ?, ?)').run(gid, 'Most XP this week', 'xp', 'Overall', mon.toISOString(), new Date(mon.getTime() + 7 * DAY).toISOString(), null);
db.prepare('INSERT INTO group_competitions (group_id, title, metric, target, starts_at, ends_at, goal) VALUES (?, ?, ?, ?, ?, ?, ?)').run(gid, 'First to 25 hard clues', 'clues', 'hard', iso(5 * DAY), null, 25);

// ── leaderboard gains: an older snapshot with lower numbers ──────────────────
const { collect } = require('./metrics');
players.forEach(p => {
  const now = collect(p.id);
  const before = JSON.parse(JSON.stringify(now));
  for (const k of Object.keys(before.xp)) before.xp[k] = Math.max(0, Math.floor(before.xp[k] * (0.985 - rnd() * 0.02)));
  if (before.boss?._total != null) { for (const k of Object.keys(before.boss)) before.boss[k] = Math.max(0, before.boss[k] - Math.floor(rnd() * 12)); }
  if (before.qp != null) before.qp = Math.max(0, before.qp - Math.floor(rnd() * 15));
  if (before.slayer != null) before.slayer = Math.max(0, before.slayer - Math.floor(rnd() * 400));
  if (before.level != null) before.level -= Math.floor(rnd() * 8);
  if (before.clues) for (const k of Object.keys(before.clues)) before.clues[k] = Math.max(0, before.clues[k] - Math.floor(rnd() * 5));
  db.prepare('INSERT INTO metric_snapshots (player_id, taken_at, data_json) VALUES (?, ?, ?)').run(p.id, iso(6 * DAY), JSON.stringify(before));
  db.prepare('INSERT INTO metric_snapshots (player_id, taken_at, data_json) VALUES (?, ?, ?)').run(p.id, iso(10 * MIN), JSON.stringify(now));
});

// ── live XP drops in the last hour, the boss log and the clue log ────────────
// rows are stored oldest first, like real ones (lists are shown newest first by id)
const xpRows = [], logRows = [];
players.slice(0, 3).forEach((p, i) => {
  const focus = [['Necromancy', 'Prayer', 'Constitution'], ['Slayer', 'Ranged', 'Constitution'], ['Mining', 'Smithing']][i];
  for (let k = 0; k < 40; k++) xpRows.push([p.id, pick(focus), Math.floor(200 + rnd() * 2500), k * 75_000 + rnd() * 30_000]);
  const pb = db.prepare('SELECT key, name, kills FROM player_boss_kills WHERE player_id = ? ORDER BY kills DESC LIMIT 3').all(p.id);
  pb.forEach((b, j) => { for (let k = 0; k < 3; k++) logRows.push([p.id, 'boss', b.key, b.name, 1 + Math.floor(rnd() * 3), b.kills - k * 2, (j * 3 + k) * 40 * MIN + rnd() * 10 * MIN]); });
});
players.forEach((p, i) => ['hard', 'elite', 'medium'].forEach((tier, j) => {
  const total = p.clues[`Clue Scrolls ${tier[0].toUpperCase() + tier.slice(1)}`];
  if (total > 1 && rnd() < 0.7) logRows.push([p.id, 'clue', tier, tier, 1 + Math.floor(rnd() * 2), total, (i * 3 + j) * 2 * HOUR + rnd() * HOUR]);
}));
const xpd = db.prepare('INSERT INTO xp_drops (player_id, skill, xp, at) VALUES (?, ?, ?, ?)');
xpRows.sort((a, b) => b[3] - a[3]).forEach(([pid, skill, xp, ago]) => xpd.run(pid, skill, xp, iso(ago)));
const plog = db.prepare('INSERT INTO progress_log (player_id, kind, key, name, gain, total, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
logRows.sort((a, b) => b[6] - a[6]).forEach(r => plog.run(...r.slice(0, 6), iso(r[6])));


// area tasks are worked out from the completed achievements (as the server does after a plugin update)
const areaTasks = require('./pluginSync').backfillAreaTasks();
return { gid, players: players.map(p => p.id), areaTasks };
}

// ── the feeder: every ~30 s something happens, so the page looks like a group that is playing ──────────────────────
// Three members are online all the time, the other two come and go through the hour. Online players get XP drops, now and
// then a new backpack, a boss kill (with its log line, activity line and sometimes a drop) or a clue.
const FOCUS = [['Necromancy', 'Prayer', 'Constitution'], ['Slayer', 'Ranged', 'Constitution'], ['Mining', 'Smithing'], ['Herblore', 'Farming'], ['Fishing', 'Cooking']];
const KILL_DROPS = [['Armadyl helmet', 2_100_000], ['Dragon kiteshield', 1_500_000], ['Hermodic plate', 3_200_000], ['Onyx', 2_900_000], ['Ranarr seed', 3000], ['Dragon pickaxe', 1_000_000]];
const rndInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
const fmtRm = d => `${String(d.getUTCDate()).padStart(2, '0')}-${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

function demoPlayers() {
  return db.prepare('SELECT p.id, p.rsn FROM players p JOIN groups g ON g.id = p.group_id WHERE g.is_demo = 1 ORDER BY p.id').all();
}

function addActivity(player, text, details) {
  const now = new Date();
  const ins = db.prepare('INSERT OR IGNORE INTO player_activities (player_id, date_str, ts, text, details, saved_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(player.id, fmtRm(now), now.toISOString(), text, details);
  if (!ins.changes) return;                                       // the same line in the same minute already exists
  const row = db.prepare('SELECT activities_json FROM players WHERE id = ?').get(player.id);
  let list = []; try { list = JSON.parse(row?.activities_json || '[]'); } catch { /* start over */ }
  list.unshift({ date: fmtRm(now), text, details });
  db.prepare('UPDATE players SET activities_json = ? WHERE id = ?').run(JSON.stringify(list.slice(0, 40)), player.id);
}

/** One beat of life. Exported so the tests can run it. */
function feedOnce(now = new Date()) {
  const players = demoPlayers();
  const min = now.getUTCMinutes();
  players.forEach((p, i) => {
    const online = i < 3 || (i === 3 ? min < 40 : min >= 20);     // the last two come and go
    const state = db.prepare('SELECT skills_json, inventory_json FROM player_live_state WHERE player_id = ?').get(p.id);
    if (!state) return;
    if (!online) return;                                           // not touched: "last seen" just ages

    const at = now.toISOString();
    let skills = {}; try { skills = JSON.parse(state.skills_json || '{}'); } catch { /* empty */ }
    let inv = [];    try { inv = JSON.parse(state.inventory_json || '[]'); } catch { /* empty */ }

    // XP drops: most beats
    if (Math.random() < 0.7) {
      const skill = pickOne(FOCUS[i]);
      const xp = rndInt(150, 2600);
      db.prepare('INSERT INTO xp_drops (player_id, skill, xp, at) VALUES (?, ?, ?, ?)').run(p.id, skill, xp, at);
      if (skills[skill]) skills[skill].xp += xp;
      db.prepare('UPDATE skills SET xp = xp + ? WHERE player_id = ? AND skill_name IN (?, \'Overall\')').run(xp, p.id, skill);
    }
    // backpack: now and then a slot changes
    if (Math.random() < 0.15 && inv.length) {
      const k = Math.floor(Math.random() * inv.length);
      const donor = pickOne(inv);
      inv[k] = { ...donor, slot: inv[k].slot, count: donor.count > 1 ? rndInt(20, 3000) : 1 };
    }
    db.prepare('UPDATE player_live_state SET updated_at = ?, skills_json = ?, inventory_json = ?, world = ? WHERE player_id = ?').run(at, JSON.stringify(skills), JSON.stringify(inv), 70 + i, p.id);

    // a boss kill
    if (Math.random() < 0.03) {
      const b = db.prepare('SELECT key, name, kills FROM player_boss_kills WHERE player_id = ? ORDER BY RANDOM() LIMIT 1').get(p.id);
      if (b) {
        const total = b.kills + 1;
        db.prepare('UPDATE player_boss_kills SET kills = ?, updated_at = ? WHERE player_id = ? AND key = ?').run(total, at, p.id, b.key);
        db.prepare("INSERT INTO progress_log (player_id, kind, key, name, gain, total, at) VALUES (?, 'boss', ?, ?, 1, ?, ?)").run(p.id, b.key, b.name, total, at);
        addActivity(p, `I killed ${b.name}.`, `I killed ${b.name}.`);
        if (Math.random() < 0.08) {
          const [item, val] = pickOne(KILL_DROPS);
          db.prepare("INSERT INTO drops (player_id, item_name, boss_name, quantity, value_gp, notes, dropped_at, source, sig) VALUES (?, ?, ?, 1, ?, 'Detected by the plugin', ?, 'plugin', ?)")
            .run(p.id, item, b.name, val, at, `demo-${p.id}-${now.getTime()}`);
        }
      }
    }
    // a clue scroll
    if (Math.random() < 0.025) {
      const tier = pickOne(['medium', 'hard', 'elite']);
      db.prepare("INSERT INTO progress_log (player_id, kind, key, name, gain, total, at) VALUES (?, 'clue', ?, ?, 1, ?, ?)").run(p.id, tier, tier, rndInt(5, 80), at);
      addActivity(p, `I completed a ${tier} clue scroll.`, `I completed a ${tier} clue scroll.`);
    }
  });
  // live XP drops are only shown for a day; keep the demo's table small
  db.prepare("DELETE FROM xp_drops WHERE player_id IN (SELECT p.id FROM players p JOIN groups g ON g.id = p.group_id WHERE g.is_demo = 1) AND at < ?").run(new Date(now.getTime() - 6 * HOUR).toISOString());
}

/** Starts the demo on a server: builds the group if it is missing, then feeds it every 30 seconds. */
function start() {
  try {
    if (!db.prepare('SELECT 1 FROM groups WHERE is_demo = 1').get()) {
      const r = createDemoGroup(require('./demoTemplate.json'));
      console.log(`[demo] built "${NAME}" (group ${r.gid})`);
    }
  } catch (e) { console.error('[demo] could not build the demo group:', e.message); return; }
  const timer = setInterval(() => { try { feedOnce(); } catch (e) { console.error('[demo] feeder:', e.message); } }, 30_000);
  timer.unref?.();
  console.log('[demo] feeder running (every 30 s)');
}

module.exports = { createDemoGroup, feedOnce, start, NAME, MEMBERS };
