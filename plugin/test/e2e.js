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
const server = spawn(process.execPath, ['index.js'], { cwd: REPO + 'server', env: { ...process.env, PORT, GIM_DROP_THRESHOLD: '100000' }, stdio: 'ignore' });
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
  fn('CAPTURE_GET', () => 0);
  lua.lua_pushstring(L, to_luastring(token)); lua.lua_setglobal(L, to_luastring('TOKEN'));
  lua.lua_pushstring(L, to_luastring(path.join(REPO, 'plugin', 'gim-companion').split(path.sep).join('/'))); lua.lua_setglobal(L, to_luastring('PLUGIN_DIR'));
  const dofile = f => { if (lauxlib.luaL_dofile(L, to_luastring(f))) throw new Error(f + ': ' + to_jsstring(lua.lua_tostring(L, -1))); };
  const dostr  = s => { if (lauxlib.luaL_dostring(L, to_luastring(s))) throw new Error(to_jsstring(lua.lua_tostring(L, -1))); };

  dofile(path.join(__dirname, 'mock.lua'));
  dofile(path.join(REPO, 'plugin', 'gim-companion', 'main.lua'));

  // The group's drop rules, exactly as the real server serves them (a boss drop table names a cheap rare item).
  db.prepare("INSERT INTO rs3_bosses (id, name, drops) VALUES ('araxxor', 'Araxxor', ?)").run(JSON.stringify([{ name: 'Armadyl hilt (1/100)' }]));
  const cfgRes = await fetch(base + '/plugin/config', { headers: { Authorization: 'Bearer ' + token } });
  const cfg = await cfgRes.json();
  check(cfgRes.status === 200 && cfg.drop_threshold === 100000 && cfg.rare_names.includes('armadyl hilt'), 'server serves drop rules (threshold + rare names from boss drop tables)');
  check((await fetch(base + '/plugin/config')).status === 401, 'drop rules need a token');
  lua.lua_pushstring(L, to_luastring(JSON.stringify(cfg))); lua.lua_setglobal(L, to_luastring('CONFIG_BODY'));

  // quest goals the group is working on
  const addGoal = t => Number(db.prepare("INSERT INTO goals (owner_id, title, category, status) VALUES (?, ?, 'quest', 'not_started')").run(pid, t).lastInsertRowid);
  const goalDemon = addGoal('Demon Slayer'), goalCook = addGoal("Cook's Assistant");
  const goalStatus = id => db.prepare('SELECT status FROM goals WHERE id = ?').get(id).status;

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
  check(s1.quests_full === true && s1.quests.length === 3 && s1.quests.find(q => q.name === 'Demon Slayer').state === 'started'
    && s1.quests.find(q => q.name === "Cook's Assistant").state === 'finished', 'quest baseline: all quests with name and state');

  // 2. bank and group storage open: baselines only, no ledger entries
  dostr('BANK_OPEN = true; GROUP_OPEN = true; FIRE("InventoryUpdated", {}); TICK(5)');
  const s2 = JSON.parse(captured[1].body);
  check(s2.bank.length === 2 && s2.storage_changes === undefined, 'bank sent when opened; first look is a baseline (no ledger)');
  check(s2.quests === undefined, 'unchanged quests are not sent again');

  // 3. deposit sharks, withdraw the whip, add runes to group storage
  dostr('BANK_STATE = { { id = 995, count = 5000 }, { id = 385, count = 10 } }; GROUP_STATE = { { id = 560, count = 150 } }; FIRE("InventoryUpdated", {}); TICK(5)');
  const s3 = JSON.parse(captured[2].body);
  const key = c => c.store + ':' + c.id;
  const ch = Object.fromEntries((s3.storage_changes || []).map(c => [key(c), c]));
  check(!Object.keys(ch).some(k => k.startsWith('bank:')), 'a member\'s own bank movements are not journalled (the Bank Journal is for the group storage only)');
  check(ch['group:560']?.delta === 50, 'group storage change detected as store "group"');
  dostr('BANK_OPEN = false; GROUP_OPEN = false');

  // 4. a failed send must not lose changes: same change is sent again until the server confirms
  dostr('GROUP_OPEN = true; HTTP_STATUS = 500; GROUP_STATE = { { id = 560, count = 250 } }; FIRE("InventoryUpdated", {}); TICK(5)');
  const failedAt = captured.length;
  dostr('HTTP_STATUS = 200; FIRE("InventoryUpdated", {}); TICK(5)');
  const retried = JSON.parse(captured[captured.length - 1].body);
  check(captured.length > failedAt && (retried.storage_changes || []).some(c => c.id === 560 && c.delta === 100), 'after a failed send the group storage deposit (+100 runes) is sent again');
  const afterOk = captured.length;
  dostr('TICK(5)');
  check(captured.length === afterOk, 'no repeat once the server confirmed (baseline advanced)');
  dostr('GROUP_OPEN = false');

  // 5. quest progress: finishing Demon Slayer completes the group's goal; the baseline did not complete Cook's Assistant
  check(goalStatus(goalDemon) === 'not_started' && goalStatus(goalCook) === 'not_started', 'goals untouched before the replay');
  dostr('QUESTS[1].hasFinishedQuest = true; TICK(110)');
  const qSend = captured.slice(afterOk).map(c => JSON.parse(c.body)).find(b => b.quests);
  check(qSend && qSend.quests.length === 1 && qSend.quests[0].name === 'Demon Slayer' && qSend.quests[0].state === 'finished' && !qSend.quests_full, 'only the changed quest is sent, without the baseline flag');

  // 5b. achievements / area tasks: the baseline sends only COMPLETED ones; a later completion is sent on its own
  const achBaseline = captured.map(c => JSON.parse(c.body)).find(b => b.achievements);
  check(achBaseline && achBaseline.achievements_full === true && achBaseline.achievements.length === 2
    && achBaseline.achievements.every(a => a.id === 10 || a.id === 12) && achBaseline.achievements[0].name.includes('Tasks'),
    'achievement baseline: only completed achievements, with names and categories');
  dostr('ACHS[11].progress = -2; TICK(620)');
  const achLater = captured.map(c => JSON.parse(c.body)).filter(b => b.achievements).pop();
  check(achLater.achievements.length === 1 && achLater.achievements[0].id === 11 && !achLater.achievements_full, 'a newly completed achievement is sent on its own, without the baseline flag');

  // 6. kills and drops
  //    a) not our kill: a monster we are not fighting, and our target dying far away, are not counted
  dostr('TARGET_NAME = "Araxxor"; TARGET_HP = "1000"; TICK(2); TARGET_HP = "500"; TICK(2)');
  const sizeBeforeKills = captured.length;
  dostr('FIRE("NPCEntityRemoved", { npcEntity = { displayName = "Cow", coordGrid = { mapSquareX = 50, localX = 2, mapSquareZ = 50, localZ = 3, level = 0 } } })');
  dostr('FIRE("NPCEntityRemoved", { npcEntity = { displayName = "Araxxor", coordGrid = { mapSquareX = 60, localX = 2, mapSquareZ = 50, localZ = 3, level = 0 } } })');
  dostr('TICK(60)');
  check(captured.slice(sizeBeforeKills).every(c => !JSON.parse(c.body).kills), 'a different monster, or one far away, is not counted as a kill');
  //    b) our kill, with two drops: a valuable one and a cheap one named in the boss drop table, plus a cheap junk one
  dostr('TARGET_HP = "300"; TICK(2)');
  const killNpc = 'FIRE("NPCEntityRemoved", { npcEntity = { displayName = "Araxxor", coordGrid = { mapSquareX = 50, localX = 2, mapSquareZ = 50, localZ = 3, level = 0 } } })';
  const ground = (objId, n, owner) => `FIRE("ObjStackEntityAdded", { objType = { id = ${objId} }, count = ${n}, isOwner = ${owner}, coordGrid = { mapSquareX = 50, localX = 3, mapSquareZ = 50, localZ = 3, level = 0 } })`;
  dostr(killNpc + '; ' + ground(4151, 1, true) + '; ' + ground(11702, 1, true) + '; ' + ground(385, 2, true) + '; ' + ground(4151, 1, false));
  dostr('HTTP_STATUS = 500; TICK(6)');                                     // a failed send must keep the kill and the drops
  const failedKillSend = JSON.parse(captured[captured.length - 1].body);
  dostr('HTTP_STATUS = 200; TICK(60)');
  const okKillSend = captured.slice(captured.indexOf(captured.find(c => c.body === captured[captured.length - 1].body))).map(c => JSON.parse(c.body)).find(b => b.kills);
  check(failedKillSend.kills?.[0]?.npc === 'Araxxor' && failedKillSend.kills[0].kills === 1, 'the kill is reported with the monster name');
  check(failedKillSend.drops?.length === 2 && failedKillSend.drops.some(d => d.name === 'Abyssal whip') && failedKillSend.drops.some(d => d.name === 'Armadyl hilt')
    && failedKillSend.drops.every(d => d.npc === 'Araxxor' && d.ref.length >= 4), 'valuable and rare-listed drops reported; cheap loot and items not owned by us are not');
  const retriedKills = captured.map(c => JSON.parse(c.body)).filter(b => b.kills);
  check(retriedKills.length >= 2 && JSON.stringify(retriedKills[1].drops) === JSON.stringify(retriedKills[0].drops), 'after a failed send the same drops (same refs) are sent again');
  const lastKillIdx = captured.map(c => JSON.parse(c.body)).map(b => !!b.kills).lastIndexOf(true);
  dostr('TICK(60)');
  check(captured.map(c => JSON.parse(c.body)).map(b => !!b.kills).lastIndexOf(true) === lastKillIdx, 'confirmed kills and drops are not sent again');
  //    c) auto-loot straight into the backpack after another kill
  dostr('TARGET_HP = "100"; TICK(2)');
  dostr(killNpc + '; INV_EXTRA = { { id = 560, count = 600 } }; FIRE("InventoryUpdated", {}); TICK(10)');
  const lootSend = captured.map(c => JSON.parse(c.body)).filter(b => b.drops && b.drops.some(d => d.name === 'Death rune'));
  check(lootSend.length >= 1 && lootSend[0].drops.find(d => d.name === 'Death rune').quantity === 600, 'auto-loot that lands in the backpack after a kill is reported too');
  dostr('INV_EXTRA = {}');

  //    d) loot that appears on the ground BEFORE the game announces the monster's removal
  dostr('TARGET_HP = "40"; TICK(2)');
  dostr(ground(4151, 1, true) + '; TICK(3)');
  const wallBefore = captured.map(c => JSON.parse(c.body)).flatMap(b => (b.drops || []).filter(d => d.name === 'Abyssal whip')).length;
  dostr(killNpc + '; TICK(8)');
  const whips = new Set(captured.map(c => JSON.parse(c.body)).flatMap(b => (b.drops || []).filter(d => d.name === 'Abyssal whip').map(d => d.ref)));
  check(whips.size === 2, 'loot seen before its kill was registered is still matched to the kill');

  // 7. heartbeat keeps the dashboard live even when nothing changes
  const beforeHeartbeat = captured.length;
  dostr('TICK(60)');
  check(captured.length > beforeHeartbeat, 'heartbeat sends without any inventory event');

  // 8. rejected token stops sending instead of hammering the server
  dostr('HTTP_STATUS = 409; TICK(60)');
  const stoppedAt = captured.length;
  dostr('HTTP_STATUS = 200; TICK(120)');
  check(captured.length === stoppedAt, 'plugin stops after a 401/409 rejection');

  // ── everything the Lua produced is accepted by the real server (including the retried duplicates) ──
  let accepted = 0;
  for (const c of captured) {
    const res = await fetch(base + '/plugin/ingest', { method: 'POST', headers: { Authorization: c.auth, 'Content-Type': c.ctype }, body: c.body });
    if (res.status === 200) accepted++; else console.log('   server said', res.status, JSON.stringify(await res.json()));
  }
  check(accepted === captured.length, `server accepted all ${captured.length} snapshots`);
  const state = (await (await fetch(`${base}/plugin/state?group_id=${gid}`, { headers: gh })).json())[0];
  check(state.skills.Attack.level === 10 && state.inventory.length >= 2 && state.position.y === 3201, 'live state stored (skills, backpack, position)');
  check(state.group_storage.length === 1 && state.group_storage[0].name === 'Death rune' && state.group_storage[0].count === 250 && !!state.group_storage_at, 'group storage contents stored and returned (not just its changes)');
  const ledger = await (await fetch(`${base}/plugin/ledger?group_id=${gid}`, { headers: gh })).json();
  check(ledger.length === 2 && ledger.every(l => l.store === 'group') && ledger.some(l => l.item_name === 'Death rune' && l.delta === 50) && ledger.some(l => l.item_name === 'Death rune' && l.delta === 100),
    'Bank Journal rows stored for the group storage only, with names and signs');
  check(ledger.filter(l => l.delta === 100).length === 1 && ledger.filter(l => l.delta === 50).length === 1,
    'a deposit that was sent twice (failed attempt + retry, then replayed) is in the ledger exactly once');

  const quests = await (await fetch(`${base}/plugin/quests?group_id=${gid}`, { headers: gh })).json();
  check(quests.length === 3 && quests.find(q => q.name === 'Demon Slayer').state === 'finished', 'quest progress stored and readable');
  check(goalStatus(goalDemon) === 'complete', 'finishing a quest completes the matching goal');
  check(goalStatus(goalCook) === 'not_started', 'a quest that was already finished at the baseline does not complete goals');
  check(!quests.some(q => q.name === 'Old Cooking Quest'), 'deprecated quests are not sent');
  // a new full baseline that no longer lists a quest removes the stale row
  const pruneRes = await fetch(base + '/plugin/ingest', { method: 'POST', headers: { Authorization: captured[0].auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, rsn: 'LuaPlayer', quests_full: true, quests: [{ id: 0, name: "Cook's Assistant", state: 'finished' }, { id: 1, name: 'Demon Slayer', state: 'finished' }] }) });
  const afterPrune = await (await fetch(`${base}/plugin/quests?group_id=${gid}`, { headers: gh })).json();
  check(pruneRes.status === 200 && afterPrune.length === 2 && !afterPrune.some(q => q.name === 'Dragon Slayer'), 'a full quest baseline removes quests the plugin no longer lists');

  const drops = db.prepare("SELECT item_name, boss_name, quantity, source FROM drops WHERE player_id = ?").all(pid);
  const distinctRefs = new Set(captured.map(c => JSON.parse(c.body)).flatMap(b => (b.drops || []).map(d => d.ref)));
  check(drops.length === distinctRefs.size && drops.length === 4 && drops.every(d => d.source === 'plugin') && drops.every(d => d.boss_name === 'Araxxor'),
    `drops logged once each despite retries and replays (${drops.length} rows for ${distinctRefs.size} drops)`);

  const achRows = await (await fetch(`${base}/plugin/achievements?group_id=${gid}`, { headers: gh })).json();
  const byId = Object.fromEntries(achRows.map(a => [a.achievement_id, a]));
  check(achRows.length === 3 && byId[10].completed_at === null && byId[12].completed_at === null && byId[11].completed_at !== null && byId[11].category === 5,
    'achievements stored: baseline ones have no completion time, the later one does');

  const npcKills = await (await fetch(`${base}/plugin/kills?group_id=${gid}`, { headers: gh })).json();
  check(npcKills.length === 1 && npcKills[0].npc === 'Araxxor' && npcKills[0].kills === 3, 'kills counted once per real kill (replay of retried sends does not double them)');
  const boss = (await (await fetch(`${base}/boss-kills?group_id=${gid}`)).json()).find(b => b.boss_key === 'araxxor');
  check(boss && boss.kills === 3 && boss.plugin_kills === 3 && boss.source === 'plugin', 'boss kill view shows the plugin count for the matching boss');

  // a token used by the wrong character is refused by the server
  const wrong = JSON.parse(captured[0].body); wrong.rsn = 'Someone Else';
  const rej = await fetch(base + '/plugin/ingest', { method: 'POST', headers: { Authorization: captured[0].auth, 'Content-Type': 'application/json' }, body: JSON.stringify(wrong) });
  check(rej.status === 409, 'server refuses data from a different character (HTTP 409)');

  server.kill();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); server.kill(); process.exit(1); });
