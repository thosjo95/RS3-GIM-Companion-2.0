// Prepares a copy of the 1.x database for 2.0. Run it ONCE on the imported copy, never on a live 1.x file.
//
//   GIM_DATA_DIR=<folder holding gim.db> node server/scripts/migrate1x.js            (report only, changes nothing)
//   GIM_DATA_DIR=<folder holding gim.db> node server/scripts/migrate1x.js --apply    (does the work)
//   --assume-1x      this folder IS an imported 1.x copy: every group with a secret needs the one-time claim, even if
//                    some earlier 2.0 run already touched the copy. Use it for the real migration.
//   --drop-loadouts  also remove the gear loadout rows (the feature is gone in 2.0)
//
// What it does (the schema itself is upgraded by simply starting the 2.0 server or requiring database.js):
//   1. removes rows that point at players or groups that no longer exist (left behind by old deletions),
//   2. writes every character name with plain spaces (RuneScape's own pages use a non-breaking space),
//   3. marks every group that has a 1.x secret as "needs_rekey": its old secret only works for the one-time claim step,
//      where the group gets a NEW secret (claimed_v2_at records when each group came over),
//   4. checks the database (integrity and foreign keys) and prints a summary.
const path = require('path');
const fs = require('fs');

if (!process.env.GIM_DATA_DIR) {
  console.error('Set GIM_DATA_DIR to the folder that holds the COPY of the 1.x database (gim.db). Refusing to touch the default database.');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const dropLoadouts = process.argv.includes('--drop-loadouts');
const assume1x = process.argv.includes('--assume-1x');
const file = path.join(process.env.GIM_DATA_DIR, 'gim.db');
if (!fs.existsSync(file)) { console.error('No gim.db in', process.env.GIM_DATA_DIR); process.exit(1); }
console.log(`${apply ? 'APPLY' : 'DRY RUN'}  ${file}  (${(fs.statSync(file).size / 1048576).toFixed(0)} MB)`);

const db = require('../database');                     // opening it upgrades the schema (additive)
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const say = (label, n) => console.log('  ' + label.padEnd(64) + n);

// 1. orphans: rows whose parent is gone. foreign_key_check names the table; rows are removed with that table's rowid.
const orphans = all('PRAGMA foreign_key_check');
const byTable = {};
for (const r of orphans) (byTable[r.table] ??= []).push(r.rowid);
console.log('\n1. Orphan rows');
if (!orphans.length) say('none', 0);
for (const [table, ids] of Object.entries(byTable)) say(`${table} (parent missing)`, ids.length);

// 2. names
const clean = n => String(n).replace(/\s/g, ' ').trim();
const players = all('SELECT id, rsn, group_id FROM players');
const taken = new Set(players.map(p => p.group_id + '|' + p.rsn));
const renames = [], blocked = [];
for (const p of players) {
  const c = clean(p.rsn);
  if (c === p.rsn) continue;
  if (taken.has(p.group_id + '|' + c)) blocked.push(p); else { renames.push({ id: p.id, from: p.rsn, to: c }); taken.add(p.group_id + '|' + c); }
}
console.log('\n2. Character names');
say('names to write with plain spaces', renames.length);
say('blocked by an existing member with that name (left alone)', blocked.length);

// 3. secrets
const withSecret = one(assume1x ? 'SELECT COUNT(*) n FROM groups WHERE password_hash IS NOT NULL' : 'SELECT COUNT(*) n FROM groups WHERE password_hash IS NOT NULL AND needs_rekey = 0 AND claimed_v2_at IS NULL').n;
console.log('\n3. Group secrets');
say('groups with a 1.x secret that will need the one-time claim', withSecret);
say('groups without a secret (claimed openly on 2.0)', one('SELECT COUNT(*) n FROM groups WHERE password_hash IS NULL').n);
if (dropLoadouts) console.log('\n   gear loadout rows to remove: ' + one('SELECT COUNT(*) n FROM equipment_loadouts').n);

if (!apply) { console.log('\nDry run: nothing was changed. Add --apply to do it.'); process.exit(0); }

db.exec('BEGIN');
try {
  // orphans: delete by rowid, children before parents does not matter with foreign keys checked at the end
  db.exec('PRAGMA defer_foreign_keys = ON');
  for (const [table, ids] of Object.entries(byTable)) {
    const del = db.prepare(`DELETE FROM "${table}" WHERE rowid = ?`);
    for (const id of ids) del.run(id);
  }
  const rn = db.prepare('UPDATE players SET rsn = ? WHERE id = ?');
  for (const r of renames) rn.run(r.to, r.id);
  db.prepare(assume1x ? "UPDATE groups SET needs_rekey = 1, claimed_v2_at = NULL WHERE password_hash IS NOT NULL" : "UPDATE groups SET needs_rekey = 1 WHERE password_hash IS NOT NULL AND claimed_v2_at IS NULL").run();
  if (dropLoadouts) db.exec('DELETE FROM equipment_loadouts');
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nFailed, nothing was changed:', e.message);
  process.exit(1);
}

console.log('\n4. Check after the changes');
say('integrity_check', all('PRAGMA integrity_check').map(r => Object.values(r)[0]).join(','));
say('orphan rows left', all('PRAGMA foreign_key_check').length);
say('groups that need the one-time claim', one('SELECT COUNT(*) n FROM groups WHERE needs_rekey = 1').n);
say('groups / players', `${one('SELECT COUNT(*) n FROM groups').n} / ${one('SELECT COUNT(*) n FROM players').n}`);
console.log('\nDone.');
