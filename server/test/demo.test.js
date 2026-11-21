// The demo group: built from the template, readable by everyone, never writable, never synced, and it moves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-demo-'));
process.env.GIM_DATA_DIR = dataDir;
const db = require('../database');
const demo = require('../services/demoGroup');

const PORT = 3990 + Math.floor(Math.random() * 9);
const base = `http://localhost:${PORT}/api`;
let server, gid, players;
const call = (method, p, body) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: body && JSON.stringify(body) });   // a fresh connection each time: a slow test must not reuse one the server has closed

test.before(async () => {
  const r = demo.createDemoGroup(require('../services/demoTemplate.json'));
  gid = r.gid; players = r.players;
  server = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT }, stdio: process.env.GIM_TEST_LOGS ? 'inherit' : 'ignore' });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error('server did not start');
});
test.after(() => { server?.kill(); });

test('the demo group exists with five members and is marked as a demo', async () => {
  const g = await (await call('GET', `/groups/${gid}`)).json();
  assert.equal(g.is_demo, 1);
  assert.match(g.name, /Demo/);
  assert.equal(g.players.length, 5);
});

test('everyone can read it without a secret, nobody can write to it', async () => {
  assert.equal((await call('GET', `/plugin/presence?group_id=${gid}`)).status, 200);
  assert.equal((await call('POST', `/groups/${gid}/verify`)).status, 200);
  const write = await call('POST', '/players', { group_id: gid, rsn: 'Some Intruder' });
  assert.equal(write.status, 403);
  assert.equal((await write.json()).demo, true);
  assert.equal((await call('POST', `/groups/${gid}/claim`)).status, 409);                       // cannot be claimed
  assert.equal((await call('POST', `/groups/${gid}/claim-v2`, { old_secret: 'x' })).status, 409);
  const join = await call('POST', '/plugin/join', { rsn: 'Varrock Vee', group_secret: 'AAAA-BBBB-CCCC' });
  assert.equal(join.status, 401);                                                                // the plugin cannot join it
  assert.equal(db.prepare('SELECT COUNT(*) n FROM players WHERE group_id = ?').get(gid).n, 5);
});

test('the public sync endpoints leave it alone (they would look made-up names up on the real hiscores)', async () => {
  const before = db.prepare('SELECT COUNT(*) n FROM skills WHERE player_id = ?').get(players[0]).n;
  assert.equal((await (await call('POST', `/players/${players[0]}/sync`)).json()).demo, true);
  assert.equal((await (await call('POST', `/players/sync-all/${gid}`)).json()).demo, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM skills WHERE player_id = ?').get(players[0]).n, before);
  db.prepare('UPDATE groups SET last_activity = CURRENT_TIMESTAMP WHERE id = ?').run(gid);
  const { activePlayers } = require('../services/hiscoresSync');
  if (activePlayers) assert.equal(activePlayers().filter(p => p.group_id === gid).length, 0);
});

test('the feeder makes things happen: XP drops and online players', () => {
  const xp0 = db.prepare('SELECT COUNT(*) n FROM xp_drops WHERE player_id IN (SELECT id FROM players WHERE group_id = ?)').get(gid).n;
  const boss0 = db.prepare('SELECT SUM(kills) n FROM player_boss_kills WHERE player_id IN (SELECT id FROM players WHERE group_id = ?)').get(gid).n;
  for (let i = 0; i < 60; i++) demo.feedOnce(new Date());
  const xp1 = db.prepare('SELECT COUNT(*) n FROM xp_drops WHERE player_id IN (SELECT id FROM players WHERE group_id = ?)').get(gid).n;
  const boss1 = db.prepare('SELECT SUM(kills) n FROM player_boss_kills WHERE player_id IN (SELECT id FROM players WHERE group_id = ?)').get(gid).n;
  assert.ok(xp1 > xp0, 'new XP drops appear');
  assert.ok(boss1 >= boss0);
  const recent = db.prepare("SELECT COUNT(*) n FROM player_live_state WHERE player_id IN (SELECT id FROM players WHERE group_id = ?) AND updated_at >= ?").get(gid, new Date(Date.now() - 60_000).toISOString()).n;
  assert.ok(recent >= 3, 'at least three members are online');
});

test('building it again replaces the old demo group', () => {
  demo.createDemoGroup(require('../services/demoTemplate.json'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM groups WHERE is_demo = 1').get().n, 1);
});

test('the demo group comes first when browsing and when searching', async () => {
  const id = db.prepare('SELECT id FROM groups WHERE is_demo = 1').get().id;
  const browse = await (await call('GET', '/groups/search?limit=5')).json();
  assert.equal(browse[0].id, id);
  const found = await (await call('GET', '/groups/search?name=Misthalin')).json();
  assert.equal(found[0].id, id);
});

test('backpacks hold only stackable items in amounts above 1, also after the feeder has been running', () => {
  const STACK_OK = new Set([995, 560, 561, 563, 565, 566, 9075, 314]);
  const template = require('../services/demoTemplate.json');
  for (const x of template.inventory) if (x.count > 1) STACK_OK.add(x.id);          // the real template backpack shows these stacked
  for (let i = 0; i < 100; i++) demo.feedOnce(new Date());
  const rows = db.prepare('SELECT inventory_json FROM player_live_state WHERE player_id IN (SELECT id FROM players WHERE group_id IN (SELECT id FROM groups WHERE is_demo = 1))').all();
  for (const r of rows) for (const x of JSON.parse(r.inventory_json)) {
    if (x.count > 1 && !x.note_of) assert.ok(STACK_OK.has(x.id), `${x.name} (${x.id}) cannot stack ${x.count} in a backpack`);
  }
});

test('a stackable item is never in two backpack slots', () => {
  const stackIds = new Set([995, 560, 561, 563, 565, 566, 9075, 314]);
  for (const x of require('../services/demoTemplate.json').inventory) if (x.count > 1) stackIds.add(x.id);
  demo.createDemoGroup(require('../services/demoTemplate.json'));
  const check = () => {
    const rows = db.prepare('SELECT inventory_json FROM player_live_state WHERE player_id IN (SELECT id FROM players WHERE group_id IN (SELECT id FROM groups WHERE is_demo = 1))').all();
    for (const r of rows) {
      const seen = new Set();
      for (const x of JSON.parse(r.inventory_json)) {
        if (!stackIds.has(x.id)) continue;
        assert.ok(!seen.has(x.id), x.name + ' (' + x.id + ') is in two slots');
        seen.add(x.id);
      }
    }
  };
  check();
  for (let i = 0; i < 200; i++) demo.feedOnce(new Date());
  check();
});
