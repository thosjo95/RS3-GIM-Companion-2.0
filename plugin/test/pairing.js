// Linking a character with a code shown in the game (mocked game API, no server needed).
// Run: npm test --prefix plugin
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
const path = require('path');
const REPO = path.join(__dirname, '..', '..') + path.sep;

let failures = 0;
const check = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) failures++; };

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
const posts = p => captured.filter(c => c.path === p);

// no TOKEN is injected: this character has never been linked
dofile(path.join(__dirname, 'mock.lua'));
dostr('HTTP_RESPONSES["/api/plugin/pair/start"] = \'{"code":"ABCD-2345","device_secret":"secret123","expires_in":600}\'');
dostr('HTTP_RESPONSES["/api/plugin/pair/poll"] = \'{"status":"pending"}\'');
dofile(path.join(REPO, 'plugin', 'gim-companion', 'main.lua'));

dostr('TICK(5)');
check(posts('/api/plugin/pair/start').length === 1 && JSON.parse(posts('/api/plugin/pair/start')[0].body).rsn === 'LuaPlayer', 'without a token the plugin asks the server for a link code for this character');
check(captured.filter(c => c.path === '/api/plugin/ingest').length === 0, 'nothing is sent to the dashboard before the character is linked');
check(lget('#UI_LOG.created') >= 5, 'the code is shown in a window (group box, text lines and a Hide button)');

dostr('TICK(40)');
check(posts('/api/plugin/pair/poll').length >= 3 && posts('/api/plugin/pair/poll').every(c => JSON.parse(c.body).device_secret === 'secret123'), 'it polls with its secret while the code is waiting');
check(posts('/api/plugin/pair/start').length === 1, 'and keeps the same code meanwhile');

dostr('HTTP_RESPONSES["/api/plugin/pair/poll"] = \'{"status":"ready","token":"gimp_LINKEDTOKEN"}\'');
dostr('TICK(12)');
check(lget('STORE["token_luaplayer"]') === 'gimp_LINKEDTOKEN', 'the token handed over by the server is kept in the persistent store, per character');
check(lget('UI_LOG.destroyed') >= 1, 'the link window goes away');
const ingest = captured.filter(c => c.path === '/api/plugin/ingest');
check(ingest.length >= 1 && ingest[0].auth === 'Bearer gimp_LINKEDTOKEN', 'updates now go out with the new token');

// logging in again: the stored token is used, no new code
const before = posts('/api/plugin/pair/start').length;
dostr('FIRE("GameStateChanged", { newState = GameState.LOBBY }) TICK(15)');
check(posts('/api/plugin/pair/start').length === before, 'after a new login the stored token is used (no new code)');
check(captured.filter(c => c.path === '/api/plugin/ingest').pop().auth === 'Bearer gimp_LINKEDTOKEN', 'and sending continues with it');

// the server stops accepting the token: forget it and ask for a new code
dostr('HTTP_STATUS = 401 TICK(80)');
check(lget('STORE["token_luaplayer"]') === null, 'a rejected token is forgotten');
dostr('HTTP_STATUS = 200 HTTP_RESPONSES["/api/plugin/pair/poll"] = \'{"status":"pending"}\' TICK(120)');
check(posts('/api/plugin/pair/start').length >= before + 1 && lget('PAIR_SHOWN') !== false, 'and the character is offered a new code');

process.exit(failures ? 1 : 0);
