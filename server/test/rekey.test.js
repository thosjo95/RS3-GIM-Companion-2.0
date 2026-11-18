// Groups that came over from 1.x: the old secret only works for the one-time claim, which issues a NEW secret.
// Also the migration script (orphans, names, flags) on a small made-up "1.x" database.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-rekey-'));
process.env.GIM_DATA_DIR = dataDir;
const db = require('../database');

const PORT = 3970 + Math.floor(Math.random() * 9);
const base = `http://localhost:${PORT}/api`;
const OLD = 'old-1x-secret';
let server, legacy, modern, member;

const call = (method, p, { headers = {}, body } = {}) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const withSecret = s => ({ 'X-Group-Password': s });

test.before(async () => {
  // a 1.x group: unsalted SHA-256 secret, flagged as needing the one-time claim
  const legacyHash = crypto.createHash('sha256').update(OLD).digest('hex');
  legacy = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, password_hash, needs_rekey) VALUES ('Came over', 'custom', 2, ?, 1)").run(legacyHash).lastInsertRowid);
  member = Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('Old Member', legacy).lastInsertRowid);
  modern = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size) VALUES ('Native', 'custom', 1)").run().lastInsertRowid);

  server = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('server did not start');
});
test.after(() => { server?.kill(); });

test('a group that came over says so, and its old secret unlocks nothing yet', async () => {
  const g = await (await call('GET', `/groups/${legacy}`)).json();
  assert.equal(g.needs_rekey, 1);
  assert.equal((await call('POST', `/groups/${legacy}/verify`, { headers: withSecret(OLD) })).status, 409);
  const state = await call('GET', `/plugin/state?group_id=${legacy}`, { headers: withSecret(OLD) });
  assert.equal(state.status, 401);
  assert.equal((await state.json()).needs_rekey, true);
  const join = await call('POST', '/plugin/join', { body: { rsn: 'Old Member', group_secret: OLD } });
  assert.equal(join.status, 401);                                                  // the plugin cannot join with it either
});

test('the one-time claim: the old secret proves it, a new secret replaces it at once', async () => {
  assert.equal((await call('POST', `/groups/${legacy}/claim-v2`, { body: { old_secret: 'not it' } })).status, 401);
  assert.equal((await call('POST', `/groups/${legacy}/claim-v2`, { body: {} })).status, 400);
  assert.equal((await call('POST', `/groups/${modern}/claim-v2`, { body: { old_secret: OLD } })).status, 409);   // nothing to claim again

  const ok = await call('POST', `/groups/${legacy}/claim-v2`, { body: { old_secret: OLD } });
  assert.equal(ok.status, 200);
  const { secret } = await ok.json();
  assert.match(secret, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const row = db.prepare('SELECT needs_rekey, claimed_v2_at, password_salt FROM groups WHERE id = ?').get(legacy);
  assert.equal(row.needs_rekey, 0);
  assert.ok(row.claimed_v2_at, 'the adoption date is recorded');
  assert.ok(row.password_salt, 'the new secret is stored salted');
  assert.equal((await call('POST', `/groups/${legacy}/verify`, { headers: withSecret(OLD) })).status, 401);      // the old one is dead
  assert.equal((await call('POST', `/groups/${legacy}/verify`, { headers: withSecret(secret) })).status, 200);   // the new one works
  assert.equal((await call('POST', `/groups/${legacy}/claim-v2`, { body: { old_secret: OLD } })).status, 409);   // only once
  const join = await call('POST', '/plugin/join', { body: { rsn: 'Old Member', group_secret: secret } });
  assert.equal(join.status, 200);                                                  // and the plugin can join with the new one
});

test('claiming an unclaimed group on 2.0 records the adoption date', async () => {
  const res = await call('POST', `/groups/${modern}/claim`, { body: {} });
  assert.equal(res.status, 200);
  assert.ok(db.prepare('SELECT claimed_v2_at FROM groups WHERE id = ?').get(modern).claimed_v2_at);
});

test('the migration script cleans a 1.x copy: orphans, names, flags, and changes nothing without --apply', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-mig-'));
  const script = path.join(__dirname, '..', 'scripts', 'migrate1x.js');
  const env = { ...process.env, GIM_DATA_DIR: dir };
  // build the database with the 2.0 schema, then add the kind of leftovers a 1.x database has
  spawnSync(process.execPath, ['-e', `
    const db = require(${JSON.stringify(path.join(__dirname, '..', 'database'))});
    db.exec("INSERT INTO groups (id, name, gim_type, gim_size, password_hash) VALUES (1, 'Old', 'custom', 2, 'abc'), (2, 'Open', 'custom', 1, NULL)");
    db.exec("INSERT INTO players (id, rsn, group_id) VALUES (1, 'Degree\\u00a0C', 1), (2, 'Plain Name', 1), (3, 'Open One', 2)");
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec("INSERT INTO skills (player_id, skill_name, level, xp) VALUES (99, 'Attack', 1, 0)");     // a deleted player's skill row
    db.exec("INSERT INTO players (id, rsn, group_id) VALUES (50, 'Lost Soul', 77)");                   // a player whose group is gone
    db.exec("UPDATE groups SET claimed_v2_at = NULL, needs_rekey = 0");
    db.exec("INSERT INTO equipment_loadouts (player_id, style, slot, item_name) VALUES (3, 'melee', 'head', 'Helm')");
  `], { env });
  const dry = spawnSync(process.execPath, [script, '--assume-1x'], { env, encoding: 'utf8' });
  assert.match(dry.stdout, /DRY RUN/);
  const { DatabaseSync } = require('node:sqlite');
  const peek = sql => { const d = new DatabaseSync(path.join(dir, 'gim.db'), { readOnly: true }); try { return d.prepare(sql).get(); } finally { d.close(); } };
  assert.equal(peek("SELECT COUNT(*) n FROM players WHERE id = 50").n, 1, 'a dry run changes nothing');

  const run = spawnSync(process.execPath, [script, '--assume-1x', '--drop-loadouts', '--apply'], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(peek("SELECT COUNT(*) n FROM players WHERE id = 50").n, 0, 'a player of a missing group is removed');
  assert.equal(peek("SELECT COUNT(*) n FROM skills WHERE player_id = 99").n, 0, 'orphan skill rows are removed');
  assert.equal(peek("SELECT rsn FROM players WHERE id = 1").rsn, 'Degree C', 'names get plain spaces');
  assert.equal(peek("SELECT needs_rekey n FROM groups WHERE id = 1").n, 1, 'a group with an old secret needs the one-time claim');
  assert.equal(peek("SELECT needs_rekey n FROM groups WHERE id = 2").n, 0, 'a group without a secret does not');
  assert.equal(peek("SELECT COUNT(*) n FROM equipment_loadouts").n, 0, 'gear loadouts are dropped on request');
});
