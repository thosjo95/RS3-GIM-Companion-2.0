/**
 * Scheduled hiscores sync, built for many groups:
 *   - only ACTIVE groups are synced (written to in the last 14 days, or a member's plugin was heard from in the last
 *     7 days); a group nobody uses costs nothing,
 *   - players that were synced longest ago go first, so a run that is cut short never starves the same people,
 *   - the hourly run reads the hiscores only; the Adventurer's Log (a second request per player) is read by the
 *     daily run (and the 2-hourly feed job in index.js),
 *   - when Jagex answers with 429 / 5xx the run stops and rests for a while instead of hammering the site.
 */
const db = require('../database');

const PAUSE_MS = 700;                       // between players
const COOLDOWN_MS = 15 * 60 * 1000;         // rest after being rate limited
let running = false;
let coolUntil = 0;

/** Players of active groups, least recently synced first. */
function activePlayers(activeDays = 14) {
  return db.prepare(`
    SELECT p.* FROM players p
    WHERE p.group_id IN (
      SELECT g.id FROM groups g WHERE g.last_activity IS NULL OR g.last_activity >= datetime('now', ?)
      UNION
      SELECT p2.group_id FROM players p2 JOIN player_live_state s ON s.player_id = p2.id WHERE s.updated_at >= ?
    )
    ORDER BY p.last_synced IS NOT NULL, p.last_synced ASC
  `).all(`-${activeDays} days`, new Date(Date.now() - 7 * 86400000).toISOString());
}

async function syncOne(player, { events }, svc) {
  const { fetchHiscores, fetchPlayerEvents, calcCombatLevel } = svc.runescape;
  const [data, rm] = await Promise.all([fetchHiscores(player.rsn), events ? svc.runescape.fetchPlayerEvents(player.rsn).catch(() => null) : null]);
  const combat = calcCombatLevel(data.skills);

  // stats_json: hiscores activities (clue scrolls, RuneScore...). The quest counts are written by the player sync routes.
  let prevStats = {};
  try { prevStats = player.stats_json ? JSON.parse(player.stats_json) : {}; } catch { /* corrupt: ignore */ }
  const statsJson = JSON.stringify({ activities: data.activities, questsComplete: prevStats.questsComplete ?? null, questsStarted: prevStats.questsStarted ?? null });
  const activitiesJson = rm ? JSON.stringify(rm.activities) : null;

  db.prepare('UPDATE players SET last_synced = CURRENT_TIMESTAMP, combat_level = ?, stats_json = ?, activities_json = COALESCE(?, activities_json) WHERE id = ?')
    .run(combat, statsJson, activitiesJson, player.id);

  db.runTransaction(() => {
    const upsert = db.prepare(`INSERT INTO skills (player_id, skill_name, level, xp, rank) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(player_id, skill_name) DO UPDATE SET level = excluded.level, xp = excluded.xp, rank = excluded.rank`);
    for (const [name, s] of Object.entries(data.skills)) upsert.run(player.id, name, s.level, s.xp, s.rank ?? -1);
  });

  db.prepare(`INSERT INTO snapshots (player_id, snapshot_date, total_xp, total_level, skills_json) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(player_id, snapshot_date) DO NOTHING`).run(player.id, new Date().toISOString().slice(0, 10), data.totalXp, data.totalLevel, JSON.stringify(data.skills));

  if (rm?.activities) {
    const { saveActivities, autoLogDrops, autoDetectDiaries, autoCountBossKills, autoDetectLevelMilestones, autoCompleteQuestGoals } = svc.activitySync;
    const fresh = saveActivities(player.id, rm.activities);
    if (fresh.length > 0) {
      autoLogDrops(player.id, fresh); autoDetectDiaries(player.id, fresh); autoCountBossKills(player.id, fresh);
      autoDetectLevelMilestones(player.id, fresh); autoCompleteQuestGoals(player.id, fresh);
    }
  }
}

/** Runs one pass. Returns { synced, failed, skipped, stopped }. `svc` can be replaced in tests. */
async function runHiscoresSync({ label = 'hiscores sync', events = false, activeDays = 14, pause = PAUSE_MS, svc } = {}) {
  svc = svc ?? { runescape: require('./runescape'), activitySync: require('./activitySync') };
  if (running) return { skipped: true };
  if (Date.now() < coolUntil) { console.log(`[${label}] resting after a rate limit`); return { skipped: true }; }
  running = true;
  const out = { synced: 0, failed: 0, stopped: null };
  let streak = 0;
  try {
    for (const player of activePlayers(activeDays)) {
      try {
        await syncOne(player, { events }, svc);
        out.synced++; streak = 0;
      } catch (err) {
        out.failed++; streak++;
        console.error(`[${label}] Failed ${player.rsn}: ${err.message}`);
        if (/\b(429|5\d\d)\b/.test(err.message) || /rate/i.test(err.message)) { coolUntil = Date.now() + COOLDOWN_MS; out.stopped = 'rate limited'; break; }
        if (streak >= 8) { coolUntil = Date.now() + COOLDOWN_MS; out.stopped = 'too many failures in a row'; break; }
      }
      if (pause) await new Promise(r => setTimeout(r, pause));
    }
  } finally { running = false; }
  console.log(`[${label}] ${out.synced} synced, ${out.failed} failed${out.stopped ? `, stopped: ${out.stopped}` : ''}`);
  return out;
}

module.exports = { runHiscoresSync, activePlayers };
