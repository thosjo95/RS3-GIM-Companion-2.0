/**
 * Recommendations — "what should this group do next", worked out from what the game itself reported:
 *   • quests the character can start right now (the game's own requirement check)
 *   • bosses the character has never killed and is combat-level ready for (requirement from the boss record)
 *   • the next area task tier per region, from the sets the game lists
 *   • the next steps of the Group Ironman Journey
 *   • skills close to 99
 * Nothing here is a hard-coded list of content: when Jagex adds a quest, boss or area task, the plugin reports it and it
 * shows up here without a code change.
 */
const db = require('../database');
const { areaTaskOf } = require('./pluginSync');
const { calcCombatLevel } = require('./runescape');

const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const TIERS = ['beginner', 'easy', 'medium', 'hard', 'elite'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function recommend(groupId, playerId) {
  const players = db.prepare('SELECT id, rsn FROM players WHERE group_id = ?').all(groupId);
  const ids = players.map(p => p.id);
  if (ids.length === 0) return [];
  const me = players.find(p => p.id === playerId) ?? players[0];
  const inList = ids.map(() => '?').join(',');
  const out = [];

  // titles of goals already on the board (open ones) are never suggested again
  const active = new Set(db.prepare("SELECT title FROM goals WHERE group_id = ? AND status NOT IN ('complete','vaulted')").all(groupId).map(g => norm(g.title)));
  const add = r => { if (!active.has(norm(r.goal.title))) out.push(r); };

  // level of the chosen player (higher of hiscores and live)
  const levels = {};
  for (const r of db.prepare('SELECT skill_name, level FROM skills WHERE player_id = ?').all(me.id)) levels[r.skill_name] = r.level;
  try {
    const live = JSON.parse(db.prepare('SELECT skills_json FROM player_live_state WHERE player_id = ?').get(me.id)?.skills_json ?? '{}');
    for (const [k, v] of Object.entries(live)) levels[k] = Math.max(levels[k] ?? 0, v?.level ?? 0);
  } catch { /* no live data */ }

  // 1. quests that can be started now (and are not done anywhere in the group)
  const doneQuests = new Set(db.prepare(`SELECT name FROM player_quests WHERE state = 'finished' AND player_id IN (${inList})`).all(...ids).map(r => norm(r.name)));
  const startable = db.prepare("SELECT name, points FROM player_quests WHERE player_id = ? AND state = 'not_started' AND can_start = 1 ORDER BY name").all(me.id);
  for (const q of startable) {
    if (doneQuests.has(norm(q.name))) continue;
    add({ kind: 'quest', reason: `${me.rsn} meets every requirement to start it${q.points ? ` · ${q.points} quest point${q.points === 1 ? '' : 's'}` : ''}`,
      goal: { title: q.name, category: 'quest', details: { questName: q.name } } });
  }

  // 2. bosses never killed that the combat level allows
  const combat = calcCombatLevel(Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, { level: v }])));
  const bosses = db.prepare('SELECT name, kills, combat_req FROM player_boss_kills WHERE player_id = ? AND kills = 0 AND combat_req IS NOT NULL ORDER BY combat_req, name').all(me.id);
  for (const b of bosses) {
    if (combat != null && b.combat_req > combat) continue;
    add({ kind: 'boss', reason: `no kills yet · recommended combat ${b.combat_req}`, goal: { title: `${b.name} — 1 Kill`, category: 'boss' } });
  }

  // 3. next area task tier per region
  const done = new Set(db.prepare(`SELECT key FROM achievements WHERE type = 'diary' AND achieved = 1 AND player_id IN (${inList})`).all(...ids).map(r => r.key));
  const regions = new Map();
  for (const r of db.prepare(`SELECT DISTINCT name FROM player_achievements WHERE name LIKE '% Set Tasks - %' AND player_id IN (${inList})`).all(...ids)) {
    const t = areaTaskOf(r.name); if (!t) continue;
    const base = t.key.replace(/_(beginner|easy|medium|hard|elite)$/, '');
    const e = regions.get(base) ?? { region: t.region, tiers: new Set() };
    e.tiers.add(t.tier.toLowerCase()); regions.set(base, e);
  }
  for (const [base, e] of regions) {
    const next = TIERS.find(t => e.tiers.has(t) && !done.has(`${base}_${t}`));
    if (next) add({ kind: 'area task', reason: 'next set in this region', goal: { title: `${e.region} ${cap(next)}`, category: 'diary', details: { diaryKey: `${base}_${next}` } } });
  }

  // 4. journey: unfinished steps of the lowest tier that is not done
  const steps = db.prepare(`SELECT name, MAX(completed) AS done FROM player_achievements WHERE category = 5483 AND name LIKE 'Journey Tier %: %' AND player_id IN (${inList}) GROUP BY name`).all(...ids);
  const byTier = new Map();
  for (const s of steps) {
    const m = /^Journey Tier (\d+):\s*(.+)$/.exec(s.name); if (!m || s.done) continue;
    const t = Number(m[1]); byTier.set(t, [...(byTier.get(t) ?? []), m[2]]);
  }
  const low = [...byTier.keys()].sort((a, b) => a - b)[0];
  if (low != null) for (const step of byTier.get(low).slice(0, 5)) {
    add({ kind: 'journey', reason: `Group Ironman Journey · tier ${low}`, goal: { title: step, category: 'custom' } });
  }

  // 5. skills close to 99 (90+), nearest first
  for (const [skill, lvl] of Object.entries(levels).filter(([k, v]) => k !== 'Overall' && v >= 90 && v < 99).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    add({ kind: 'skill', reason: `${me.rsn} is level ${lvl}`, goal: { title: `99 ${skill}`, category: 'skill', skill, target_value: 99 } });
  }
  return out;
}

module.exports = { recommend };
