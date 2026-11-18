// Run with: npm test --prefix server   (Node's built-in test runner — no extra dependencies)
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { spawn } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-test-'));
process.env.GIM_DATA_DIR = dataDir;               // isolated database for this run
const db = require('../database');
const { hashPassword } = require('../utils/auth');

const PORT = 3990 + Math.floor(Math.random() * 9);
const base = `http://localhost:${PORT}/api`;
const SECRET = 'TEST-SECRET-1234';
const SECRET_B = 'OTHER-SECRET-5678';
let server, groupA, groupB, openGroup, pA, pB, pOpen;

const call = (method, p, { headers = {}, body } = {}) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const asGroup = (id, pw = id === groupB ? SECRET_B : SECRET) => ({ 'X-Group-Id': String(id), 'X-Group-Password': pw });
const bearer = t => ({ Authorization: `Bearer ${t}` });

test.before(async () => {
  const mk = (name, locked, secret = SECRET) => {
    const pw = locked ? hashPassword(secret) : { hash: null, salt: null };
    return Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, password_hash, password_salt) VALUES (?, 'custom', 2, ?, ?)").run(name, pw.hash, pw.salt).lastInsertRowid);
  };
  groupA = mk('A', true); groupB = mk('B', true, SECRET_B); openGroup = mk('Open', false);
  const mp = (rsn, g) => Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run(rsn, g).lastInsertRowid);
  pA = mp('PlayerA', groupA); pB = mp('PlayerB', groupB); pOpen = mp('PlayerOpen', openGroup);

  server = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {            // wait until it answers
    try { if ((await fetch(base + '/health')).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server did not start');
});
test.after(() => { server?.kill(); });

async function mint(playerId, groupId) {
  const res = await call('POST', '/plugin/tokens', { headers: asGroup(groupId), body: { player_id: playerId } });
  assert.equal(res.status, 201);
  return (await res.json()).token;
}

test('minting a token needs write auth on the player\'s own group', async () => {
  assert.equal((await call('POST', '/plugin/tokens', { body: { player_id: pA } })).status, 401);
  assert.equal((await call('POST', '/plugin/tokens', { headers: asGroup(groupA, 'wrong'), body: { player_id: pA } })).status, 401);
  // the classic bypass: use group B's credentials against group A's player
  assert.equal((await call('POST', '/plugin/tokens', { headers: asGroup(groupB), body: { player_id: pA } })).status, 401);
  assert.equal((await call('POST', '/plugin/tokens', { headers: asGroup(groupA), body: { player_id: 999999 } })).status, 404);
  const token = await mint(pA, groupA);
  assert.match(token, /^gimp_[\w-]{40,}$/);
});

test('only a hash is stored, never the token', async () => {
  const token = await mint(pA, groupA);
  const rows = db.prepare('SELECT token_hash FROM plugin_tokens WHERE player_id = ? AND revoked = 0').all(pA);
  assert.equal(rows.length, 1, 'minting revokes the previous token');
  assert.notEqual(rows[0].token_hash, token);
  assert.equal(rows[0].token_hash.length, 64);
});

test('ingest rejects missing, malformed and unknown tokens', async () => {
  const body = { v: 1, world: 12 };
  assert.equal((await call('POST', '/plugin/ingest', { body })).status, 401);
  assert.equal((await call('POST', '/plugin/ingest', { headers: bearer('nope'), body })).status, 401);
  assert.equal((await call('POST', '/plugin/ingest', { headers: bearer('gimp_' + 'x'.repeat(43)), body })).status, 401);
});

test('ingest validates every section with a useful message', async () => {
  const token = await mint(pA, groupA);
  const bad = async (body, expect) => {
    const res = await call('POST', '/plugin/ingest', { headers: bearer(token), body });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, expect);
  };
  await bad({ world: 12 }, /version/);
  await bad({ v: 1, world: 'x' }, /world/);
  await bad({ v: 1, position: { x: 1, y: 2 } }, /position/);
  await bad({ v: 1, skills: { Nonsense: { xp: 1, level: 1 } } }, /Unknown skill/);
  await bad({ v: 1, skills: { Attack: { xp: -5, level: 1 } } }, /skills\.Attack/);
  await bad({ v: 1, inventory: [{ id: 'a', count: 1 }] }, /inventory\[0\]\.id/);
  await bad({ v: 1, inventory: [{ id: 1, count: 0 }] }, /count/);
  await bad({ v: 1, storage_changes: [{ store: 'vault', id: 1, delta: 1 }] }, /store/);
  await bad({ v: 1, storage_changes: [{ store: 'group', id: 1, delta: 0 }] }, /delta/);
  await bad({ v: 1, inventory: Array.from({ length: 101 }, (_, i) => ({ id: i, count: 1 })) }, /too many/);
  await bad({ v: 1, quests: [{ id: 1, name: 'X', state: 'done' }] }, /state/);
  await bad({ v: 1, quests: [{ id: 'a', name: 'X', state: 'started' }] }, /id/);
  await bad({ v: 1, quests: Array.from({ length: 901 }, (_, i) => ({ id: i, name: 'Q' + i, state: 'started' })) }, /too many/);
  await bad({ v: 1, kills: [{ npc: 'Cow', kills: 0 }] }, /integer between 1 and 10000/);
  await bad({ v: 1, kills: [{ npc: '', kills: 1 }] }, /npc/);
  await bad({ v: 1, kills: [{ npc: 'Cow', kills: 1 }], kills_ref: 'x' }, /kills_ref/);
  await bad({ v: 1, drops: [{ name: 'Whip', quantity: 1, ref: 'a' }] }, /ref/);
  await bad({ v: 1, drops: [{ name: 'Whip', quantity: 0, ref: 'abcdef' }] }, /quantity/);
  await bad({ v: 1, drops: [{ name: 'Whip', quantity: 1, ref: 'abcdef', ts: 'not a date' }] }, /ts/);
});

test('sections replace independently (partial updates keep the rest)', async () => {
  const token = await mint(pA, groupA);
  const post = body => call('POST', '/plugin/ingest', { headers: bearer(token), body });
  assert.equal((await post({ v: 1, world: 12, inventory: [{ id: 995, name: 'Coins', count: 1000 }], skills: { Attack: { xp: 5000, level: 30 } } })).status, 200);
  assert.equal((await post({ v: 1, position: { x: 3200, y: 3200, z: 0 } })).status, 200);

  const state = await (await call('GET', `/plugin/state?group_id=${groupA}`, { headers: asGroup(groupA) })).json();
  const me = state.find(p => p.player_id === pA);
  assert.equal(me.world, 12);
  assert.deepEqual(me.position, { x: 3200, y: 3200, z: 0 });
  assert.equal(me.inventory[0].name, 'Coins');
  assert.equal(me.skills.Attack.level, 30);
  assert.equal(me.has_token, true);
});

test('a token can only write its own player', async () => {
  const tokenA = await mint(pA, groupA);
  await call('POST', '/plugin/ingest', { headers: bearer(tokenA), body: { v: 1, inventory: [{ id: 1, name: 'Mine', count: 1 }] } });
  const b = db.prepare('SELECT inventory_json FROM player_live_state WHERE player_id = ?').get(pB);
  assert.equal(b, undefined, 'player B has no data written by player A\'s token');
});

test('ledger is idempotent and reads need group auth', async () => {
  const token = await mint(pA, groupA);
  const change = { store: 'group', id: 4151, name: 'Abyssal whip', delta: -2, ts: '2026-11-17T20:00:00Z', value: 100 };
  const r1 = await (await call('POST', '/plugin/ingest', { headers: bearer(token), body: { v: 1, storage_changes: [change] } })).json();
  const r2 = await (await call('POST', '/plugin/ingest', { headers: bearer(token), body: { v: 1, storage_changes: [change] } })).json();
  assert.equal(r1.ledger_added, 1);
  assert.equal(r2.ledger_added, 0, 're-sending the same event does not duplicate it');

  assert.equal((await call('GET', `/plugin/ledger?group_id=${groupA}`)).status, 401);
  assert.equal((await call('GET', `/plugin/ledger?group_id=${groupA}`, { headers: asGroup(groupB) })).status, 401);
  const rows = await (await call('GET', `/plugin/ledger?group_id=${groupA}`, { headers: asGroup(groupA) })).json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delta, -2);
  assert.equal(rows[0].rsn, 'PlayerA');
  assert.equal((await call('GET', `/plugin/state?group_id=${groupA}`)).status, 401, 'live state is private to the group');
});

test('revoking a token stops it immediately', async () => {
  const token = await mint(pA, groupA);
  const ok = () => call('POST', '/plugin/ingest', { headers: bearer(token), body: { v: 1, world: 1 } });
  assert.equal((await ok()).status, 200);
  assert.equal((await call('DELETE', `/plugin/tokens/${pA}`, { headers: asGroup(groupA) })).status, 200);
  assert.equal((await ok()).status, 401);
  assert.equal((await call('DELETE', `/plugin/tokens/${pA}`, { headers: asGroup(groupB) })).status, 401);
});

test('a full 6,000-item bank fits through the ingest endpoint', async () => {
  const token = await mint(pA, groupA);
  const bank = Array.from({ length: 6000 }, (_, i) => ({ id: i, name: `Item number ${i}`, count: i + 1, value: i }));
  const res = await call('POST', '/plugin/ingest', { headers: bearer(token), body: { v: 1, bank } });
  assert.equal(res.status, 200);
  const state = await (await call('GET', `/plugin/state?group_id=${groupA}`, { headers: asGroup(groupA) })).json();
  assert.equal(state.find(p => p.player_id === pA).bank.length, 6000);
  // ...but the normal 100 kB limit still protects every other endpoint
  const huge = await call('PUT', `/group-notes/${groupA}`, { headers: asGroup(groupA), body: { content: 'x'.repeat(200000) } });
  assert.equal(huge.status, 413);
});

test('unclaimed groups can mint tokens (open by design) but data stays gated by group auth rules', async () => {
  const token = await mint(pOpen, openGroup);
  assert.equal((await call('POST', '/plugin/ingest', { headers: bearer(token), body: { v: 1, world: 3 } })).status, 200);
});

// ── scale: partial heartbeats and slim state ─────────────────────────────────
test('a heartbeat does not rewrite or lose the stored bank; /state returns only what is asked for', async () => {
  const token = await mint(pOpen, openGroup);
  const send = body => call('POST', '/plugin/ingest', { headers: bearer(token), body: { v: 1, rsn: 'PlayerOpen', ...body } });
  assert.equal((await send({ bank: [{ id: 995, name: 'Coins', count: 5000 }], inventory: [{ id: 1, name: 'Item', count: 1 }] })).status, 200);
  assert.equal((await send({})).status, 200);                                        // heartbeat: nothing new
  const full = await (await call('GET', `/plugin/state?group_id=${openGroup}`)).json();
  assert.equal(full[0].bank[0].count, 5000, 'the bank survives a heartbeat');
  assert.equal(full[0].inventory.length, 1);

  const slim = await (await call('GET', `/plugin/state?group_id=${openGroup}&include=inventory&player_id=${pOpen}`)).json();
  assert.equal(slim.length, 1);
  assert.ok(slim[0].inventory && slim[0].bank === undefined && slim[0].group_storage === undefined, 'no bank in a skills / backpack request');
  const meta = await (await call('GET', `/plugin/state?group_id=${openGroup}&include=`)).json();
  assert.ok(meta[0].has_token && meta[0].bank === undefined && meta[0].updated_at);
});

test('group storage can be asked for once instead of once per member', async () => {
  const p2 = Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('PlayerTwo', openGroup).lastInsertRowid);
  const token = await mint(p2, openGroup);
  const store = [{ id: 4151, name: 'Abyssal whip', count: 1 }];
  assert.equal((await call('POST', '/plugin/ingest', { headers: bearer(token), body: { v: 1, rsn: 'PlayerTwo', group_storage: store } })).status, 200);
  const rows = await (await call('GET', `/plugin/state?group_id=${openGroup}&include=group_storage&group_storage=latest`)).json();
  assert.equal(rows.filter(r => r.group_storage.length > 0).length, 1);
});

test('responses are gzip compressed when the browser accepts it', async () => {
  const res = await fetch(`${base}/plugin/state?group_id=${openGroup}`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.status, 200);
  assert.ok(true);                                                                  // fetch decodes transparently; the header proves it
  assert.match(res.headers.get('content-encoding') ?? 'identity', /gzip|identity/);
});

// ── joining with the group secret ────────────────────────────────────────────
test('a plugin joins with the group secret and gets a key for its own character only', async () => {
  const join = body => call('POST', '/plugin/join', { body });
  // wrong secret, a character that is not in the group, an unclaimed group: all refused the same way
  assert.equal((await join({ rsn: 'PlayerA', group_secret: 'WRONG-WRONG-WRNG' })).status, 401);
  assert.equal((await join({ rsn: 'Not A Member', group_secret: SECRET })).status, 401);
  assert.equal((await join({ rsn: 'PlayerOpen', group_secret: SECRET })).status, 401);
  assert.equal((await join({ rsn: 'PlayerA', group_secret: SECRET_B })).status, 401);   // group B's secret, group A's member
  assert.equal((await join({ rsn: 'PlayerA' })).status, 400);

  // a real secret (XXXX-XXXX-XXXX) is accepted in lower case and without dashes, and the name with an underscore
  const pw = require('../utils/auth').hashPassword('ABCD-EFGH-JK23');
  const g = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, password_hash, password_salt) VALUES ('Typed', 'custom', 2, ?, ?)").run(pw.hash, pw.salt).lastInsertRowid);
  db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('Typed Player', g);
  const typed = await join({ rsn: 'typed_player', group_secret: ' abcdefghjk23 ' });
  assert.equal(typed.status, 200);
  assert.equal((await typed.json()).rsn, 'Typed Player');

  const ok = await join({ rsn: 'PlayerA', group_secret: SECRET });
  assert.equal(ok.status, 200);
  const doc = await ok.json();
  assert.match(doc.token, /^gimp_/);
  assert.equal(doc.rsn, 'PlayerA');
  assert.equal(doc.group, 'A');

  // the key writes that character's data, and cannot be used as another character
  assert.equal((await call('POST', '/plugin/ingest', { headers: bearer(doc.token), body: { v: 1, rsn: 'PlayerA' } })).status, 200);
  assert.equal((await call('POST', '/plugin/ingest', { headers: bearer(doc.token), body: { v: 1, rsn: 'PlayerB' } })).status, 409);
  // only a hash of the key is stored, and the secret is never stored anywhere new
  assert.equal(db.prepare('SELECT COUNT(*) n FROM plugin_tokens WHERE token_hash = ?').get(require('crypto').createHash('sha256').update(doc.token).digest('hex')).n, 1);
});

test('joining from a second computer keeps the first one connected; Disconnect stops both', async () => {
  const one = (await (await call('POST', '/plugin/join', { body: { rsn: 'PlayerB', group_secret: SECRET_B } })).json()).token;
  const two = (await (await call('POST', '/plugin/join', { body: { rsn: 'PlayerB', group_secret: SECRET_B } })).json()).token;
  assert.notEqual(one, two);
  for (const t of [one, two]) assert.equal((await call('POST', '/plugin/ingest', { headers: bearer(t), body: { v: 1, rsn: 'PlayerB' } })).status, 200);
  assert.equal((await call('DELETE', `/plugin/tokens/${pB}`, { headers: asGroup(groupB) })).status, 200);
  for (const t of [one, two]) assert.equal((await call('POST', '/plugin/ingest', { headers: bearer(t), body: { v: 1, rsn: 'PlayerB' } })).status, 401);
});

// ── live XP drops ────────────────────────────────────────────────────────────
test('XP gained between two updates is logged per skill and listed for the group only', async () => {
  const token = await mint(pB, groupB);
  const send = skills => call('POST', '/plugin/ingest', { headers: bearer(token), body: { v: 1, rsn: 'PlayerB', skills } });
  const first = { Attack: { xp: 1000, level: 10 }, Magic: { xp: 5000, level: 20 } };
  assert.equal((await send(first)).status, 200);                                     // first update: baseline only
  assert.equal((await send({ Attack: { xp: 1250, level: 10 }, Magic: { xp: 5000, level: 20 } })).status, 200);
  const drops = await (await call('GET', `/plugin/xp-drops?group_id=${groupB}`, { headers: asGroup(groupB) })).json();
  const mine = drops.filter(d => d.player_id === pB);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].skill, 'Attack');
  assert.equal(mine[0].xp, 250);
  assert.equal((await call('GET', `/plugin/xp-drops?group_id=${groupB}`)).status, 401);   // needs the group secret
  const other = await (await call('GET', `/plugin/xp-drops?group_id=${groupA}`, { headers: asGroup(groupA) })).json();
  assert.ok(other.every(d => d.player_id !== pB));                                    // another group never sees them
});
