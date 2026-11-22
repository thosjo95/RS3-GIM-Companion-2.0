// The Global Leaderboard: public data with names, plugin data only as anonymous totals, no demo, unlisted never named.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.GIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-global-'));
const db = require('../database');
const { _build } = require('../services/globalStats');

const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const iso = n => new Date(Date.now() - n * 86400000).toISOString();

function group(name, extra = {}) {
  const id = Number(db.prepare('INSERT INTO groups (name, gim_type, gim_size) VALUES (?, ?, 2)').run(name, extra.type ?? 'regular').lastInsertRowid);
  if (extra.unlisted) db.prepare('UPDATE groups SET settings_json = ? WHERE id = ?').run(JSON.stringify({ unlisted: true }), id);
  if (extra.demo) db.prepare('UPDATE groups SET is_demo = 1 WHERE id = ?').run(id);
  return id;
}
function player(gid, rsn, xpNow, xpWeekAgo) {
  const id = Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run(rsn, gid).lastInsertRowid);
  db.prepare("INSERT INTO skills (player_id, skill_name, level, xp) VALUES (?, 'Overall', 2000, ?)").run(id, xpNow);
  db.prepare("INSERT INTO skills (player_id, skill_name, level, xp) VALUES (?, 'Mining', 99, ?)").run(id, 13_000_000 + (xpNow - xpWeekAgo));
  db.prepare('INSERT INTO snapshots (player_id, snapshot_date, total_xp, skills_json) VALUES (?, ?, ?, ?)')
    .run(id, day(8), xpWeekAgo, JSON.stringify({ Mining: { xp: 13_000_000 } }));
  db.prepare('INSERT INTO snapshots (player_id, snapshot_date, total_xp) VALUES (?, ?, ?)').run(id, day(0), xpNow);
  return id;
}

let s;
test.before(() => {
  const a = group('Public Pals');
  const pa = player(a, 'Pal One', 500_000_000, 400_000_000);
  const u = group('Hidden Heroes', { unlisted: true });
  const pu = player(u, 'Secret Sam', 900_000_000, 600_000_000);
  const d = group('Misthalin Five (Demo)', { demo: true });
  player(d, 'Demo Dan', 999_000_000, 100_000_000);
  // a public 99 for both; a plugin drop and boss kills for the public player
  db.prepare("INSERT INTO player_skill_milestones (player_id, skill, level, achieved_at) VALUES (?, 'Mining', 99, ?)").run(pa, iso(1));
  db.prepare("INSERT INTO player_skill_milestones (player_id, skill, level, achieved_at) VALUES (?, 'Mining', 99, ?)").run(pu, iso(1));
  db.prepare("INSERT INTO drops (player_id, item_name, value_gp, quantity, notes, dropped_at, source) VALUES (?, 'Very Private Visor', 5000000, 1, 'Detected by the plugin', ?, 'plugin')").run(pa, iso(1));
  db.prepare("INSERT INTO progress_log (player_id, kind, key, name, gain, total, at) VALUES (?, 'boss', 'nex', 'Nex', 7, 50, ?)").run(pa, iso(1));
  db.prepare("INSERT INTO player_live_state (player_id, updated_at) VALUES (?, ?)").run(pa, new Date().toISOString());
  s = _build();
});

test('the demo group is left out completely', () => {
  assert.equal(s.totals.groups, 2);
  assert.equal(s.totals.players, 2);
  assert.ok(!JSON.stringify(s).includes('Demo'));
});

test('unlisted groups count in the totals but are never named', () => {
  assert.equal(s.totals.weekXp, 100_000_000 + 300_000_000);
  const text = JSON.stringify(s);
  assert.ok(!text.includes('Hidden Heroes') && !text.includes('Secret Sam'));
  assert.equal(s.milestones.weekCount, 2);
  assert.deepEqual(s.milestones.recent.map(m => m.rsn), ['Pal One']);
  assert.deepEqual(s.groups.map(g => g.name), ['Public Pals']);
});

test('XP gains and skills come from the snapshots', () => {
  assert.equal(s.groups[0].weekGain, 100_000_000);
  assert.equal(s.players.week[0].rsn, 'Pal One');
  assert.equal(s.skills.week.find(x => x.skill === 'Mining').xp, 400_000_000);
});

test('plugin data appears only as anonymous totals', () => {
  assert.equal(s.plugin.onlineNow, 1);
  assert.equal(s.plugin.week.drops, 1);
  assert.equal(s.plugin.week.dropValue, 5_000_000);
  assert.equal(s.plugin.week.bossKills, 7);
  assert.ok(!JSON.stringify(s).includes('Very Private Visor'));
  assert.deepEqual(Object.keys(s.plugin).sort(), ['connectedPlayers', 'groupsUsing', 'month', 'onlineNow', 'week']);
});
