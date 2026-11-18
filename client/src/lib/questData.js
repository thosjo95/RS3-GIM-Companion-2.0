// Quest progress per player, from two sources:
//   • the in-game plugin  (live, exact: started / finished straight from the game)
//   • the Adventurer's Log (players.quests_json, fetched from Jagex with the hiscores sync)
// For a player who runs the plugin the plugin is authoritative; everyone else falls back to the Log.

const STATE = { finished: 'COMPLETED', started: 'STARTED', not_started: 'NOT_STARTED' };
const RANK  = { NOT_STARTED: 0, STARTED: 1, COMPLETED: 2 };

export const questKey = title => String(title).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param players      the group's players (each may carry quests_json)
 * @param pluginRows   rows from GET /api/plugin/quests: { player_id, name, state, members, points }
 * @returns Map(playerId -> { list: Quest[], live: boolean })  where Quest = { title, status, difficulty?, questPoints, members?, source }
 */
export function mergeQuests(players, pluginRows = []) {
  const byPlayer = new Map();
  for (const r of pluginRows) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }

  const out = new Map();
  for (const p of players) {
    let log = [];
    try { log = p.quests_json ? JSON.parse(p.quests_json) : []; } catch { /* unreadable log: ignore */ }
    const quests = new Map(log.map(q => [questKey(q.title), {
      title: q.title, status: q.status, difficulty: q.difficulty, questPoints: q.questPoints || 0, members: null, source: 'log',
    }]));

    const rows = byPlayer.get(p.id);
    if (rows?.length) {
      // The game can list a quest twice (old and new version): the furthest-along entry wins.
      const best = new Map();
      for (const r of rows) {
        const k = questKey(r.name);
        const status = STATE[r.state];
        const cur = best.get(k);
        if (!cur || RANK[status] > RANK[cur.status] || (RANK[status] === RANK[cur.status] && (r.points || 0) > cur.questPoints)) {
          best.set(k, { title: r.name, status, questPoints: r.points || 0, members: r.members == null ? null : !!r.members });
        }
      }
      for (const [k, r] of best) {
        const existing = quests.get(k);
        if (existing) {
          existing.status = r.status; existing.members = r.members; existing.source = 'live';
          if (!existing.questPoints) existing.questPoints = r.questPoints;
        } else {
          quests.set(k, { ...r, difficulty: undefined, source: 'live' });
        }
      }
    }
    out.set(p.id, { list: [...quests.values()], live: !!rows?.length });
  }
  return out;
}

/** Every quest any of the given players knows about, sorted by difficulty then title. */
export function masterQuestList(questData, playerIds) {
  const seen = new Map();
  for (const id of playerIds) {
    for (const q of questData.get(id)?.list ?? []) {
      const k = questKey(q.title);
      if (!seen.has(k)) seen.set(k, q);
      else if (seen.get(k).difficulty === undefined && q.difficulty !== undefined) seen.set(k, { ...seen.get(k), difficulty: q.difficulty });
    }
  }
  return [...seen.values()].sort((a, b) =>
    (a.difficulty ?? 9) - (b.difficulty ?? 9) || a.title.localeCompare(b.title));
}

/** { done, started, qp } for one player's quest list. */
export function questCounts(list) {
  let done = 0, started = 0, qp = 0;
  for (const q of list) {
    if (q.status === 'COMPLETED') { done++; qp += q.questPoints || 0; }
    else if (q.status === 'STARTED') started++;
  }
  return { done, started, qp };
}
