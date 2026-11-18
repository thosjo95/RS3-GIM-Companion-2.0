// The admin portal talks to this server and this database: login, group list with adoption, maintenance, no leftovers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-admin-'));
process.env.GIM_DATA_DIR = dataDir;
const db = require('../database');
const { hashPassword } = require('../utils/adminAuth');

const PORT = 3980 + Math.floor(Math.random() * 9);
const base = `http://localhost:${PORT}/api/admin`;
let server, token, gid;

test.before(async () => {
  const { hash, salt } = hashPassword('test-admin-pw');
  db.prepare('INSERT INTO admin_users (username, password_hash, salt) VALUES (?, ?, ?)').run('admin', hash, salt);
  gid = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, password_hash, needs_rekey) VALUES ('Admin Test', 'custom', 1, 'x', 1)").run().lastInsertRowid);
  db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('Admin Tester', gid);
  server = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('server did not start');
});
test.after(() => { server?.kill(); });

const call = (method, p, body) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) });

test('admin routes need a login', async () => {
  assert.equal((await call('GET', '/groups')).status, 401);
  assert.equal((await call('POST', '/login', { username: 'admin', password: 'wrong' })).status, 401);
  const ok = await call('POST', '/login', { username: 'admin', password: 'test-admin-pw' });
  assert.equal(ok.status, 200);
  token = (await ok.json()).token;
});

test('stats and the group list work on this database and show adoption', async () => {
  const stats = await (await call('GET', '/stats')).json();
  assert.ok(stats.table_counts && !('pending' in stats));
  const groups = await (await call('GET', '/groups')).json();
  const g = groups.find(x => x.id === gid);
  assert.equal(g.needs_rekey, 1);
  assert.equal(g.claimed_v2_at, null);
});

test('new secret: unlocks the group on 2.0 and records the adoption', async () => {
  const res = await call('POST', '/maintenance/new-secret', { group_id: gid });
  assert.equal(res.status, 200);
  const { secret } = await res.json();
  const verify = await fetch(`http://localhost:${PORT}/api/groups/${gid}/verify`, { method: 'POST', headers: { 'X-Group-Password': secret } });
  assert.equal(verify.status, 200);
  const g = (await (await call('GET', '/groups')).json()).find(x => x.id === gid);
  assert.ok(g.claimed_v2_at);
  assert.equal(g.needs_rekey, 0);
});

test('the dashboard can ask whether this is the preview server', async () => {
  const c = await (await fetch(`http://localhost:${PORT}/api/config`)).json();
  assert.deepEqual(c, { preview: false, copied: null, plugin_live: false, drop_default_min: 100000 });
});

test('the old 1.x review queue, audit log and wiki scan are gone', async () => {
  for (const p of ['/submissions', '/audit', '/maintenance/wiki-scan?type=quests']) assert.equal((await call('GET', p)).status, 404, p);
});
