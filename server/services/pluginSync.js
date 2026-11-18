/**
 * What the in-game plugin reports about quests, kills and drops, applied to the same tables the rest of
 * the app already uses (goals, boss_kills view, drops log). Called from routes/plugin.js inside the
 * ingest transaction, so a request is applied completely or not at all.
 */
const db = require('../database');
const { BOSS_KILL_PATTERNS, completeQuestGoals, diaryRegionKey } = require('./activitySync');

// Bosses whose fight has several NPCs or phases. The plugin counts every NPC that dies, so for these the
// plugin number can run higher than real kills and is shown next to (not instead of) the feed number.
const MULTI_NPC_BOSSES = new Set([
  'dagannoth_kings', 'twin_furies', 'barrows', 'rex_matriarchs', 'kalphite_queen', 'exiled_kalphite_queen',
  'kalphite_king', 'vorago', 'nex', 'nex_aod', 'telos', 'araxxi', 'zamorak_loe', 'gate_of_elidinis',
  'legiones', 'magister', 'ghrazi_blood_knights', 'kerapac', 'tormented_demons',
]);

/** Which boss (BOSS_KILL_PATTERNS key) an NPC name belongs to, or null for ordinary monsters. */
function bossKeyForNpc(npcName) {
  for (const b of BOSS_KILL_PATTERNS) if (b.pattern.test(npcName)) return b.key;
  return null;
}

/**
 * Quest states. `full` = the plugin sent its whole quest list (login baseline): quests that are already
 * finished are stored but NOT announced or used to complete goals. A quest that changes to finished while
 * playing completes matching quest goals and posts the usual Discord notice.
 */
function applyQuests(playerId, quests, full, now) {
  const prev = new Map(db.prepare('SELECT quest_id, state FROM player_quests WHERE player_id = ?').all(playerId).map(r => [r.quest_id, r.state]));
  const upsert = db.prepare(`
    INSERT INTO player_quests (player_id, quest_id, name, state, members, points, updated_at, can_start) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, quest_id) DO UPDATE SET name = excluded.name, state = excluded.state,
      members = excluded.members, points = excluded.points, updated_at = excluded.updated_at, can_start = excluded.can_start
  `);
  // A full list is the plugin's complete picture: anything stored earlier that it no longer lists (for example
  // quests it now knows are deprecated) is removed.
  if (full) {
    const sent = new Set(quests.map(q => q.id));
    const drop = db.prepare('DELETE FROM player_quests WHERE player_id = ? AND quest_id = ?');
    for (const id of prev.keys()) if (!sent.has(id)) { drop.run(playerId, id); prev.delete(id); }
  }
  const finished = [];
  for (const q of quests) {
    const before = prev.get(q.id);
    upsert.run(playerId, q.id, q.name, q.state, q.members, q.points, now, q.canStart);
    const becameFinished = q.state === 'finished' && before !== 'finished' && (before !== undefined || !full);
    if (becameFinished) finished.push(q.name);
  }
  for (const name of finished) completeQuestGoals(playerId, name);
  return { stored: quests.length, completed: finished };
}

/**
 * A batch the plugin re-sends after a lost response carries the same reference: only the first one counts.
 * Returns true when the reference is new (or absent), false when this batch was already applied.
 */
function claimBatch(playerId, ref) {
  if (!ref) return true;
  db.prepare("DELETE FROM plugin_kill_batches WHERE seen_at < datetime('now', '-7 days')").run();
  return db.prepare('INSERT OR IGNORE INTO plugin_kill_batches (player_id, ref, seen_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(playerId, ref).changes > 0;
}

// ── Area tasks ────────────────────────────────────────────────────────────────
// The game lists each area task SET as an achievement named "<Region> Set Tasks - <Tier>" (for example
// "Seers' Village Set Tasks - Hard"). Those are the rows of the dashboard's area task grid, whose keys look like
// diary_<region>_<tier>. The game says "Lumbridge"; the grid's row is "Lumbridge & Draynor".
// The region may not contain a colon: "Journey Tier 2: Lumbridge Set Tasks - Easy" is a Group Ironman journey step, not the set.
const SET_TASKS = /^([^:]+?) Set Tasks - (Beginner|Easy|Medium|Hard|Elite)$/i;
const REGION_ALIASES = { lumbridge: 'lumbridge_draynor' };

/** { key, region, tier } for an achievement name that is an area task set, else null. */
function areaTaskOf(name) {
  const m = SET_TASKS.exec(name || '');
  if (!m) return null;
  const region = diaryRegionKey(m[1]);
  return { key: `diary_${REGION_ALIASES[region] ?? region}_${m[2].toLowerCase()}`, region: m[1], tier: m[2] };
}

/** Mark the player's completed area task sets in the area task grid (never un-marks anything). */
function syncAreaTasks(playerId, announce) {
  const rows = db.prepare("SELECT name, completed_at FROM player_achievements WHERE player_id = ? AND completed = 1 AND name LIKE '% Set Tasks - %'").all(playerId);
  const mark = db.prepare(`
    INSERT INTO achievements (player_id, type, key, achieved, achieved_at, manual) VALUES (?, 'diary', ?, 1, ?, 0)
    ON CONFLICT(player_id, key) DO UPDATE SET achieved = 1, achieved_at = COALESCE(achieved_at, excluded.achieved_at) WHERE achieved = 0
  `);
  const added = [];
  for (const r of rows) {
    const t = areaTaskOf(r.name);
    if (!t) continue;
    if (mark.run(playerId, t.key, r.completed_at).changes > 0) added.push(t);
  }
  if (announce) for (const t of added) { try { require('./discord').notifyDiary(playerId, t.tier, t.region); } catch { /* webhook problems must not break ingest */ } }
  return added.length;
}

/** Run once at server start so achievements stored before this mapping existed also fill the grid. */
function backfillAreaTasks() {
  // Rows an earlier version of the mapping created from "Journey Tier N: …" achievements were wrong.
  db.prepare("DELETE FROM achievements WHERE type = 'diary' AND key LIKE 'diary_journey_%' AND manual = 0").run();
  let n = 0;
  for (const { player_id } of db.prepare('SELECT DISTINCT player_id FROM player_achievements').all()) n += syncAreaTasks(player_id, false);
  return n;
}

/**
 * Completed achievements. Once completed they stay completed, so rows are only ever added. `full` is the plugin's
 * first scan after login: those were done at some unknown time, so they get no completed_at (and no announcement).
 */
function applyAchievements(playerId, list, full, now) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO player_achievements (player_id, achievement_id, name, category, sub_category, members, rune_score, completed_at, seen_at, completed, description, reward, tally_progress, tally_target)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Detail that can change after the first report (a progress counter moving) or arrive later.
  const refresh = db.prepare(`UPDATE player_achievements SET description = COALESCE(?, description), reward = COALESCE(?, reward),
    tally_progress = COALESCE(?, tally_progress), tally_target = COALESCE(?, tally_target) WHERE player_id = ? AND achievement_id = ?`);
  // A journey step first seen as "not done" later becomes done: upgrade the stored row.
  const complete = db.prepare('UPDATE player_achievements SET completed = 1, completed_at = ? WHERE player_id = ? AND achievement_id = ? AND completed = 0');
  let added = 0;
  const fresh = [];
  for (const a of list) {
    const n = insert.run(playerId, a.id, a.name, a.category, a.sub, a.members, a.score, a.completed && !full ? now : null, now, a.completed ? 1 : 0,
      a.description, a.reward, a.tallyProgress, a.tallyTarget).changes;
    if (n) { if (a.completed) { added++; if (!full) fresh.push(a.name); } }
    else {
      refresh.run(a.description, a.reward, a.tallyProgress, a.tallyTarget, playerId, a.id);
      if (a.completed && complete.run(full ? null : now, playerId, a.id).changes) { added++; if (!full) fresh.push(a.name); }
    }
  }
  const areaTasks = syncAreaTasks(playerId, !full);
  return { received: list.length, added, new_completions: fresh, area_tasks_marked: areaTasks };
}

function applyKills(playerId, kills, ref, now) {
  if (!claimBatch(playerId, ref)) return false;
  const up = db.prepare(`
    INSERT INTO plugin_npc_kills (player_id, npc, kills, last_seen) VALUES (?, ?, ?, ?)
    ON CONFLICT(player_id, npc) DO UPDATE SET kills = kills + excluded.kills, last_seen = excluded.last_seen
  `);
  for (const k of kills) up.run(playerId, k.npc, k.kills, now);
  return true;
}

const toSqlDate = iso => (iso ? iso.replace('T', ' ').replace(/\.\d+Z$|Z$/, '') : null);

function applyDrops(playerId, drops) {
  let added = 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO drops (player_id, item_name, boss_name, quantity, value_gp, notes, dropped_at, source, sig)
    VALUES (?, ?, ?, ?, ?, 'Detected by the plugin', COALESCE(?, CURRENT_TIMESTAMP), 'plugin', ?)
  `);
  // A drop the Adventurer's Log import already logged (same item, same day, no signature) is not logged twice;
  // the existing row just learns which NPC dropped it.
  const feedRow = db.prepare(`SELECT id, boss_name FROM drops WHERE player_id = ? AND item_name = ? AND date(dropped_at) = date(COALESCE(?, CURRENT_TIMESTAMP)) AND sig IS NULL`);
  const learnBoss = db.prepare('UPDATE drops SET boss_name = ? WHERE id = ? AND (boss_name IS NULL OR boss_name = \'\')');
  for (const d of drops) {
    const when = toSqlDate(d.ts);
    const dup = db.prepare('SELECT 1 FROM drops WHERE player_id = ? AND sig = ?').get(playerId, d.ref);
    if (dup) continue;
    const existing = feedRow.get(playerId, d.name, when);
    if (existing) { if (d.npc) learnBoss.run(d.npc, existing.id); continue; }
    added += insert.run(playerId, d.name, d.npc, d.quantity, d.value, when, d.ref).changes;
  }
  return added;
}

/** Item names the group cares about: every drop listed for a boss in our reference data (annotations removed). */
function rareItemNames() {
  const names = new Set();
  for (const { drops } of db.prepare('SELECT drops FROM rs3_bosses').all()) {
    let list; try { list = JSON.parse(drops); } catch { continue; }
    for (const d of Array.isArray(list) ? list : []) {
      const name = String(d?.name ?? d ?? '').replace(/\s*\(.*$/, '').trim().toLowerCase();
      if (name.length >= 3) names.add(name);
    }
  }
  return [...names].sort();
}

module.exports = { backfillAreaTasks, areaTaskOf, claimBatch, applyAchievements, applyQuests, applyKills, applyDrops, rareItemNames, bossKeyForNpc, MULTI_NPC_BOSSES };
