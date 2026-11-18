const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { BOSS_KILL_PATTERNS } = require('../services/activitySync');
const { bossKeyForNpc, MULTI_NPC_BOSSES } = require('../services/pluginSync');

// Build a label lookup from the canonical pattern list
const BOSS_LABELS = Object.fromEntries(BOSS_KILL_PATTERNS.map(b => [b.key, b.label]));

/**
 * GET /api/boss-kills?group_id=X
 * Returns boss kill counts for all players in the group.
 * Response: [{ player_id, boss_key, boss_label, kills, last_seen }]
 */
router.get('/', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });

  const feedRows = db.prepare(`
    SELECT bk.player_id, bk.boss_key, bk.kills, bk.last_seen
    FROM boss_kills bk
    JOIN players p ON p.id = bk.player_id
    WHERE p.group_id = ?
      AND bk.kills > 0
  `).all(groupId);

  // Kills counted in-game by the plugin, grouped onto the same boss keys.
  const pluginRows = db.prepare(`
    SELECT k.player_id, k.npc, k.kills, k.last_seen
    FROM plugin_npc_kills k JOIN players p ON p.id = k.player_id
    WHERE p.group_id = ?
  `).all(groupId);

  // Lifetime counts read straight from the game (the same numbers as Adventures > Beasts > Boss kills).
  const trackerRows = db.prepare(`
    SELECT b.player_id, b.name, b.kills, b.updated_at
    FROM player_boss_kills b JOIN players p ON p.id = b.player_id
    WHERE p.group_id = ?
  `).all(groupId);

  const merged = new Map(); // "player|boss" -> row
  const slot = (player_id, boss_key) => {
    const k = player_id + '|' + boss_key;
    if (!merged.has(k)) merged.set(k, { player_id, boss_key, feed: 0, plugin: 0, tracker: 0, last_seen: null });
    return merged.get(k);
  };
  for (const r of trackerRows) {
    const key = bossKeyForNpc(r.name);
    if (!key) continue;
    const m = slot(r.player_id, key);
    m.tracker += r.kills;                                   // two records can share a boss (e.g. the Barrows pair): sum them
    if (!m.last_seen || r.updated_at > m.last_seen) m.last_seen = r.updated_at;
  }
  for (const r of feedRows) { const m = slot(r.player_id, r.boss_key); m.feed = r.kills; m.last_seen = r.last_seen; }
  for (const r of pluginRows) {
    const key = bossKeyForNpc(r.npc);
    if (!key) continue;                                   // ordinary monsters are listed by /api/plugin/kills
    const m = slot(r.player_id, key);
    m.plugin += r.kills;
    if (!m.last_seen || r.last_seen > m.last_seen) m.last_seen = r.last_seen;
  }

  // The count shown: the larger of the two sources, because each only knows about kills made while it was
  // running. Multi-NPC / multi-phase fights are the exception: the plugin sees one death per NPC, so there
  // the feed number is kept (and the plugin number is returned alongside for reference).
  const rows = [...merged.values()].map(m => {
    // The game's own lifetime count is exact; it wins whenever it is available.
    if (m.tracker > 0) {
      return { player_id: m.player_id, boss_key: m.boss_key, kills: m.tracker,
        feed_kills: m.feed, plugin_kills: m.plugin, tracker_kills: m.tracker, source: 'tracker', last_seen: m.last_seen };
    }
    const usePlugin = m.plugin > m.feed && (!MULTI_NPC_BOSSES.has(m.boss_key) || m.feed === 0);
    return { player_id: m.player_id, boss_key: m.boss_key, kills: usePlugin ? m.plugin : m.feed,
      feed_kills: m.feed, plugin_kills: m.plugin, tracker_kills: 0, source: usePlugin ? 'plugin' : 'feed', last_seen: m.last_seen };
  }).filter(r => r.kills > 0)
    .sort((x, y) => x.boss_key.localeCompare(y.boss_key) || y.kills - x.kills);

  const result = rows.map(r => ({ ...r, boss_label: BOSS_LABELS[r.boss_key] ?? r.boss_key }));

  res.json(result);
});

module.exports = router;
