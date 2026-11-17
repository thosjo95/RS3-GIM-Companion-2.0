// Lua plugin (main.lua, mocked game API) -> real server ingest -> database.
// Run: npm install --prefix plugin && npm test --prefix plugin
// Proves the plugin logic and wire format. It can NOT prove the real RuneScape API names — that needs the beta client.
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const REPO = path.join(__dirname, '..', '..') + path.sep;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-lua-'));
process.env.GIM_DATA_DIR = dataDir;
const db = require(REPO + 'server/database');
const { hashPassword } = require(REPO + 'server/utils/auth');
const pw = hashPassword('LUA-TEST-SECRET');
const gid = Number(db.prepare("INSERT INTO groups (name,gim_type,gim_size,password_hash,password_salt) VALUES ('LuaGroup','custom',1,?,?)").run(pw.hash, pw.salt).lastInsertRowid);
const pid = Number(db.prepare('INSERT INTO players (rsn,group_id) VALUES (?,?)').run('LuaPlayer', gid).lastInsertRowid);

const PORT = 3985;
const server = spawn(process.execPath, ['index.js'], { cwd: REPO + 'server', env: { ...process.env, PORT }, stdio: 'ignore' });
const base = `http://localhost:${PORT}/api`;
let failures = 0;
const check = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) failures++; };

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 150)); }
  const gh = { 'X-Group-Id': String(gid), 'X-Group-Password': 'LUA-TEST-SECRET', 'Content-Type': 'application/json' };
  const token = (await (await fetch(base + '/plugin/tokens', { method: 'POST', headers: gh, body: JSON.stringify({ player_id: pid }) })).json()).token;

  // ── set up the Lua VM with the mocked game API ──
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  const captured = [];
  const fn = (name, impl) => { lua.lua_pushjsfunction(L, impl); lua.lua_setglobal(L, to_luastring(name)); };
  fn('print', L => { const n = lua.lua_gettop(L), p = []; for (let i = 1; i <= n; i++) p.push(to_jsstring(lauxlib.luaL_tolstring(L, i))); console.log('   [lua]', p.join(' ')); return 0; });
  fn('CAPTURE', L => { captured.push({ path: to_jsstring(lua.lua_tostring(L, 1)), auth: to_jsstring(lua.lua_tostring(L, 2)), ctype: to_jsstring(lua.lua_tostring(L, 3)), body: to_jsstring(lua.lua_tostring(L, 4)) }); return 0; });
  lua.lua_pushstring(L, to_luastring(token)); lua.lua_setglobal(L, to_luastring('TOKEN'));
  lua.lua_pushstring(L, to_luastring(path.join(REPO, 'plugin', 'gim-companion').split(path.sep).join('/'))); lua.lua_setglobal(L, to_luastring('PLUGIN_DIR'));
  const dofile = f => { if (lauxlib.luaL_dofile(L, to_luastring(f))) throw new Error(f + ': ' + to_jsstring(lua.lua_tostring(L, -1))); };
  const dostr  = s => { if (lauxlib.luaL_dostring(L, to_luastring(s))) throw new Error(to_jsstring(lua.lua_tostring(L, -1))); };

  dofile(path.join(__dirname, 'mock.lua'));
  dofile(path.join(REPO, 'plugin', 'gim-companion', 'main.lua'));

  // tick 1: bank closed -> backpack/skills/position only
  dostr('BANK_OPEN = false; TICK(50)');
  check(captured.length === 1, 'first snapshot sent after 50 ticks');
  const s1 = JSON.parse(captured[0].body);
  check(captured[0].path === '/api/plugin/ingest' && captured[0].auth === 'Bearer ' + token && captured[0].ctype === 'application/json', 'correct path, bearer token and content type');
  check(s1.v === 1 && s1.skills.Constitution.xp === 4000 && s1.skills.Runecrafting.level === 30, 'skills read, HITPOINTS/RUNECRAFT spelling fallbacks worked');
  const coins = s1.inventory.find(i => i.id === 995), shark = s1.inventory.find(i => i.id === 385);
  check(coins.count === 150 && shark.count === 2 && s1.inventory.length === 2, 'duplicate backpack slots merged per item');
  check(s1.bank === undefined && s1.position.x === 3200, 'bank omitted while closed; position included');

  // tick 2: bank opens (baseline, no ledger yet)
  dostr('BANK_OPEN = true; TICK(50)');
  check(JSON.parse(captured[1].body).bank.length === 2 && JSON.parse(captured[1].body).storage_changes === undefined, 'bank sent on open; no ledger entries for the baseline');

  // tick 3: deposit 10 sharks + withdraw the whip
  dostr('BANK_STATE = { { id = 995, name = "Coins", cost = 1, count = 5000 }, { id = 385, name = "Shark", cost = 800, count = 10 } }; TICK(50)');
  const s3 = JSON.parse(captured[2].body);
  const byId = Object.fromEntries((s3.storage_changes || []).map(c => [c.id, c]));
  check(byId[385]?.delta === 10 && byId[4151]?.delta === -1 && !byId[995], 'deposit (+10 shark) and withdrawal (-1 whip) detected, unchanged coins ignored');

  // ── everything the Lua produced is accepted by the real server ──
  for (const c of captured) {
    const res = await fetch(base + '/plugin/ingest', { method: 'POST', headers: { Authorization: c.auth, 'Content-Type': c.ctype }, body: c.body });
    check(res.status === 200, `server accepted snapshot (HTTP ${res.status}${res.status !== 200 ? ' ' + JSON.stringify(await res.json()) : ''})`);
  }
  const state = (await (await fetch(`${base}/plugin/state?group_id=${gid}`, { headers: gh })).json())[0];
  check(state.skills.Attack.level === 10 && state.inventory.length === 2 && state.bank.length === 2 && state.position.y === 3201, 'live state stored (skills, backpack, bank, position)');
  const ledger = await (await fetch(`${base}/plugin/ledger?group_id=${gid}`, { headers: gh })).json();
  check(ledger.length === 2 && ledger.some(l => l.item_name === 'Shark' && l.delta === 10) && ledger.some(l => l.item_name === 'Abyssal whip' && l.delta === -1), 'ledger rows stored with names and signs');

  server.kill();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); server.kill(); process.exit(1); });
