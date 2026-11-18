/**
 * Slayer creature kills from the game's own tracker variables (bslay_monster_killsN). Each variable packs two 16-bit
 * counters. The pairs below were matched against the in-game Adventures > Beasts values; creatures not listed are
 * not mapped yet (the game keeps their counters in variables the plugin does not read so far).
 */
const SLAYER_COUNTERS = [
  { name: 'Bloodvelds',               variable: 'bslay_monster_kills1',  half: 'high' },
  { name: 'Aberrant spectres',        variable: 'bslay_monster_kills2',  half: 'high' },
  { name: "Cres's automatons",        variable: 'bslay_monster_kills3',  half: 'high' },
  { name: 'Dust devils',              variable: 'bslay_monster_kills3',  half: 'low'  },
  { name: 'Jungle strykewyrms',       variable: 'bslay_monster_kills4',  half: 'high' },
  { name: 'Order of Ascension members', variable: 'bslay_monster_kills6', half: 'high' },
  { name: 'Gargoyles',                variable: 'bslay_monster_kills11', half: 'high' },
  { name: 'Desert strykewyrms',       variable: 'bslay_monster_kills13', half: 'low'  },
];

const half = (v, h) => (h === 'high' ? Math.floor(v / 65536) % 65536 : v % 65536);

/** { player_id, rsn, creatures: [{ name, kills }], total } for each player with kill variables. */
function slayerKills(db, groupId) {
  const rows = db.prepare(`SELECT v.player_id, p.rsn, v.name, v.value FROM player_kill_vars v JOIN players p ON p.id = v.player_id
    WHERE p.group_id = ? AND v.name LIKE 'bslay_monster_kills%'`).all(groupId);
  const byPlayer = new Map();
  for (const r of rows) {
    const e = byPlayer.get(r.player_id) ?? { player_id: r.player_id, rsn: r.rsn, vars: {} };
    e.vars[r.name] = r.value; byPlayer.set(r.player_id, e);
  }
  return [...byPlayer.values()].map(e => {
    const creatures = SLAYER_COUNTERS.filter(c => e.vars[c.variable] != null).map(c => ({ name: c.name, kills: half(e.vars[c.variable], c.half) }));
    return { player_id: e.player_id, rsn: e.rsn, creatures, total: creatures.reduce((s, c) => s + c.kills, 0) };
  });
}
module.exports = { slayerKills, SLAYER_COUNTERS };
