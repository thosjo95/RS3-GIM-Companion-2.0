// Scale helpers: the hiscores sync (active groups, back-off) and snapshot thinning.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.GIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-scale-'));
const db = require('../database');
const { activePlayers, runHiscoresSync } = require('../services/hiscoresSync');
const { thinSnapshots } = require('../services/metrics');

const group = (name, lastActivity) => Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, last_activity) VALUES (?, 'custom', 2, ?)").run(name, lastActivity).lastInsertRowid);
const player = (rsn, g) => Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run(rsn, g).lastInsertRowid);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().replace('T', ' ').slice(0, 19);

const gActive = group('Active', daysAgo(1)), gDead = group('Dead', daysAgo(40)), gPlugin = group('Plugin only', daysAgo(40));
const a1 = player('Fresh1', gActive), a2 = player('Fresh2', gActive), d1 = player('Dead1', gDead), p1 = player('Plug1', gPlugin);
db.prepare('INSERT INTO player_live_state (player_id, updated_at) VALUES (?, ?)').run(p1, new Date().toISOString());   // its plugin is running
db.prepare("UPDATE players SET last_synced = '2026-01-01 00:00:00' WHERE id = ?").run(a1);                            // a1 was synced longest ago
db.prepare("UPDATE players SET last_synced = '2026-06-01 00:00:00' WHERE id = ?").run(a2);

test('only active groups are synced, the least recently synced first', () => {
  const names = activePlayers().map(p => p.rsn);
  assert.deepEqual(new Set(names), new Set(['Fresh1', 'Fresh2', 'Plug1']));
  assert.ok(!names.includes('Dead1'));
  assert.ok(names.indexOf('Fresh1') < names.indexOf('Fresh2'));
});

const fakeSkills = { Overall: { level: 100, xp: 1000, rank: 5 }, Attack: { level: 50, xp: 100, rank: 6 } };
const svc = (impl) => ({
  runescape: { fetchHiscores: impl, fetchPlayerEvents: async () => null, calcCombatLevel: () => 3 },
  activitySync: {},
});

test('a rate limit stops the run and rests; the hourly run does not read the Adventurer\'s Log', async () => {
  let calls = 0;
  const out = await runHiscoresSync({ pause: 0, svc: svc(async () => { calls++; throw new Error('Hiscores API returned 429'); }) });
  assert.equal(out.stopped, 'rate limited');
  assert.equal(calls, 1, 'stopped after the first refusal');
  const again = await runHiscoresSync({ pause: 0, svc: svc(async () => ({ skills: fakeSkills, activities: [], totalXp: 1, totalLevel: 1 })) });
  assert.ok(again.skipped, 'resting after the rate limit');
});

test('snapshots older than a week are thinned to one per day, newer ones stay', () => {
  const pid = a1;
  const ins = iso => db.prepare('INSERT INTO metric_snapshots (player_id, taken_at, data_json) VALUES (?, ?, ?)').run(pid, iso, '{}');
  const at = (daysBack, hour) => { const d = new Date(Date.now() - daysBack * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
  for (const h of [1, 9, 17]) ins(at(20, h));        // three on one old day
  for (const h of [1, 9, 17]) ins(at(2, h));         // three on a recent day
  ins(at(130, 5));                                   // beyond the retention
  const r = thinSnapshots();
  assert.equal(r.thinned, 2);
  assert.equal(r.expired, 1);
  const left = day => db.prepare("SELECT COUNT(*) n FROM metric_snapshots WHERE player_id = ? AND substr(taken_at, 1, 10) = ?").get(pid, day).n;
  assert.equal(left(at(20, 1).slice(0, 10)), 1);
  assert.equal(left(at(2, 1).slice(0, 10)), 3);
});
