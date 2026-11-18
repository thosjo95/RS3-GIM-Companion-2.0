// The group's own settings: Live XP minimum, Bank Journal minimum, boss minimum kills, clue tiers, online window, unlisted.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

process.env.GIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-settings-'));
const db = require('../database');
const { hashPassword } = require('../utils/auth');

const PORT = 3950 + Math.floor(Math.random() * 9);
const base = `http://localhost:${PORT}/api`;
const SECRET = 'SETTINGS-TEST';
const auth = { 'X-Group-Password': SECRET };
let server, gid, pid;
const call = (method, p, { headers = {}, body } = {}) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const set = body => call('PUT', `/groups/${gid}/settings`, { headers: auth, body });
const json = async (p) => (await call('GET', p, { headers: auth })).json();

test.before(async () => {
  const pw = hashPassword(SECRET);
  gid = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, password_hash, password_salt) VALUES ('Settings Group', 'custom', 1, ?, ?)").run(pw.hash, pw.salt).lastInsertRowid);
  pid = Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('Settings Tester', gid).lastInsertRowid);
  const now = new Date().toISOString();
  for (const xp of [100, 600, 5000]) db.prepare('INSERT INTO xp_drops (player_id, skill, xp, at) VALUES (?, ?, ?, ?)').run(pid, 'Mining', xp, now);
  const led = db.prepare("INSERT INTO storage_ledger (player_id, store, item_id, item_name, delta, value_each, occurred_at) VALUES (?, 'group', ?, ?, ?, ?, ?)");
  led.run(pid, 1, 'Feather', 100, 4, now);              // 400 gp
  led.run(pid, 2, 'Rune bar', 10, 12_000, now);         // 120K
  led.run(pid, 3, 'Mystery', 1, null, now);             // unknown value
  db.prepare('INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at) VALUES (?, ?, ?, ?, ?)').run(pid, 'kree', "Kree'arra", 4, now);
  db.prepare('INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at) VALUES (?, ?, ?, ?, ?)').run(pid, 'qbd', 'Queen Black Dragon', 40, now);
  const log = db.prepare('INSERT INTO progress_log (player_id, kind, key, name, gain, total, at) VALUES (?, ?, ?, ?, 1, ?, ?)');
  log.run(pid, 'boss', 'kree', "Kree'arra", 4, now); log.run(pid, 'boss', 'qbd', 'Queen Black Dragon', 40, now);
  for (const t of ['easy', 'hard', 'master']) log.run(pid, 'clue', t, t, 5, now);
  db.prepare('INSERT INTO player_live_state (player_id, updated_at) VALUES (?, ?)').run(pid, new Date(Date.now() - 4 * 60_000).toISOString());   // last heard 4 minutes ago
  server = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('server did not start');
});
test.after(() => { server?.kill(); });

test('settings need the secret, are validated, and default to "show everything"', async () => {
  assert.equal((await call('PUT', `/groups/${gid}/settings`, { body: { xp_min: 5 } })).status, 401);
  assert.equal((await set({ xp_min: -1 })).status, 400);
  assert.equal((await set({ nonsense: 1 })).status, 400);
  assert.equal((await set({ clue_tiers: ['easy', 'legendary'] })).status, 400);
  assert.equal((await set({ online_minutes: 4 })).status, 400);
  const g = await (await call('GET', `/groups/${gid}`)).json();
  assert.equal(g.settings.xp_min, 0);
  assert.deepEqual(g.settings.clue_tiers, ['easy', 'medium', 'hard', 'elite', 'master']);
  assert.equal(g.settings.unlisted, false);
});

test('Live XP: only drops of at least the minimum', async () => {
  assert.equal((await json(`/plugin/xp-drops?group_id=${gid}`)).length, 3);
  await set({ xp_min: 500 });
  assert.deepEqual((await json(`/plugin/xp-drops?group_id=${gid}`)).map(d => d.xp).sort((a, b) => a - b), [600, 5000]);
  await set({ xp_min: 0 });
});

test('Bank Journal: small entries stay out, unknown values stay in', async () => {
  assert.equal((await json(`/plugin/ledger?group_id=${gid}`)).length, 3);
  await set({ journal_min: 100_000 });
  assert.deepEqual((await json(`/plugin/ledger?group_id=${gid}`)).map(r => r.item_name).sort(), ['Mystery', 'Rune bar']);
  await set({ journal_min: 0 });
});

test('Boss log: a boss shows once the member has enough kills', async () => {
  assert.equal((await json(`/plugin/progress-log?group_id=${gid}&kind=boss`)).length, 2);
  await set({ boss_min_kills: 10 });
  assert.deepEqual((await json(`/plugin/progress-log?group_id=${gid}&kind=boss`)).map(r => r.key), ['qbd']);
  await set({ boss_min_kills: 0 });
});

test('Clue log: only the chosen tiers', async () => {
  assert.equal((await json(`/plugin/progress-log?group_id=${gid}&kind=clue`)).length, 3);
  await set({ clue_tiers: ['hard', 'master'] });
  assert.deepEqual((await json(`/plugin/progress-log?group_id=${gid}&kind=clue`)).map(r => r.key).sort(), ['hard', 'master']);
  await set({ clue_tiers: [] });
  assert.equal((await json(`/plugin/progress-log?group_id=${gid}&kind=clue`)).length, 0);
});

test('online window: 4 minutes ago is offline at 3 minutes, online at 5', async () => {
  const online = async () => (await json(`/plugin/presence?group_id=${gid}`))[0].online;
  assert.equal(await online(), false);
  await set({ online_minutes: 5 });
  assert.equal(await online(), true);
});

test('unlisted groups are not found by browsing or searching, but a browser that saved the group still gets it', async () => {
  const findable = async () => (await (await call('GET', '/groups/search?name=Settings%20Group')).json()).some(g => g.id === gid);
  assert.equal(await findable(), true);
  await set({ unlisted: true });
  assert.equal(await findable(), false);
  assert.equal((await (await call('GET', '/groups/search?limit=100')).json()).some(g => g.id === gid), false);
  assert.equal((await (await call('GET', '/groups')).json()).some(g => g.id === gid), false);
  assert.equal((await (await call('GET', `/groups?ids=${gid}`)).json()).some(g => g.id === gid), true);
  assert.equal((await call('GET', `/groups/${gid}`)).status, 200);          // reachable by link
});
