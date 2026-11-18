/**
 * Group leaderboard metrics.
 *
 * What a player has is read into one compact "metrics" object (XP per skill, quest points, boss kills, slayer kills,
 * total level). A snapshot of it is stored now and then (metric_snapshots); a gain over a period is "now minus the
 * latest snapshot at or before the period start". Competitions use the same thing with their own start / end.
 *
 * Snapshot data: { xp: { Overall, Attack, ... }, qp, boss: { BSLAY_X: kills, _total }, slayer, level, clues: { easy, medium, hard, elite, master, _total } }
 */
const db = require('../database');
const { SLAYER_COUNTERS } = require('./slayerKills');

const THROTTLE_MS = 25 * 60 * 1000;
const parse = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
const toMs = iso => { const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso || '') ? iso : `${iso}Z`); return Number.isFinite(t) ? t : 0; };

/** The player's metrics as they are right now. */
function collect(playerId) {
  const data = { xp: {}, qp: null, boss: {}, slayer: null, level: null, clues: null };

  for (const r of db.prepare('SELECT skill_name, level, xp FROM skills WHERE player_id = ?').all(playerId)) {
    data.xp[r.skill_name] = r.xp ?? 0;
    if (r.skill_name === 'Overall') data.level = r.level ?? null;
  }
  const live = parse(db.prepare('SELECT skills_json FROM player_live_state WHERE player_id = ?').get(playerId)?.skills_json, {});
  let liveLevels = 0;
  for (const [name, v] of Object.entries(live)) {
    if (Number.isFinite(v?.xp)) data.xp[name] = Math.max(data.xp[name] ?? 0, v.xp);
    liveLevels += v?.level ?? 0;
  }
  if (liveLevels > 0) data.level = Math.max(data.level ?? 0, liveLevels);
  if (data.xp.Overall == null || Object.keys(live).length) {
    const sum = Object.entries(data.xp).filter(([k]) => k !== 'Overall').reduce((n, [, v]) => n + v, 0);
    if (sum > (data.xp.Overall ?? 0)) data.xp.Overall = sum;
  }

  const qp = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(points), 0) p FROM player_quests WHERE player_id = ? AND state = 'finished'").get(playerId);
  if (qp.n > 0) data.qp = qp.p;
  else { const p = db.prepare('SELECT quest_points FROM players WHERE id = ?').get(playerId)?.quest_points; if (p > 0) data.qp = p; }

  let bossTotal = 0, any = false;
  for (const r of db.prepare('SELECT key, kills FROM player_boss_kills WHERE player_id = ?').all(playerId)) { data.boss[r.key] = r.kills; bossTotal += r.kills; any = true; }
  if (any) data.boss._total = bossTotal;

  const vars = Object.fromEntries(db.prepare("SELECT name, value FROM player_kill_vars WHERE player_id = ? AND name LIKE 'bslay_monster_kills%'").all(playerId).map(r => [r.name, r.value]));
  let slayer = 0, haveSlayer = false;
  for (const c of SLAYER_COUNTERS) {
    if (vars[c.variable] == null) continue;
    haveSlayer = true;
    slayer += c.half === 'high' ? Math.floor(vars[c.variable] / 65536) % 65536 : vars[c.variable] % 65536;
  }
  if (haveSlayer) data.slayer = slayer;
  data.clues = require('./progressLog').clueCounts(db.prepare('SELECT stats_json FROM players WHERE id = ?').get(playerId)?.stats_json);
  return data;
}

/** Stores a snapshot unless a recent identical one exists (force = also when throttled). */
function snapshotPlayer(playerId, force = false) {
  const last = db.prepare('SELECT taken_at, data_json FROM metric_snapshots WHERE player_id = ? ORDER BY taken_at DESC LIMIT 1').get(playerId);
  if (!force && last && Date.now() - toMs(last.taken_at) < THROTTLE_MS) return false;
  const json = JSON.stringify(collect(playerId));
  if (last && last.data_json === json && Date.now() - toMs(last.taken_at) < 6 * 3600 * 1000) return false;
  db.prepare('INSERT INTO metric_snapshots (player_id, taken_at, data_json) VALUES (?, ?, ?)').run(playerId, new Date().toISOString(), json);
  return true;
}

/**
 * Keeps the table small: everything newer than 7 days is kept as taken (30-minute resolution for competitions that
 * just started), older snapshots are thinned to the LAST one of each day, and anything older than 120 days goes.
 * Gains over weeks and months only need the state at the start of a period, so one per day is enough.
 */
function thinSnapshots(now = Date.now()) {
  const week = new Date(now - 7 * 86400000).toISOString();
  const gone = db.prepare(`
    DELETE FROM metric_snapshots WHERE rowid IN (
      SELECT a.rowid FROM metric_snapshots a
      WHERE a.taken_at < ? AND EXISTS (
        SELECT 1 FROM metric_snapshots b WHERE b.player_id = a.player_id AND substr(b.taken_at, 1, 10) = substr(a.taken_at, 1, 10) AND b.taken_at > a.taken_at
      )
    )`).run(week).changes;
  const old = db.prepare('DELETE FROM metric_snapshots WHERE taken_at < ?').run(new Date(now - 120 * 86400000).toISOString()).changes;
  return { thinned: gone, expired: old };
}

let lastThinned = 0;
function snapshotAll() {
  for (const { id } of db.prepare('SELECT id FROM players').all()) { try { snapshotPlayer(id); } catch (e) { console.error('[metrics] snapshot failed:', e.message); } }
  if (Date.now() - lastThinned > 20 * 3600 * 1000) { lastThinned = Date.now(); try { thinSnapshots(); } catch (e) { console.error('[metrics] thinning failed:', e.message); } }
}

/** The daily hiscores snapshots (older than this feature) as a metrics object: only XP and total level are in them. */
function legacyAt(playerId, ms) {
  const day = new Date(ms).toISOString().slice(0, 10);
  const row = db.prepare('SELECT snapshot_date, total_level, skills_json FROM snapshots WHERE player_id = ? AND snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1').get(playerId, day);
  if (!row) return null;
  const sk = parse(row.skills_json, {});
  const xp = {};
  for (const [k, v] of Object.entries(sk)) if (Number.isFinite(v?.xp)) xp[k] = v.xp;
  return { data: { xp, level: row.total_level ?? sk.Overall?.level ?? null }, at: `${row.snapshot_date}T00:00:00.000Z` };
}

/**
 * The state at (or just before) a time: our own snapshot if there is one, else the older daily hiscores snapshot
 * (XP and level only), else the first snapshot we have (the best available baseline).
 */
function dataAt(playerId, ms) {
  const iso = new Date(ms).toISOString();
  const own = db.prepare('SELECT data_json, taken_at FROM metric_snapshots WHERE player_id = ? AND taken_at <= ? ORDER BY taken_at DESC LIMIT 1').get(playerId, iso);
  if (own) return { data: parse(own.data_json, {}), at: own.taken_at };
  const old = legacyAt(playerId, ms);
  const first = db.prepare('SELECT data_json, taken_at FROM metric_snapshots WHERE player_id = ? ORDER BY taken_at ASC LIMIT 1').get(playerId);
  if (old && (!first || old.at <= first.taken_at)) {
    // XP and level come from the old snapshot; the plugin-based numbers start with our first snapshot
    return { data: { ...(first ? parse(first.data_json, {}) : {}), xp: old.data.xp, level: old.data.level ?? parse(first?.data_json, {}).level }, at: old.at, legacy: true };
  }
  return first ? { data: parse(first.data_json, {}), at: first.taken_at } : old;
}

/** One number out of a metrics object, or null when not known. */
function pick(data, metric, target) {
  if (!data) return null;
  switch (metric) {
    case 'xp':           return data.xp?.[target || 'Overall'] ?? null;
    case 'quest_points': return data.qp ?? null;
    case 'boss_kills':   return data.boss?._total == null ? null : target && target !== 'all' ? (data.boss[target] ?? 0) : data.boss._total;
    case 'slayer_kills': return data.slayer ?? null;
    case 'total_level':  return data.level ?? null;
    case 'clues':        return data.clues == null ? null : target && target !== 'all' ? (data.clues[target] ?? 0) : data.clues._total;
    default:             return null;
  }
}

/** The first snapshot that knows this metric (the baseline for numbers we only started tracking later). */
function firstWith(playerId, metric, target) {
  for (const r of db.prepare('SELECT data_json FROM metric_snapshots WHERE player_id = ? ORDER BY taken_at ASC').iterate(playerId)) {
    const v = pick(parse(r.data_json, {}), metric, target);
    if (v != null) return v;
  }
  return null;
}

const PLUGIN_METRICS = new Set(['quest_points', 'boss_kills', 'slayer_kills']);   // only known from the plugin: private to the group

/** Gain of a metric for each player between two times (endMs null = now). */
function standings(players, metric, target, startMs, endMs = null) {
  const out = [];
  for (const p of players) {
    let value = null, current = null;
    if (metric === 'drops') {
      const from = new Date(startMs).toISOString().replace('T', ' ').slice(0, 19);
      const to = new Date(endMs ?? Date.now() + 1000).toISOString().replace('T', ' ').slice(0, 19);
      value = db.prepare("SELECT COALESCE(SUM(COALESCE(quantity, 1)), 0) n FROM drops WHERE player_id = ? AND replace(substr(dropped_at, 1, 19), 'T', ' ') >= ? AND replace(substr(dropped_at, 1, 19), 'T', ' ') <= ?").get(p.id, from, to).n;
    } else {
      const base = pick(dataAt(p.id, startMs)?.data, metric, target) ?? firstWith(p.id, metric, target);
      const end = endMs != null && endMs < Date.now() ? pick(dataAt(p.id, endMs)?.data, metric, target) : pick(collect(p.id), metric, target);
      current = end;
      value = base != null && end != null ? Math.max(0, end - base) : null;
    }
    out.push({ player_id: p.id, rsn: p.rsn, value, current });
  }
  return out.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}

module.exports = { collect, snapshotPlayer, snapshotAll, thinSnapshots, dataAt, pick, standings, PLUGIN_METRICS };
