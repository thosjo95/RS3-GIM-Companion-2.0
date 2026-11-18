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

  // 1. logged in, bank closed: the first snapshot goes out after the settle delay
  dostr('TICK(10)');
  check(captured.length === 1, 'first snapshot sent shortly after start');
  const s1 = JSON.parse(captured[0].body);
  check(captured[0].path === '/api/plugin/ingest' && captured[0].auth === 'Bearer ' + token && captured[0].ctype === 'application/json', 'correct path, bearer token and content type');
  check(s1.v === 1 && s1.rsn === 'LuaPlayer', 'payload names the character it came from');
  check(s1.skills.Constitution.xp === 4000 && s1.skills.Runecrafting.level === 30, 'skills read (HITPOINTS / RUNECRAFTING)');
  const coins = s1.inventory.find(i => i.id === 995), shark = s1.inventory.find(i => i.id === 385);
  check(coins.count === 150 && shark.count === 2 && s1.inventory.length === 2 && coins.name === 'Coins', 'duplicate backpack slots merged; names from item definitions');
  check(s1.equipment.length === 1 && s1.equipment[0].id === 4151, 'worn items read');
  check(s1.bank === undefined && s1.position.x === 3200 && s1.position.y === 3201 && s1.position.z === 0, 'bank omitted while closed; position from map-square + local coordinates');

  // 2. bank and group storage open: baselines only, no ledger entries
  dostr('BANK_OPEN = true; GROUP_OPEN = true; FIRE("InventoryUpdated", {}); TICK(5)');
  const s2 = JSON.parse(captured[1].body);
  check(s2.bank.length === 2 && s2.storage_changes === undefined, 'bank sent when opened; first look is a baseline (no ledger)');

  // 3. deposit sharks, withdraw the whip, add runes to group storage
  dostr('BANK_STATE = { { id = 995, count = 5000 }, { id = 385, count = 10 } }; GROUP_STATE = { { id = 560, count = 150 } }; FIRE("InventoryUpdated", {}); TICK(5)');
  const s3 = JSON.parse(captured[2].body);
  const key = c => c.store + ':' + c.id;
  const ch = Object.fromEntries((s3.storage_changes || []).map(c => [key(c), c]));
  check(ch['bank:385']?.delta === 10 && ch['bank:4151']?.delta === -1 && !ch['bank:995'], 'bank deposit (+10 shark) and withdrawal (-1 whip) detected; unchanged coins ignored');
  check(ch['group:560']?.delta === 50, 'group storage change detected as store "group"');

  // 4. a failed send must not lose changes: same change is sent again until the server confirms
  dostr('HTTP_STATUS = 500; BANK_STATE = { { id = 995, count = 6000 }, { id = 385, count = 10 } }; FIRE("InventoryUpdated", {}); TICK(5)');
  const failedAt = captured.length;
  dostr('HTTP_STATUS = 200; FIRE("InventoryUpdated", {}); TICK(5)');
  const retried = JSON.parse(captured[captured.length - 1].body);
  check(captured.length > failedAt && (retried.storage_changes || []).some(c => c.id === 995 && c.delta === 1000), 'after a failed send the coin deposit (+1000) is sent again');
  const afterOk = captured.length;
  dostr('TICK(5)');
  check(captured.length === afterOk, 'no repeat once the server confirmed (baseline advanced)');

  // 5. heartbeat keeps the dashboard live even when nothing changes
  dostr('TICK(60)');
  check(captured.length > afterOk, 'heartbeat sends without any inventory event');

  // 6. rejected token stops sending instead of hammering the server
  dostr('HTTP_STATUS = 409; TICK(60)');
  const stoppedAt = captured.length;
  dostr('HTTP_STATUS = 200; TICK(120)');
  check(captured.length === stoppedAt, 'plugin stops after a 401/409 rejection');

  // ── everything the Lua produced is accepted by the real server ──
  let accepted = 0;
  for (const c of captured) {
    const res = await fetch(base + '/plugin/ingest', { method: 'POST', headers: { Authorization: c.auth, 'Content-Type': c.ctype }, body: c.body });
    if (res.status === 200) accepted++; else console.log('   server said', res.status, JSON.stringify(await res.json()));
  }
  check(accepted === captured.length, `server accepted all ${captured.length} snapshots`);
  const state = (await (await fetch(`${base}/plugin/state?group_id=${gid}`, { headers: gh })).json())[0];
  check(state.skills.Attack.level === 10 && state.inventory.length === 2 && state.bank.length === 2 && state.position.y === 3201, 'live state stored (skills, backpack, bank, position)');
  const ledger = await (await fetch(`${base}/plugin/ledger?group_id=${gid}`, { headers: gh })).json();
  check(ledger.some(l => l.item_name === 'Shark' && l.delta === 10 && l.store === 'bank') && ledger.some(l => l.item_name === 'Abyssal whip' && l.delta === -1)
    && ledger.some(l => l.store === 'group' && l.item_name === 'Death rune' && l.delta === 50), 'ledger rows stored with names, signs and store');

  // a token used by the wrong character is refused by the server
  const wrong = JSON.parse(captured[0].body); wrong.rsn = 'Someone Else';
  const rej = await fetch(base + '/plugin/ingest', { method: 'POST', headers: { Authorization: captured[0].auth, 'Content-Type': 'application/json' }, body: JSON.stringify(wrong) });
  check(rej.status === 409, 'server refuses data from a different character (HTTP 409)');

  server.kill();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); server.kill(); process.exit(1); });
