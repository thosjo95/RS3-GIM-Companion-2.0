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
  const id = Number(db.prepare('INSERT INTO groups (name, gim_type, gim_size) VALUES (?, ?, ?)').run(name, extra.type ?? 'regular', extra.size ?? 2).lastInsertRowid);
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
  const c = group('Comp Crew', { type: 'competitive', size: 5 });
  player(c, 'Comp Carl', 300_000_000, 250_000_000);
  const u = group('Hidden Heroes', { unlisted: true });
  const pu = player(u, 'Secret Sam', 900_000_000, 600_000_000);
  const d = group('Misthalin Five (Demo)', { demo: true });
  player(d, 'Demo Dan', 999_000_000, 100_000_000);
  // a public 99 for two players; a plugin drop and boss kills for the public player
  db.prepare("INSERT INTO player_skill_milestones (player_id, skill, level, achieved_at) VALUES (?, 'Mining', 99, ?)").run(pa, iso(1));
  db.prepare("INSERT INTO player_skill_milestones (player_id, skill, level, achieved_at) VALUES (?, 'Mining', 99, ?)").run(pu, iso(1));
  db.prepare("INSERT INTO drops (player_id, item_name, value_gp, quantity, notes, dropped_at, source) VALUES (?, 'Very Private Visor', 5000000, 1, 'Detected by the plugin', ?, 'plugin')").run(pa, iso(1));
  db.prepare("INSERT INTO progress_log (player_id, kind, key, name, gain, total, at) VALUES (?, 'boss', 'nex', 'Nex', 7, 50, ?)").run(pa, iso(1));
  db.prepare("INSERT INTO player_live_state (player_id, updated_at) VALUES (?, ?)").run(pa, new Date().toISOString());
  s = _build();
});

test('the demo group is left out completely', () => {
  assert.equal(s.groups.length, 3);
  assert.ok(!JSON.stringify(s).includes('Demo'));
});

test('unlisted groups count in the numbers but are never named', () => {
  const text = JSON.stringify(s);
  assert.ok(!text.includes('Hidden Heroes') && !text.includes('Secret Sam'));
  const anon = s.groups.find(g => g.anon);
  assert.equal(anon.weekGain, 300_000_000);
  assert.equal(anon.id, undefined);
  assert.equal(anon.milestones.week, 1);
  assert.deepEqual(s.milestones.map(m => m.rsn), ['Pal One']);
  assert.deepEqual(s.players.map(p => p.rsn).sort(), ['Comp Carl', 'Pal One']);
});

test('numbers are per group, with mode and size, so the page can filter them', () => {
  const pals = s.groups.find(g => g.name === 'Public Pals');
  assert.equal(pals.weekGain, 100_000_000);
  assert.equal(s.buckets.find(b => b.type === 'regular' && b.size === 2).skills.week.Mining, 100_000_000 + 300_000_000);   // with the unlisted group
  const comp = s.groups.find(g => g.name === 'Comp Crew');
  assert.equal(comp.type, 'competitive');
  assert.equal(comp.size, 5);
  assert.deepEqual(s.players.find(p => p.rsn === 'Comp Carl'), { type: 'competitive', size: 5, rsn: 'Comp Carl', groupId: comp.id, groupName: 'Comp Crew', week: 50_000_000, month: 50_000_000, year: 50_000_000 });
});

test('plugin data appears only as anonymous totals', () => {
  assert.equal(s.plugin.onlineNow, 1);
  assert.equal(s.plugin.week.drops, 1);
  assert.equal(s.plugin.week.dropValue, 5_000_000);
  assert.equal(s.plugin.week.bossKills, 7);
  assert.ok(!JSON.stringify(s).includes('Very Private Visor'));
  assert.deepEqual(Object.keys(s.plugin).sort(), ['connectedPlayers', 'groupsUsing', 'month', 'onlineNow', 'week', 'year']);
});
