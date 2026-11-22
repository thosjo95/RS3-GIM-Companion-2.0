/**
 * Numbers for the Global Leaderboard page: every group tracked on the site, side by side.
 *
 * Everything that names a group or a player comes from PUBLIC data only: hiscores snapshots (XP), the Adventurer's Log
 * (boss kills, drops, 99s and 120s) and the group list. Plugin data (online, exact kills, drops with values, clues,
 * quests, achievements) is private to each group (see docs/privacy.html), so it only appears here as anonymous totals
 * over everyone and never with a name. Left out entirely: the demo group, custom (non-Group-Ironman) and dev-only
 * groups. Unlisted groups count in the totals but are never named.
 *
 * "This week" and "this month" count back from the newest daily snapshot (normally today), so the page still makes
 * sense if a sync is late. The result is built once and kept for 10 minutes.
 */
const db = require('../database');
const { BOSS_KILL_PATTERNS } = require('./activitySync');

const CACHE_MS = 10 * 60 * 1000;
const ONLINE_MS = 5 * 60 * 1000;  // "online now": the plugin was heard from in the last 5 minutes
let cache = null;                 // { at, value }

const dayBefore = (isoDate, days) => new Date(Date.parse(isoDate + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
const parseJson = s => { try { return JSON.parse(s); } catch { return null; } };

// "I killed 17 Hermods." -> 17, "I killed  The Gate of Elidinis." -> 1
const batchKills = text => {
  const m = (text || '').match(/\b(?:killed|defeated|slain|vanquished)\s+(?:the\s+)?(\d[\d,]*)\b/i);
  return m ? Math.max(1, parseInt(m[1].replace(/,/g, ''), 10) || 1) : 1;
};

function build() {
  // groups that count: real Group Ironman groups, not the demo
  const groups = db.prepare(`
    SELECT g.id, g.name, g.gim_type, g.gim_size, g.created_at, g.settings_json,
           (g.password_hash IS NOT NULL) AS is_claimed
    FROM groups g
    WHERE COALESCE(g.is_dev_only, 0) = 0 AND COALESCE(g.is_demo, 0) = 0 AND COALESCE(g.gim_type, 'regular') <> 'custom'
  `).all();
  const groupById = new Map(groups.map(g => [g.id, {
    ...g, unlisted: parseJson(g.settings_json)?.unlisted === true,
    members: 0, totalXp: 0, weekGain: 0, monthGain: 0, activeMembers: 0,
  }]));

  const players = db.prepare('SELECT id, rsn, group_id FROM players').all().filter(p => groupById.has(p.group_id));
  const playerById = new Map(players.map(p => [p.id, p]));
  const listed = id => { const p = playerById.get(id); return !!p && !groupById.get(p.group_id).unlisted; };

  // current XP per player and skill
  const current = new Map();      // player_id -> { Overall: xp, Attack: xp, ... }
  for (const r of db.prepare('SELECT player_id, skill_name, xp FROM skills').all()) {
    if (!playerById.has(r.player_id)) continue;
    let m = current.get(r.player_id); if (!m) current.set(r.player_id, (m = {}));
    m[r.skill_name] = r.xp ?? 0;
  }

  const anchor = db.prepare('SELECT MAX(snapshot_date) d FROM snapshots').get()?.d ?? new Date().toISOString().slice(0, 10);
  const periods = { week: dayBefore(anchor, 7), month: dayBefore(anchor, 30) };

  // the starting point of a period: the newest snapshot on or before the cut-off day, or else the oldest one
  // (a player who was added during the period counts from the day they were first tracked)
  const baseAt = db.prepare(`
    SELECT s.player_id, s.total_xp, s.skills_json FROM snapshots s
    JOIN (SELECT player_id, MAX(snapshot_date) d FROM snapshots WHERE snapshot_date <= ? GROUP BY player_id) b
      ON b.player_id = s.player_id AND b.d = s.snapshot_date`);
  const baseFirst = db.prepare(`
    SELECT s.player_id, s.total_xp, s.skills_json FROM snapshots s
    JOIN (SELECT player_id, MIN(snapshot_date) d FROM snapshots GROUP BY player_id) b
      ON b.player_id = s.player_id AND b.d = s.snapshot_date`);
  const firstRows = new Map(baseFirst.all().map(r => [r.player_id, r]));

  const gains = {};               // period -> { players: Map(id -> gain), skills: { skill: xp } }
  for (const [key, cut] of Object.entries(periods)) {
    const base = new Map(baseAt.all(cut).map(r => [r.player_id, r]));
    const pg = new Map(), sg = {};
    for (const p of players) {
      const now = current.get(p.id);
      const b = base.get(p.id) ?? firstRows.get(p.id);
      if (!now?.Overall || !b?.total_xp) continue;            // a failed sync (0 XP) would look like a huge gain
      const gain = Math.max(0, now.Overall - b.total_xp);
      pg.set(p.id, gain);
      const old = parseJson(b.skills_json);
      if (old && gain > 0) {
        for (const [skill, xp] of Object.entries(now)) {
          if (skill === 'Overall') continue;
          const d = xp - (old[skill]?.xp ?? xp);
          if (d > 0) sg[skill] = (sg[skill] ?? 0) + d;
        }
      }
    }
    gains[key] = { players: pg, skills: sg };
  }

  for (const p of players) {
    const g = groupById.get(p.group_id);
    g.members++;
    g.totalXp += current.get(p.id)?.Overall ?? 0;
    const w = gains.week.players.get(p.id) ?? 0;
    g.weekGain += w;
    g.monthGain += gains.month.players.get(p.id) ?? 0;
    if (w > 0) g.activeMembers++;
  }
  const withMembers = [...groupById.values()].filter(g => g.members > 0);
  const groupList = withMembers.filter(g => !g.unlisted).map(g => ({
    id: g.id, name: g.name, type: g.gim_type ?? 'regular', size: g.gim_size ?? g.members, members: g.members,
    claimed: !!g.is_claimed, createdAt: g.created_at, totalXp: g.totalXp, weekGain: g.weekGain, monthGain: g.monthGain,
    activeMembers: g.activeMembers,
  }));

  const topPlayers = key => [...gains[key].players.entries()].filter(([id, v]) => v > 0 && listed(id))
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([id, gain]) => { const p = playerById.get(id), g = groupById.get(p.group_id); return { rsn: p.rsn, groupId: g.id, groupName: g.name, gain }; });
  const skillList = key => Object.entries(gains[key].skills).sort((a, b) => b[1] - a[1]).map(([skill, xp]) => ({ skill, xp }));

  const who = id => { const p = playerById.get(id); const g = groupById.get(p.group_id); return { rsn: p.rsn, groupId: g.id, groupName: g.name }; };

  // 99s and 120s (from the Adventurer's Log, or set by hand by the group)
  const milestoneRows = db.prepare(`SELECT player_id, skill, level, achieved_at FROM player_skill_milestones
    WHERE achieved_at >= ? ORDER BY achieved_at DESC`).all(periods.month).filter(r => playerById.has(r.player_id));
  const milestones = {
    weekCount: milestoneRows.filter(r => r.achieved_at >= periods.week).length,
    monthCount: milestoneRows.length,
    recent: milestoneRows.filter(r => listed(r.player_id)).slice(0, 12)
      .map(r => ({ ...who(r.player_id), skill: r.skill, level: r.level, at: r.achieved_at })),
  };

  // boss kills from the Adventurer's Log, per boss and per group
  const bosses = {};
  for (const [key, cut] of Object.entries(periods)) {
    const per = new Map(), perGroup = new Map();
    let total = 0;
    const rows = db.prepare(`SELECT player_id, text, details FROM player_activities
      WHERE ts >= ? AND (text LIKE '%kill%' OR text LIKE '%defeat%' OR text LIKE '%slain%' OR text LIKE '%vanquish%')`).all(cut);
    for (const r of rows) {
      const p = playerById.get(r.player_id); if (!p) continue;
      const boss = BOSS_KILL_PATTERNS.find(b => b.pattern.test(r.text + ' ' + (r.details || '')));
      if (!boss) continue;
      const n = batchKills(r.text);
      total += n;
      per.set(boss.label, (per.get(boss.label) ?? 0) + n);
      if (listed(p.id)) perGroup.set(p.group_id, (perGroup.get(p.group_id) ?? 0) + n);
    }
    const topGroup = [...perGroup.entries()].sort((a, b) => b[1] - a[1])[0];
    bosses[key] = {
      total,
      top: [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, kills]) => ({ name, kills })),
      topGroup: topGroup ? { id: topGroup[0], name: groupById.get(topGroup[0]).name, kills: topGroup[1] } : null,
    };
  }

  // drops seen in the Adventurer's Log ("I found a ..."); the plugin's own drops are private and only counted below
  const dropRows = db.prepare(`SELECT player_id, item_name, dropped_at FROM drops
    WHERE notes = 'Auto-detected from activity feed' AND dropped_at >= ? ORDER BY dropped_at DESC`).all(periods.month)
    .filter(r => playerById.has(r.player_id));
  const drops = {
    weekCount: dropRows.filter(r => r.dropped_at >= periods.week).length,
    monthCount: dropRows.length,
    recent: dropRows.filter(r => listed(r.player_id)).slice(0, 12).map(r => ({ ...who(r.player_id), item: r.item_name, at: r.dropped_at })),
  };

  // ── the plugin: anonymous totals over everyone, never per group or player ──
  const inScope = id => playerById.has(id);
  const liveRows = db.prepare('SELECT player_id, updated_at FROM player_live_state').all().filter(r => inScope(r.player_id));
  const connected = new Set(db.prepare('SELECT DISTINCT player_id FROM plugin_tokens WHERE revoked = 0').all()
    .map(r => r.player_id).filter(inScope));
  for (const r of liveRows) connected.add(r.player_id);
  const nowMs = Date.now();
  const sumFrom = (sql, cut) => db.prepare(sql).all(cut).filter(r => inScope(r.player_id)).reduce((s, r) => s + (r.n ?? 0), 0);
  const pluginPeriod = cut => ({
    bossKills: sumFrom(`SELECT player_id, SUM(gain) n FROM progress_log WHERE kind = 'boss' AND at >= ? GROUP BY player_id`, cut),
    clues: sumFrom(`SELECT player_id, SUM(gain) n FROM progress_log WHERE kind = 'clue' AND at >= ? GROUP BY player_id`, cut),
    drops: sumFrom(`SELECT player_id, COUNT(*) n FROM drops WHERE source = 'plugin' AND dropped_at >= ? GROUP BY player_id`, cut),
    dropValue: sumFrom(`SELECT player_id, SUM(COALESCE(value_gp, 0) * COALESCE(quantity, 1)) n FROM drops WHERE source = 'plugin' AND dropped_at >= ? GROUP BY player_id`, cut),
    achievements: sumFrom(`SELECT player_id, COUNT(*) n FROM player_achievements WHERE completed_at >= ? GROUP BY player_id`, cut),
  });
  const plugin = {
    connectedPlayers: connected.size,
    groupsUsing: new Set([...connected].map(id => playerById.get(id).group_id)).size,
    onlineNow: liveRows.filter(r => nowMs - Date.parse(r.updated_at) < ONLINE_MS).length,
    week: pluginPeriod(periods.week),
    month: pluginPeriod(periods.month),
  };

  const weekXp = withMembers.reduce((s, g) => s + g.weekGain, 0);
  return {
    updatedAt: new Date().toISOString(),
    anchor, periods,
    totals: {
      groups: withMembers.length,
      activeGroups: withMembers.filter(g => g.weekGain > 0).length,
      players: players.length,
      activePlayers: [...gains.week.players.values()].filter(v => v > 0).length,
      totalXp: withMembers.reduce((s, g) => s + g.totalXp, 0),
      weekXp, monthXp: withMembers.reduce((s, g) => s + g.monthGain, 0),
      newGroupsMonth: withMembers.filter(g => (g.created_at ?? '') >= periods.month).length,
    },
    groups: groupList,
    players: { week: topPlayers('week'), month: topPlayers('month') },
    skills: { week: skillList('week'), month: skillList('month') },
    milestones, bosses, drops, plugin,
  };
}

function globalStats() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = build();
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { globalStats, _build: build, _clearCache: () => { cache = null; } };
