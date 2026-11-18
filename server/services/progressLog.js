/**
 * The boss log and the clue log: one row each time a member's count goes up.
 *
 *   boss: the game's own lifetime boss counter (from the plugin) went from 69 to 71 -> "Hermod +2, now 71"
 *   clue: the completed-clues count of a tier on the public hiscores went up      -> "hard +1, now 41"
 *
 * The first value seen is only a starting point (nothing is logged for it), so logs begin when tracking begins.
 */
const db = require('../database');

const CLUE_TIERS = { easy: 'Clue Scrolls Easy', medium: 'Clue Scrolls Medium', hard: 'Clue Scrolls Hard', elite: 'Clue Scrolls Elite', master: 'Clue Scrolls Master' };

function add(playerId, kind, key, name, gain, total, at = new Date().toISOString()) {
  db.prepare('INSERT INTO progress_log (player_id, kind, key, name, gain, total, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(playerId, kind, key, name, gain, total, at);
}

/** Before the plugin's boss counters are stored: compare with what is stored now. `records` = [{ key, name, kills }]. */
function logBossGains(playerId, records) {
  const before = new Map(db.prepare('SELECT key, kills FROM player_boss_kills WHERE player_id = ?').all(playerId).map(r => [r.key, r.kills]));
  if (before.size === 0) return;                                      // first report from this player: starting point only
  for (const r of records) {
    const old = before.get(r.key);
    const gain = old == null ? r.kills : r.kills - old;                // a boss seen for the first time: all its kills are new
    if (gain > 0 && gain < 10000) add(playerId, 'boss', r.key, r.name, gain, r.kills);
  }
}

/** When fresh hiscores arrive: compare the clue counts with the previous stats_json activities. */
function logClueGains(playerId, prevActivities, newActivities) {
  if (!prevActivities || !newActivities) return;
  for (const [tier, field] of Object.entries(CLUE_TIERS)) {
    const old = prevActivities[field], now = newActivities[field];
    if (!Number.isFinite(old) || !Number.isFinite(now) || old < 0) continue;   // -1 = not ranked yet: no starting point
    const gain = now - old;
    if (gain > 0 && gain < 10000) add(playerId, 'clue', tier, tier, gain, now);
  }
}

/** Completed clues per tier from stats_json (null when the hiscores have not been read). */
function clueCounts(statsJson) {
  let acts = null;
  try { acts = JSON.parse(statsJson || 'null')?.activities ?? null; } catch { acts = null; }
  if (!acts) return null;
  const out = {}; let total = 0, any = false;
  for (const [tier, field] of Object.entries(CLUE_TIERS)) {
    const v = acts[field];
    if (Number.isFinite(v) && v >= 0) { out[tier] = v; total += v; any = true; }
  }
  if (!any) return null;
  out._total = total;
  return out;
}

module.exports = { logBossGains, logClueGains, clueCounts, CLUE_TIERS };
