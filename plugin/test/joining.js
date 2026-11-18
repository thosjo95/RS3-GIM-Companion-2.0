// Joining the group with the group secret (mocked game API, no server needed).
// Run: npm test --prefix plugin
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const path = require('path');
const REPO = path.join(__dirname, '..', '..') + path.sep;

let failures = 0;
const check = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) failures++; };

// One fresh Lua state with the mocked game. `configLua` replaces config.lua (nil: no config.lua at all).
function start(configLua, beforeMain) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  const captured = [];
  const fn = (name, impl) => { lua.lua_pushjsfunction(L, impl); lua.lua_setglobal(L, to_luastring(name)); };
  fn('print', L => { const n = lua.lua_gettop(L), p = []; for (let i = 1; i <= n; i++) p.push(to_jsstring(lauxlib.luaL_tolstring(L, i))); console.log('   [lua]', p.join(' ')); return 0; });
  fn('CAPTURE', L => { captured.push({ path: to_jsstring(lua.lua_tostring(L, 1)), auth: lua.lua_isnil(L, 2) ? null : to_jsstring(lua.lua_tostring(L, 2)), body: to_jsstring(lua.lua_tostring(L, 4)) }); return 0; });
  fn('CAPTURE_GET', () => 0);
  lua.lua_pushstring(L, to_luastring(path.join(REPO, 'plugin', 'gim-companion').split(path.sep).join('/'))); lua.lua_setglobal(L, to_luastring('PLUGIN_DIR'));
  const dofile = f => { if (lauxlib.luaL_dofile(L, to_luastring(f))) throw new Error(f + ': ' + to_jsstring(lua.lua_tostring(L, -1))); };
  const dostr = s => { if (lauxlib.luaL_dostring(L, to_luastring(s))) throw new Error(to_jsstring(lua.lua_tostring(L, -1))); };
  const lget = expr => { dostr('__r = ' + expr); lua.lua_getglobal(L, to_luastring('__r')); const v = lua.lua_isnil(L, -1) ? null : lua.lua_isboolean(L, -1) ? !!lua.lua_toboolean(L, -1) : lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : to_jsstring(lua.lua_tostring(L, -1)); lua.lua_pop(L, 1); return v; };
  dofile(path.join(__dirname, 'mock.lua'));
  if (configLua) dostr(`package.preload["config"] = function() return ${configLua} end`);
  else dostr('package.preload["config"] = nil');
  dostr('HTTP_RESPONSES["/api/plugin/join"] = \'{"token":"gimp_JOINEDKEY","rsn":"LuaPlayer","group":"Test Group"}\'');
  // helpers in Lua: find the newest component of a kind, type into the box, press a button by its label
  dostr(`function NEWEST(kind) for i = #UI_LOG.created, 1, -1 do if UI_LOG.created[i].kind == kind then return UI_LOG.created[i] end end end
         function PRESS(label) for i = #UI_LOG.created, 1, -1 do local c = UI_LOG.created[i]; if c.label == label then c.pressed(); return end end end`);
  if (beforeMain) dostr(beforeMain);
  dofile(path.join(REPO, 'plugin', 'gim-companion', 'main.lua'));
  return { captured, dostr, lget, posts: p => captured.filter(c => c.path === p) };
}

// ── 1. No key yet: the window asks for the group secret ───────────────────────
{
  const g = start(null);
  g.dostr('TICK(5)');
  check(g.lget('NEWEST("input") ~= nil'), 'without a key the plugin shows a window with a box for the group secret');
  check(g.lget('NEWEST("input").visibility') === 0, 'the box shows what is typed (the game returns no text from a masked box)');
  check(g.posts('/api/plugin/ingest').length === 0 && g.posts('/api/plugin/join').length === 0, 'nothing is sent before the secret is typed');

  g.dostr('PRESS("Connect") TICK(2)');
  check(g.posts('/api/plugin/join').length === 0, 'Connect with an empty box sends nothing');

  g.dostr('NEWEST("input").content = "  ABCD-EFGH-JK23 " PRESS("Connect") TICK(3)');
  const joins = g.posts('/api/plugin/join');
  check(joins.length === 1 && JSON.parse(joins[0].body).rsn === 'LuaPlayer' && JSON.parse(joins[0].body).group_secret === 'ABCD-EFGH-JK23',
    'Connect sends the character name and the trimmed secret once');
  check(g.lget('STORE["token_luaplayer"]') === 'gimp_JOINEDKEY', 'the key from the server is kept in the persistent store, per character');
  g.dostr('SECRET_STORED = false for k, v in pairs(STORE) do if tostring(v):find("ABCD") then SECRET_STORED = true end end');
  check(g.lget('SECRET_STORED') === false, 'the secret itself is not stored anywhere');
  check(g.lget('UI_LOG.destroyed') >= 1, 'the window goes away');
  g.dostr('TICK(10)');
  const ingest = g.posts('/api/plugin/ingest');
  check(ingest.length >= 1 && ingest[0].auth === 'Bearer gimp_JOINEDKEY', 'updates go out with the new key');

  // a new login: the stored key is used, the window does not come back
  const createdBefore = g.lget('#UI_LOG.created');
  g.dostr('FIRE("GameStateChanged", { newState = GameState.LOBBY }) TICK(15)');
  check(g.lget('#UI_LOG.created') === createdBefore && g.posts('/api/plugin/join').length === 1, 'after a new login the stored key is used (no window, no new join)');
  check(g.captured.filter(c => c.path === '/api/plugin/ingest').pop().auth === 'Bearer gimp_JOINEDKEY', 'and sending continues with it');

  // the group disconnects this plugin: forget the key and ask again
  g.dostr('HTTP_STATUS = 401 TICK(80)');
  check(g.lget('STORE["token_luaplayer"]') === null, 'a refused key is forgotten');
  g.dostr('HTTP_STATUS = 200 TICK(5)');
  check(g.lget('#UI_LOG.created') > createdBefore, 'and the window asks for the secret again');
}

// ── 2. A wrong secret: the window says why and stays ──────────────────────────
{
  const g = start(null);
  g.dostr('HTTP_STATUS = 401 HTTP_RESPONSES["/api/plugin/join"] = \'{"error":"No claimed group with LuaPlayer as a member has that secret."}\'');
  g.dostr('TICK(5) NEWEST("input").content = "WRONG" PRESS("Connect") TICK(3)');
  check(g.lget('STORE["token_luaplayer"]') === null && g.posts('/api/plugin/ingest').length === 0, 'a wrong secret gives no key and sends nothing');
  check(String(g.lget('NEWEST("text").content') || '').includes('Wrong secret'), 'the window shows a short reason (the full one goes to the console)');
  g.dostr('HTTP_STATUS = 200 HTTP_RESPONSES["/api/plugin/join"] = \'{"token":"gimp_SECONDTRY","group":"Test Group"}\'');
  g.dostr('NEWEST("input").content = "ABCD-EFGH-JK23" NEWEST("input").hooks[ui.Hook.ONCONTENTCHANGED](NEWEST("input"), ui.InputFieldActionResult.SUBMIT, "ABCD-EFGH-JK23") TICK(3)');
  check(g.lget('STORE["token_luaplayer"]') === 'gimp_SECONDTRY', 'pressing Enter in the box connects too');
}

// ── 3. Hide: the window stays away until the next login ───────────────────────
{
  const g = start(null);
  g.dostr('TICK(5) PRESS("Hide") TICK(20)');
  const shown = g.lget('#UI_LOG.created');
  check(g.lget('UI_LOG.destroyed') >= 1 && g.posts('/api/plugin/join').length === 0, 'Hide closes the window');
  g.dostr('TICK(50)');
  check(g.lget('#UI_LOG.created') === shown, 'and it does not come back while playing');
}

// ── 4. The secret in config.lua: joins without a window ───────────────────────
{
  const g = start('{ groupSecret = "abcd-efgh-jk23" }');
  g.dostr('TICK(5)');
  check(g.lget('NEWEST("input")') === null, 'with groupSecret in config.lua no window is shown');
  check(g.posts('/api/plugin/join').length === 1 && JSON.parse(g.posts('/api/plugin/join')[0].body).group_secret === 'abcd-efgh-jk23', 'the secret from config.lua is used to join');
  check(g.lget('STORE["token_luaplayer"]') === 'gimp_JOINEDKEY', 'and the key is kept');
}

// ── 5. Network access allowed only after the plugin started: it waits, then starts by itself ──
{
  const g = start(null, 'HTTP_ALLOWED = false');
  g.dostr('TICK(20)');
  check(g.captured.length === 0 && g.lget('NEWEST("input")') === null, 'without network access the plugin sends nothing and shows no window');
  g.dostr('HTTP_ALLOWED = true TICK(5)');
  check(g.lget('NEWEST("input") ~= nil'), 'once network access is allowed it starts by itself (the join window appears)');
  g.dostr('NEWEST("input").content = "ABCD-EFGH-JK23" PRESS("Connect") TICK(10)');
  check(g.posts('/api/plugin/ingest').length >= 1, 'and sends after joining, with no reload');
  g.dostr('HTTP_ALLOWED = false');
  const before = g.captured.length;
  g.dostr('TICK(60)');
  check(g.captured.length === before, 'if network access is taken away again, it stops sending');
}

process.exit(failures ? 1 : 0);
