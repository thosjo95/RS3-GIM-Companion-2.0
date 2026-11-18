/** DEV ONLY — explore the achievements the plugin delivered, to map area tasks. */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const db = require('../database');
const rows = db.prepare("SELECT a.achievement_id id, a.name, a.category cat, a.sub_category sub, a.members m, a.rune_score rs FROM player_achievements a JOIN players p ON p.id = a.player_id WHERE p.rsn LIKE 'Degree%' ORDER BY a.category, a.sub_category, a.name").all();
const byCat = {};
for (const r of rows) (byCat[r.cat] ??= []).push(r);
for (const [c, list] of Object.entries(byCat)) {
  const subs = {};
  for (const r of list) subs[r.sub] = (subs[r.sub] || 0) + 1;
  console.log(`cat ${c}: ${list.length} | subs ${JSON.stringify(subs)} | e.g. ${list.slice(0, 4).map(r => r.name).join(' ; ')}`);
}
const tiers = rows.filter(r => /\b(Beginner|Easy|Medium|Hard|Elite)\b/i.test(r.name));
console.log('\nnames with a tier word:', tiers.length);
console.log(tiers.slice(0, 40).map(r => `${r.name} [${r.cat}/${r.sub}] id ${r.id}`).join('\n'));
process.exit(0);
