// Group leaderboard: gains are "now minus the snapshot at the start", competitions use their own start and end.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.GIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-comp-'));
const db = require('../database');
const { standings, snapshotPlayer, collect } = require('../services/metrics');

const g = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size) VALUES ('Comp Group', 'custom', 2)").run().lastInsertRowid);
const A = Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('Alpha', g).lastInsertRowid);
const B = Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('Beta', g).lastInsertRowid);
const players = [{ id: A, rsn: 'Alpha' }, { id: B, rsn: 'Beta' }];
const setXp = (pid, xp, level) => db.prepare("INSERT INTO skills (player_id, skill_name, level, xp) VALUES (?, 'Overall', ?, ?) ON CONFLICT(player_id, skill_name) DO UPDATE SET level = excluded.level, xp = excluded.xp").run(pid, level, xp);
const snapshotAt = (pid, iso) => db.prepare('INSERT INTO metric_snapshots (player_id, taken_at, data_json) VALUES (?, ?, ?)').run(pid, iso, JSON.stringify(collect(pid)));
const ago = h => new Date(Date.now() - h * 3600 * 1000).toISOString();

test('XP gained since a start time, highest first', () => {
  setXp(A, 1000, 100); setXp(B, 5000, 120);
  snapshotAt(A, ago(48)); snapshotAt(B, ago(48));
  setXp(A, 4000, 110); setXp(B, 5500, 121);
  const r = standings(players, 'xp', 'Overall', Date.now() - 24 * 3600 * 1000);
  assert.deepEqual(r.map(x => [x.rsn, x.value]), [['Alpha', 3000], ['Beta', 500]]);
});

test('a competition that has ended counts only up to its end', () => {
  snapshotAt(A, ago(10)); snapshotAt(B, ago(10));                       // state: Alpha 4000, Beta 5500
  setXp(A, 9000, 115);                                                  // later gains must not count
  const r = standings(players, 'xp', 'Overall', Date.now() - 30 * 3600 * 1000, Date.now() - 5 * 3600 * 1000);
  const alpha = r.find(x => x.rsn === 'Alpha');
  assert.equal(alpha.value, 3000);
});

test('quest points and boss kills come from the plugin data', () => {
  db.prepare("INSERT INTO player_quests (player_id, quest_id, name, state, points, updated_at) VALUES (?, 1, 'Q', 'finished', 3, ?)").run(A, new Date().toISOString());
  db.prepare("INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at) VALUES (?, 'BSLAY_ARAXXI', 'Araxxi', 40, ?)").run(A, new Date().toISOString());
  snapshotAt(A, ago(3));
  db.prepare("UPDATE player_boss_kills SET kills = 55 WHERE player_id = ?").run(A);
  db.prepare("INSERT INTO player_quests (player_id, quest_id, name, state, points, updated_at) VALUES (?, 2, 'Q2', 'finished', 2, ?)").run(A, new Date().toISOString());
  const since = Date.now() - 4 * 3600 * 1000;
  assert.equal(standings(players, 'boss_kills', 'BSLAY_ARAXXI', since).find(x => x.rsn === 'Alpha').value, 15);
  assert.equal(standings(players, 'quest_points', null, since).find(x => x.rsn === 'Alpha').value, 2);
});

test('snapshots are throttled', () => {
  assert.equal(snapshotPlayer(B, true), true);
  assert.equal(snapshotPlayer(B), false);
});
