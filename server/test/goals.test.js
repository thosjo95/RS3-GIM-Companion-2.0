// The goal tracker: goals the players have already achieved are completed from what the app knows about them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.GIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-goals-'));
const db = require('../database');
const { reconcileGoals, goalProgress } = require('../services/goalTracker');

const group = n => Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size) VALUES (?, 'custom', 2)").run(n).lastInsertRowid);
const player = (rsn, g) => Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run(rsn, g).lastInsertRowid);
const goal = (g, owner, o) => Number(db.prepare(`INSERT INTO goals (type, owner_id, group_id, title, category, skill, target_value, status, details_json)
  VALUES ('group', ?, ?, ?, ?, ?, ?, 'not_started', ?)`).run(owner, g, o.title, o.category, o.skill ?? null, o.target ?? null, o.details ? JSON.stringify(o.details) : null).lastInsertRowid);
const status = id => db.prepare('SELECT status FROM goals WHERE id = ?').get(id).status;

const G = group('Tracker Group'), OTHER = group('Other Group');
const A = player('Alpha', G), B = player('Beta', G), X = player('Xeno', OTHER);

test('skill goals: hiscores level and the plugin live level both count', () => {
  db.prepare("INSERT INTO skills (player_id, skill_name, level, xp) VALUES (?, 'Slayer', 85, 5000000)").run(A);
  const hit = goal(G, A, { title: '85 Slayer', category: 'skill', skill: 'Slayer', target: 85 });
  const miss = goal(G, A, { title: '90 Slayer', category: 'skill', skill: 'Slayer', target: 90 });
  const viaPlugin = goal(G, B, { title: '60 Mining', category: 'skill', skill: 'Mining', target: 60 });
  db.prepare("INSERT INTO player_live_state (player_id, updated_at, skills_json) VALUES (?, ?, ?)").run(B, new Date().toISOString(), JSON.stringify({ Mining: { xp: 300000, level: 61 } }));
  reconcileGoals(G);
  assert.equal(status(hit), 'complete');
  assert.equal(status(miss), 'not_started');
  assert.equal(status(viaPlugin), 'complete');
  assert.equal(goalProgress(G)[miss].current, 85);
  assert.equal(goalProgress(G)[miss].target, 90);
});

test('quest goals: finished in the game (plugin) or in the Adventurer\'s Log, series text ignored', () => {
  db.prepare("INSERT INTO player_quests (player_id, quest_id, name, state, updated_at) VALUES (?, 1, 'Dragon Slayer', 'finished', ?)").run(A, new Date().toISOString());
  db.prepare('UPDATE players SET quests_json = ? WHERE id = ?').run(JSON.stringify([{ title: "Cook's Assistant", status: 'COMPLETED' }, { title: 'Plague City', status: 'STARTED' }]), B);
  const ds = goal(G, A, { title: 'Dragon Slayer (quest series)', category: 'quest' });
  const cook = goal(G, A, { title: "Cook's Assistant", category: 'quest' });
  const plague = goal(G, A, { title: 'Plague City', category: 'quest' });
  reconcileGoals(G);
  assert.equal(status(ds), 'complete');
  assert.equal(status(cook), 'complete');
  assert.equal(status(plague), 'not_started', 'a started quest is not a finished quest');
});

test('area task goals: done when the set is in the grid', () => {
  db.prepare("INSERT INTO achievements (player_id, type, key, achieved, manual) VALUES (?, 'diary', 'diary_varrock_easy', 1, 0)").run(A);
  const done = goal(G, A, { title: 'Varrock Easy', category: 'diary', details: { diaryKey: 'diary_varrock_easy' } });
  const open = goal(G, A, { title: 'Varrock Hard', category: 'diary', details: { diaryKey: 'diary_varrock_hard' } });
  reconcileGoals(G);
  assert.equal(status(done), 'complete');
  assert.equal(status(open), 'not_started');
});

test('boss goals: the game\'s exact lifetime kills against the number in the title', () => {
  db.prepare("INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at) VALUES (?, 'BSLAY_MOLE', 'Giant Mole', 13, ?)").run(A, new Date().toISOString());
  db.prepare("INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at) VALUES (?, 'BSLAY_KRIL', ?, 1062, ?)").run(A, "K'ril Tsutsaroth", new Date().toISOString());
  const mole = goal(G, A, { title: 'Giant Mole — 50 Kills', category: 'boss' });
  const kril = goal(G, A, { title: "K'ril Tsutsaroth (Zamorak) — 50 Kills", category: 'boss' });
  reconcileGoals(G);
  assert.equal(status(mole), 'not_started');
  assert.deepEqual([goalProgress(G)[mole].current, goalProgress(G)[mole].target], [13, 50]);
  assert.equal(status(kril), 'complete');
});

test('goals of other groups are not touched by this group\'s data', () => {
  const g = goal(OTHER, X, { title: "Cook's Assistant", category: 'quest' });
  reconcileGoals(OTHER);
  assert.equal(status(g), 'not_started');
});

test('goals the tracker cannot judge (items, custom) stay open', () => {
  const item = goal(G, A, { title: 'Full Rune Equipment Set', category: 'item' });
  reconcileGoals(G);
  assert.equal(status(item), 'not_started');
  assert.equal(goalProgress(G)[item], undefined);
});

test('recommendations come from the game facts and skip goals already on the board', () => {
  const { recommend } = require('../services/recommendations');
  const now = new Date().toISOString();
  db.prepare("INSERT INTO player_quests (player_id, quest_id, name, state, updated_at, can_start) VALUES (?, 50, 'Ready Quest', 'not_started', ?, 1)").run(B, now);
  db.prepare("INSERT INTO player_quests (player_id, quest_id, name, state, updated_at, can_start) VALUES (?, 51, 'Locked Quest', 'not_started', ?, 0)").run(B, now);
  db.prepare("INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at, combat_req) VALUES (?, 'BSLAY_A', 'Easy Boss', 0, ?, 3)").run(B, now);
  db.prepare("INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at, combat_req) VALUES (?, 'BSLAY_B', 'Hard Boss', 0, ?, 138)").run(B, now);
  const titles = () => recommend(G, B).map(r => r.goal.title);
  assert.ok(titles().includes('Ready Quest'));
  assert.ok(!titles().includes('Locked Quest'));
  assert.ok(titles().includes('Easy Boss — 1 Kill'));
  assert.ok(!titles().includes('Hard Boss — 1 Kill'), 'combat level too low');
  goal(G, B, { title: 'Ready Quest', category: 'quest' });
  assert.ok(!titles().includes('Ready Quest'));
});
