/**
 * GIM 2.0 — endpoints used by the in-game RuneScape plugin and the dashboard views built on it.
 *
 *   POST   /api/plugin/tokens          create an ingest token for one player   (group write auth)
 *   DELETE /api/plugin/tokens/:playerId revoke a player's tokens                (group write auth)
 *   POST   /api/plugin/ingest          the plugin pushes its data               (Bearer token)
 *   GET    /api/plugin/state?group_id  latest live state per player             (group auth)
 *   GET    /api/plugin/ledger?group_id deposits / withdrawals                   (group auth)
 *
 * Design rules:
 *  - A token belongs to exactly one player and can only write that player's data.
 *  - Every field is validated; unknown fields are ignored; a bad section rejects the request with
 *    a message the plugin author can act on.
 *  - Reads are group-authenticated (a bank is private to the group, unlike the public hiscores data).
 */
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../database');
const { checkGroupAuth } = require('../utils/auth');
const { createRateLimiter } = require('../utils/rateLimit');
const { SKILLS } = require('../services/runescape');

const TOKEN_PREFIX = 'gimp_';
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');
const SKILL_NAMES = new Set(SKILLS.filter(s => s !== 'Overall'));

const ingestLimiter = createRateLimiter({ windowMs: 60_000, max: 60, message: 'Too many plugin updates. Send at most one per second.' });

// Limits per section — generous for real use, small enough to stop abuse.
const MAX = { inventory: 100, equipment: 30, bank: 6000, changes: 500 };

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function cleanItems(list, max, label) {
  if (!Array.isArray(list)) throw new Error(`${label} must be an array`);
  if (list.length > max) throw new Error(`${label} has too many entries (max ${max})`);
  return list.map((it, i) => {
    if (!it || !isInt(it.id, 0, 1e9)) throw new Error(`${label}[${i}].id must be an integer`);
    if (!isInt(it.count, 1, Number.MAX_SAFE_INTEGER)) throw new Error(`${label}[${i}].count must be a positive integer`);
    return {
      id: it.id,
      name: typeof it.name === 'string' ? it.name.slice(0, 80) : null,
      count: it.count,
      value: Number.isFinite(it.value) && it.value >= 0 ? Math.round(it.value) : null,
    };
  });
}

function cleanPayload(b) {
  if (!b || typeof b !== 'object') throw new Error('Body must be a JSON object');
  if (b.v !== 1) throw new Error('Unsupported payload version (expected "v": 1)');
  const out = {};

  // The character the plugin is running on. Checked against the token's player in /ingest so a token can
  // never be used to store another character's data (e.g. when a member logs into an alt).
  if (b.rsn !== undefined) {
    if (typeof b.rsn !== 'string' || b.rsn.length < 1 || b.rsn.length > 40) throw new Error('rsn must be a string of 1-40 characters');
    out.rsn = b.rsn;
  }

  if (b.world !== undefined) {
    if (!isInt(b.world, 1, 5000)) throw new Error('world must be an integer');
    out.world = b.world;
  }
  if (b.position !== undefined) {
    const p = b.position;
    if (!p || !isInt(p.x, -1e6, 1e6) || !isInt(p.y, -1e6, 1e6) || !isInt(p.z, -1e6, 1e6)) {
      throw new Error('position must be { x, y, z } integers');
    }
    out.position = { x: p.x, y: p.y, z: p.z };
  }
  if (b.skills !== undefined) {
    if (!b.skills || typeof b.skills !== 'object' || Array.isArray(b.skills)) throw new Error('skills must be an object');
    out.skills = {};
    for (const [name, s] of Object.entries(b.skills)) {
      if (!SKILL_NAMES.has(name)) throw new Error(`Unknown skill "${name}"`);
      if (!s || !isInt(s.xp, 0, 5e9) || !isInt(s.level, 1, 150)) throw new Error(`skills.${name} needs integer xp and level`);
      out.skills[name] = { xp: s.xp, level: s.level };
    }
  }
  if (b.inventory !== undefined) out.inventory = cleanItems(b.inventory, MAX.inventory, 'inventory');
  if (b.equipment !== undefined) out.equipment = cleanItems(b.equipment, MAX.equipment, 'equipment');
  if (b.bank      !== undefined) out.bank      = cleanItems(b.bank,      MAX.bank,      'bank');

  if (b.storage_changes !== undefined) {
    if (!Array.isArray(b.storage_changes)) throw new Error('storage_changes must be an array');
    if (b.storage_changes.length > MAX.changes) throw new Error(`storage_changes has too many entries (max ${MAX.changes})`);
    out.changes = b.storage_changes.map((c, i) => {
      if (!c || !['group', 'bank'].includes(c.store)) throw new Error(`storage_changes[${i}].store must be "group" or "bank"`);
      if (!isInt(c.id, 0, 1e9)) throw new Error(`storage_changes[${i}].id must be an integer`);
      if (!Number.isSafeInteger(c.delta) || c.delta === 0) throw new Error(`storage_changes[${i}].delta must be a non-zero integer`);
      const ts = c.ts ? new Date(c.ts) : new Date();
      if (isNaN(ts.getTime())) throw new Error(`storage_changes[${i}].ts is not a valid date`);
      return {
        store: c.store, id: c.id, delta: c.delta,
        name: typeof c.name === 'string' ? c.name.slice(0, 80) : null,
        value: Number.isFinite(c.value) && c.value >= 0 ? Math.round(c.value) : null,
        ts: ts.toISOString(),
      };
    });
  }
  return out;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

router.post('/tokens', (req, res) => {
  const player = db.prepare('SELECT id, group_id FROM players WHERE id = ?').get(Number(req.body?.player_id));
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!player.group_id) return res.status(403).json({ error: 'Player is not attached to a group' });
  if (!checkGroupAuth(req, res, player.group_id)) return;

  // One live token per player: minting a new one invalidates the old (lost-token recovery).
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  db.prepare('UPDATE plugin_tokens SET revoked = 1 WHERE player_id = ?').run(player.id);
  db.prepare('INSERT INTO plugin_tokens (player_id, token_hash) VALUES (?, ?)').run(player.id, hashToken(token));
  res.status(201).json({ player_id: player.id, token }); // shown once — only the hash is stored
});

router.delete('/tokens/:playerId', (req, res) => {
  const player = db.prepare('SELECT id, group_id FROM players WHERE id = ?').get(Number(req.params.playerId));
  if (!player) return res.status(404).json({ error: 'Player not found' });
  if (!player.group_id) return res.status(403).json({ error: 'Player is not attached to a group' });
  if (!checkGroupAuth(req, res, player.group_id)) return;
  db.prepare('UPDATE plugin_tokens SET revoked = 1 WHERE player_id = ?').run(player.id);
  res.json({ success: true });
});

// ── Ingest (called by the Lua plugin) ─────────────────────────────────────────

router.post('/ingest', ingestLimiter, express.json({ limit: '1mb' }), (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token.startsWith(TOKEN_PREFIX)) return res.status(401).json({ error: 'Missing or invalid plugin token' });

  const row = db.prepare('SELECT id, player_id FROM plugin_tokens WHERE token_hash = ? AND revoked = 0').get(hashToken(token));
  if (!row) return res.status(401).json({ error: 'Missing or invalid plugin token' });

  let data;
  try { data = cleanPayload(req.body); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const playerId = row.player_id;
  if (data.rsn !== undefined) {
    // RuneScape treats spaces, underscores and non-breaking spaces as the same character in a name.
    const norm = (s) => String(s).toLowerCase().replace(/[\s_ -]+/g, ' ').trim();
    const owner = db.prepare('SELECT rsn FROM players WHERE id = ?').get(playerId);
    if (!owner || norm(owner.rsn) !== norm(data.rsn)) {
      return res.status(409).json({ error: 'character_mismatch', message: 'This token belongs to a different character.' });
    }
  }
  const now = new Date().toISOString();
  const prev = db.prepare('SELECT * FROM player_live_state WHERE player_id = ?').get(playerId) || {};
  const j = (fresh, old) => (fresh !== undefined ? JSON.stringify(fresh) : (old ?? null));

  let ledgerAdded = 0;
  db.runTransaction(() => {
    db.prepare(`
      INSERT INTO player_live_state (player_id, updated_at, world, position_json, skills_json, inventory_json, equipment_json, bank_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET
        updated_at = excluded.updated_at, world = excluded.world, position_json = excluded.position_json,
        skills_json = excluded.skills_json, inventory_json = excluded.inventory_json,
        equipment_json = excluded.equipment_json, bank_json = excluded.bank_json
    `).run(
      playerId, now, data.world ?? prev.world ?? null,
      j(data.position, prev.position_json), j(data.skills, prev.skills_json),
      j(data.inventory, prev.inventory_json), j(data.equipment, prev.equipment_json), j(data.bank, prev.bank_json),
    );

    const ins = db.prepare(`
      INSERT OR IGNORE INTO storage_ledger (player_id, store, item_id, item_name, delta, value_each, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of data.changes ?? []) ledgerAdded += ins.run(playerId, c.store, c.id, c.name, c.delta, c.value, c.ts).changes;

    db.prepare('UPDATE plugin_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
  });

  res.json({ ok: true, ledger_added: ledgerAdded });
});

// ── Reads (group-authenticated) ───────────────────────────────────────────────

const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

router.get('/state', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;

  const rows = db.prepare(`
    SELECT p.id AS player_id, p.rsn,
           s.updated_at, s.world, s.position_json, s.skills_json, s.inventory_json, s.equipment_json, s.bank_json,
           (SELECT MAX(last_used_at) FROM plugin_tokens t WHERE t.player_id = p.id AND t.revoked = 0) AS token_last_used,
           EXISTS (SELECT 1 FROM plugin_tokens t WHERE t.player_id = p.id AND t.revoked = 0) AS has_token
    FROM players p
    LEFT JOIN player_live_state s ON s.player_id = p.id
    WHERE p.group_id = ?
    ORDER BY p.rsn
  `).all(groupId);

  res.json(rows.map(r => ({
    player_id: r.player_id, rsn: r.rsn, has_token: !!r.has_token, token_last_used: r.token_last_used,
    updated_at: r.updated_at, world: r.world,
    position: parse(r.position_json), skills: parse(r.skills_json),
    inventory: parse(r.inventory_json) ?? [], equipment: parse(r.equipment_json) ?? [], bank: parse(r.bank_json) ?? [],
  })));
});

router.get('/ledger', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);

  const rows = db.prepare(`
    SELECT l.id, l.player_id, p.rsn, l.store, l.item_id, l.item_name, l.delta, l.value_each, l.occurred_at
    FROM storage_ledger l JOIN players p ON p.id = l.player_id
    WHERE p.group_id = ?
    ORDER BY l.occurred_at DESC, l.id DESC
    LIMIT ?
  `).all(groupId, limit);
  res.json(rows);
});

module.exports = router;
