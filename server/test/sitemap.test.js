// /api/sitemap.xml: home, the leaderboard and one address per listed group; unlisted, demo and empty groups left out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.GIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gim-sitemap-'));
const db = require('../database');
const { _build, _slugify } = require('../routes/sitemap');

function group(name, extra = {}) {
  const id = Number(db.prepare('INSERT INTO groups (name, gim_type, gim_size) VALUES (?, ?, ?)').run(name, 'regular', 2).lastInsertRowid);
  if (extra.unlisted) db.prepare('UPDATE groups SET settings_json = ? WHERE id = ?').run(JSON.stringify({ unlisted: true }), id);
  if (extra.demo) db.prepare('UPDATE groups SET is_demo = 1 WHERE id = ?').run(id);
  if (!extra.empty) db.prepare('INSERT INTO players (rsn, group_id) VALUES (?, ?)').run(`${name} Member`, id);
  return id;
}

test('the slug is plain lower-case words (the same as the website makes)', () => {
  assert.equal(_slugify('Lumbridge Legends'), 'lumbridge-legends');
  assert.equal(_slugify('  Pårty & Co!! '), 'party-co');
  assert.equal(_slugify('***'), '');
});

test('lists home, the leaderboard and listed groups only', () => {
  const pals = group('Public Pals');
  group('Hidden Heroes', { unlisted: true });
  group('Misthalin Five (Demo)', { demo: true });
  group('Nobody Home', { empty: true });
  const xml = _build();
  assert.ok(xml.includes('<loc>https://groupiron.com/</loc>'));
  assert.ok(xml.includes('<loc>https://groupiron.com/leaderboard</loc>'));
  assert.ok(xml.includes(`<loc>https://groupiron.com/group/${pals}/public-pals</loc>`));
  for (const hidden of ['hidden-heroes', 'misthalin', 'nobody-home']) assert.ok(!xml.includes(hidden), hidden);
});
