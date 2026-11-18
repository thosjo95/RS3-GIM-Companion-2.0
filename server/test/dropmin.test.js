// A group's own minimum for a drop to show in its Drops (and to be reported by the plugin).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

process.env.GIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-dropmin-'));
const db = require('../database');
const { hashPassword } = require('../utils/auth');

const PORT = 3960 + Math.floor(Math.random() * 9);
const base = `http://localhost:${PORT}/api`;
const SECRET = 'DROP-MIN-TEST';
let server, gid, pid;
const call = (method, p, { headers = {}, body } = {}) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const auth = { 'X-Group-Password': SECRET };

test.before(async () => {
  const pw = hashPassword(SECRET);
  gid = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, password_hash, password_salt) VALUES ('Drop Min', 'custom', 1, ?, ?)").run(pw.hash, pw.salt).lastInsertRowid);
  pid = Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('Drop Tester', gid).lastInsertRowid);
  const add = db.prepare("INSERT INTO drops (player_id, item_name, quantity, value_gp) VALUES (?, ?, ?, ?)");
  add.run(pid, 'Small thing', 1, 20_000);          // below the default 100K
  add.run(pid, 'Stack of seeds', 10, 30_000);      // 300K in total
  add.run(pid, 'Big thing', 1, 6_000_000);
  add.run(pid, 'Mystery', 1, null);                // unknown value
  server = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('server did not start');
});
test.after(() => { server?.kill(); });

const names = async () => (await (await call('GET', `/drops?group_id=${gid}`)).json()).map(d => d.item_name).sort();

test('by default drops below 100K in total stay out; unknown values stay in', async () => {
  assert.deepEqual(await names(), ['Big thing', 'Mystery', 'Stack of seeds']);
});

test('the group can set its own minimum, and only with the secret', async () => {
  assert.equal((await call('PUT', `/groups/${gid}/drop-min`, { body: { value: 5_000_000 } })).status, 401);
  assert.equal((await call('PUT', `/groups/${gid}/drop-min`, { headers: auth, body: { value: -5 } })).status, 400);
  assert.equal((await call('PUT', `/groups/${gid}/drop-min`, { headers: auth, body: { value: 5_000_000 } })).status, 200);
  assert.deepEqual(await names(), ['Big thing', 'Mystery']);
  assert.equal((await call('PUT', `/groups/${gid}/drop-min`, { headers: auth, body: { value: 0 } })).status, 200);
  assert.equal((await names()).length, 4);                      // 0 = every drop
  assert.equal((await (await call('GET', `/groups/${gid}`)).json()).drop_min_value, 0);
  await call('PUT', `/groups/${gid}/drop-min`, { headers: auth, body: { value: null } });
  assert.equal((await (await call('GET', `/groups/${gid}`)).json()).drop_min_value, null);   // back to the default
});

test('the plugin is told the group\'s minimum when it starts', async () => {
  const minted = await (await call('POST', '/plugin/tokens', { headers: auth, body: { player_id: pid } })).json();
  const token = minted.token;
  await call('PUT', `/groups/${gid}/drop-min`, { headers: auth, body: { value: 750_000 } });
  const cfg = await (await call('GET', '/plugin/config', { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(cfg.drop_threshold, 750_000);
});
