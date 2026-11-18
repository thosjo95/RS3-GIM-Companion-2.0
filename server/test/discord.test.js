// Discord notifications: the test message reports failures, and the events the 2.0 data sources produce are sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.GIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-discord-'));
const db = require('../database');
const discord = require('../services/discord');
const pluginSync = require('../services/pluginSync');
const { reconcileGoals } = require('../services/goalTracker');

const URL = 'https://discord.com/api/webhooks/123456789/abcDEF-token_1';
const sent = [];
const realFetch = global.fetch;
let respond = () => ({ ok: true, status: 204, text: async () => '' });
global.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return respond(); };
test.after(() => { global.fetch = realFetch; });

const g = Number(db.prepare("INSERT INTO groups (name, gim_type, gim_size, discord_webhook_url, webhook_events) VALUES ('Hook Group', 'custom', 2, ?, ?)")
  .run(URL, JSON.stringify(['goal_completions', 'drops', 'diary_completions'])).lastInsertRowid);
const p = Number(db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run('Alpha', g).lastInsertRowid);
const wait = () => new Promise(r => setTimeout(r, 20));

test('the test message fails loudly when Discord refuses it', async () => {
  respond = () => ({ ok: false, status: 404, text: async () => 'Unknown Webhook' });
  await assert.rejects(discord.sendTestWebhook(URL, 'Hook Group'), /does not exist/);
  respond = () => ({ ok: true, status: 204, text: async () => '' });
  await discord.sendTestWebhook(URL, 'Hook Group');
  await assert.rejects(discord.sendTestWebhook('http://169.254.169.254/x', 'Hook Group'), /Discord webhook/);
});

test('a drop detected by the plugin is announced', async () => {
  sent.length = 0;
  pluginSync.applyDrops(p, [{ ref: 'r1', name: 'Dragon claw', npc: 'Vorago', quantity: 1, value: 1000000, ts: null }]);
  await wait();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.embeds[0].description, /Dragon claw/);
});

test('a goal the tracker completes from live data is announced, a newly created one is not', async () => {
  db.prepare("INSERT INTO player_quests (player_id, quest_id, name, state, updated_at) VALUES (?, 1, 'Cook''s Assistant', 'finished', ?)").run(p, new Date().toISOString());
  const goal = title => Number(db.prepare("INSERT INTO goals (type, owner_id, group_id, title, category, status) VALUES ('group', ?, ?, ?, 'quest', 'not_started')").run(p, g, title).lastInsertRowid);
  goal("Cook's Assistant");
  sent.length = 0;
  reconcileGoals(g);                                    // silent: goal creation, start-up
  await wait();
  assert.equal(sent.length, 0);
  goal("Cook's Assistant ");                            // another open goal for the same quest
  reconcileGoals(g, { announce: true });                // live data
  await wait();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.embeds[0].title, /Goal Complete/);
});
