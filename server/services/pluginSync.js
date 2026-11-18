/**
 * What the in-game plugin reports about quests, kills and drops, applied to the same tables the rest of
 * the app already uses (goals, boss_kills view, drops log). Called from routes/plugin.js inside the
 * ingest transaction, so a request is applied completely or not at all.
 */
const db = require('../database');
const { BOSS_KILL_PATTERNS, completeQuestGoals } = require('./activitySync');

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
    INSERT INTO player_quests (player_id, quest_id, name, state, members, points, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, quest_id) DO UPDATE SET name = excluded.name, state = excluded.state,
      members = excluded.members, points = excluded.points, updated_at = excluded.updated_at
  `);
  const finished = [];
  for (const q of quests) {
    const before = prev.get(q.id);
    upsert.run(playerId, q.id, q.name, q.state, q.members, q.points, now);
    const becameFinished = q.state === 'finished' && before !== 'finished' && (before !== undefined || !full);
    if (becameFinished) finished.push(q.name);
  }
  for (const name of finished) completeQuestGoals(playerId, name);
  return { stored: quests.length, completed: finished };
}

function applyKills(playerId, kills, ref, now) {
  // A batch the plugin re-sends after a lost response carries the same reference: apply it only once.
  if (ref) {
    db.prepare("DELETE FROM plugin_kill_batches WHERE seen_at < datetime('now', '-7 days')").run();
    const fresh = db.prepare('INSERT OR IGNORE INTO plugin_kill_batches (player_id, ref, seen_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(playerId, ref).changes;
    if (!fresh) return false;
  }
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

module.exports = { applyQuests, applyKills, applyDrops, rareItemNames, bossKeyForNpc, MULTI_NPC_BOSSES };
