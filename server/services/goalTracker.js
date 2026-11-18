/**
 * Goal tracker — decides which goals are already done, from everything the app knows about the players:
 *   • hiscores skills and the plugin's live skills        (skill goals: level reached)
 *   • quests: the plugin's live state and the Adventurer's Log   (quest goals)
 *   • the area task grid                                   (area task goals)
 *   • lifetime boss kills from the game, else the feed      (boss goals: "— 50 Kills")
 *
 * A goal that is already satisfied when it is added, or that becomes satisfied later, is completed without
 * anyone ticking it. Completion here is silent (no Discord post): the post belongs to the event that really
 * happened, and this runs on old data too. Goals the app cannot judge (items, custom goals) are left alone.
 */
const db = require('../database');

const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// "Quest title" or "Quest title (series)" or "Quest title — extra" → the plain quest name
const questName = title => norm(String(title).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*[—–-]\s.*$/, ''));

/** Everything the tracker needs for one group, read once. */
function loadContext(groupId) {
  const players = db.prepare('SELECT id, rsn, quests_json FROM players WHERE group_id = ?').all(groupId);
  const ids = players.map(p => p.id);
  const ctx = { ids, levels: new Map(), quests: new Set(), diary: new Set(), kills: new Map() };
  if (ids.length === 0) return ctx;
  const inList = ids.map(() => '?').join(',');

  // skill levels per player: the higher of hiscores and the plugin's live reading
  for (const r of db.prepare(`SELECT player_id, skill_name, level FROM skills WHERE player_id IN (${inList})`).all(...ids)) {
    const m = ctx.levels.get(r.player_id) ?? new Map();
    m.set(r.skill_name, Math.max(m.get(r.skill_name) ?? 0, r.level ?? 0));
    ctx.levels.set(r.player_id, m);
  }
  for (const r of db.prepare(`SELECT player_id, skills_json FROM player_live_state WHERE player_id IN (${inList})`).all(...ids)) {
    const live = parseJson(r.skills_json, {});
    const m = ctx.levels.get(r.player_id) ?? new Map();
    for (const [name, v] of Object.entries(live)) m.set(name, Math.max(m.get(name) ?? 0, v?.level ?? 0));
    ctx.levels.set(r.player_id, m);
  }

  // quests finished by anyone in the group (a group quest goal is done when a member has done it)
  for (const p of players) {
    for (const q of parseJson(p.quests_json, [])) if (q.status === 'COMPLETED') ctx.quests.add(questName(q.title));
  }
  for (const r of db.prepare(`SELECT name FROM player_quests WHERE state = 'finished' AND player_id IN (${inList})`).all(...ids)) ctx.quests.add(questName(r.name));

  // area task sets completed by anyone in the group
  for (const r of db.prepare(`SELECT key FROM achievements WHERE type = 'diary' AND achieved = 1 AND player_id IN (${inList})`).all(...ids)) ctx.diary.add(r.key);

  // boss kills per player and boss key: the game's exact count wins, otherwise the feed / live counter
  const { bossKeyForNpc } = require('./pluginSync');
  const add = (pid, key, kills, exact) => {
    const m = ctx.kills.get(pid) ?? new Map();
    const cur = m.get(key) ?? { exact: 0, other: 0 };
    if (exact) cur.exact += kills; else cur.other = Math.max(cur.other, kills);
    m.set(key, cur); ctx.kills.set(pid, m);
  };
  for (const r of db.prepare(`SELECT player_id, name, kills FROM player_boss_kills WHERE player_id IN (${inList})`).all(...ids)) {
    const key = bossKeyForNpc(r.name); if (key) add(r.player_id, key, r.kills, true);
  }
  for (const r of db.prepare(`SELECT player_id, boss_key, kills FROM boss_kills WHERE player_id IN (${inList})`).all(...ids)) add(r.player_id, r.boss_key, r.kills, false);
  for (const r of db.prepare(`SELECT player_id, npc, kills FROM plugin_npc_kills WHERE player_id IN (${inList})`).all(...ids)) {
    const key = bossKeyForNpc(r.npc); if (key) add(r.player_id, key, r.kills, false);
  }
  ctx.bossKeyForNpc = bossKeyForNpc;
  return ctx;
}

function killsOf(ctx, playerId, key) {
  const c = ctx.kills.get(playerId)?.get(key);
  return c ? (c.exact > 0 ? c.exact : c.other) : 0;
}

/** The players a goal is about: its owner and its contributors. */
function goalPlayers(goal) {
  const ids = new Set();
  if (goal.owner_id) ids.add(goal.owner_id);
  for (const r of db.prepare('SELECT player_id FROM goal_contributors WHERE goal_id = ?').all(goal.id)) ids.add(r.player_id);
  return [...ids];
}

/** { satisfied, current, target, unit } for a goal, or null when the app cannot judge it. */
function evaluateGoal(goal, ctx) {
  const details = parseJson(goal.details_json, {});

  if (goal.category === 'skill' && goal.skill && goal.target_value != null) {
    const target = Number(goal.target_value);
    if (!Number.isFinite(target)) return null;
    const who = goalPlayers(goal).slice(0, 1);                 // a skill goal belongs to its owner
    const level = Math.max(0, ...who.map(id => ctx.levels.get(id)?.get(goal.skill) ?? 0));
    return { satisfied: level >= target, current: level, target, unit: 'level' };
  }

  if (goal.category === 'quest') {
    const name = questName(details.questName || goal.title);
    return { satisfied: ctx.quests.has(name), current: ctx.quests.has(name) ? 1 : 0, target: 1, unit: 'quest' };
  }

  if (goal.category === 'diary' && details.diaryKey) {
    const done = ctx.diary.has(details.diaryKey);
    return { satisfied: done, current: done ? 1 : 0, target: 1, unit: 'area task' };
  }

  if (goal.category === 'boss') {
    const key = ctx.bossKeyForNpc(String(goal.title).replace(/\s*[—–]\s.*$/, ''));
    if (!key) return null;
    const m = /(\d[\d,]*)\s*(?:kills?|chests?)\b/i.exec(goal.title);
    const target = m ? Number(m[1].replace(/,/g, '')) : 1;      // "Fight Caves Completion" and the like: one kill
    const who = goalPlayers(goal);
    const kills = Math.max(0, ...who.map(id => killsOf(ctx, id, key)));
    return { satisfied: kills >= target, current: Math.min(kills, target * 1000), target, unit: 'kills' };
  }
  return null;
}

/** Completes every open goal of the group that is already satisfied. Returns the titles completed. */
function reconcileGoals(groupId) {
  const open = db.prepare("SELECT * FROM goals WHERE group_id = ? AND status NOT IN ('complete', 'vaulted')").all(groupId);
  if (open.length === 0) return [];
  const ctx = loadContext(groupId);
  const done = [];
  const mark = db.prepare("UPDATE goals SET status = 'complete', completed_at = CURRENT_TIMESTAMP WHERE id = ?");
  for (const g of open) {
    const r = evaluateGoal(g, ctx);
    if (r?.satisfied) { mark.run(g.id); done.push(g.title); }
  }
  if (done.length) console.log(`[goals] auto-completed ${done.length} goal(s) for group ${groupId}: ${done.join(', ')}`);
  return done;
}

/** Progress of every open goal the tracker can judge: { goalId: { current, target, unit, satisfied } }. */
function goalProgress(groupId) {
  const goals = db.prepare("SELECT * FROM goals WHERE group_id = ? AND status NOT IN ('vaulted')").all(groupId);
  const ctx = loadContext(groupId);
  const out = {};
  for (const g of goals) { const r = evaluateGoal(g, ctx); if (r) out[g.id] = r; }
  return out;
}

function reconcileAllGroups() {
  let n = 0;
  for (const { id } of db.prepare('SELECT id FROM groups').all()) n += reconcileGoals(id).length;
  return n;
}

module.exports = { reconcileGoals, goalProgress, reconcileAllGroups, evaluateGoal, loadContext, questName };
