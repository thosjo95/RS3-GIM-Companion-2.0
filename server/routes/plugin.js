/**
 * GIM 2.0 — endpoints used by the in-game RuneScape plugin and the dashboard views built on it.
 *
 *   POST   /api/plugin/tokens          create an ingest token for one player   (group write auth)
 *   DELETE /api/plugin/tokens/:playerId revoke a player's tokens                (group write auth)
 *   POST   /api/plugin/ingest          the plugin pushes its data               (Bearer token)
 *   GET    /api/plugin/state?group_id  latest live state per player             (group auth)
 *   GET    /api/plugin/ledger?group_id group storage in/out (the Bank Journal)  (group auth)
 *   GET    /api/plugin/config          drop rules for the plugin                (Bearer token)
 *   GET    /api/plugin/quests?group_id quest progress per player                (group auth)
 *   GET    /api/plugin/kills?group_id  NPC kills counted by the plugin          (group auth)
 *   GET    /api/plugin/achievements?group_id  completed achievements / area tasks (group auth)
 *   GET    /api/plugin/boss-kills?group_id    lifetime boss kills from the game       (group auth)
 *   GET    /api/plugin/kill-vars?group_id     the game's kill tracker values, raw    (group auth)
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
const sync = require('../services/pluginSync');
sync.backfillAreaTasks();   // achievements stored before the area task mapping existed

const TOKEN_PREFIX = 'gimp_';
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');
const SKILL_NAMES = new Set(SKILLS.filter(s => s !== 'Overall'));

const ingestLimiter = createRateLimiter({ windowMs: 60_000, max: 60, message: 'Too many plugin updates. Send at most one per second.' });

// Limits per section — generous for real use, small enough to stop abuse.
const MAX = { inventory: 100, equipment: 30, bank: 6000, changes: 500, quests: 900, kills: 200, drops: 50, achievements: 1500 };
// gp; the plugin also reports any item named in a boss's drop table. GIM_DROP_THRESHOLD overrides it for testing.
const DROP_THRESHOLD = Number(process.env.GIM_DROP_THRESHOLD) || 100_000;

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
      ...(isInt(it.slot, 0, 63) ? { slot: it.slot } : {}),
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
  if (b.group_storage !== undefined) out.groupStorage = cleanItems(b.group_storage, MAX.bank, 'group_storage');

  if (b.storage_changes !== undefined) {
    if (!Array.isArray(b.storage_changes)) throw new Error('storage_changes must be an array');
    if (b.storage_changes.length > MAX.changes) throw new Error(`storage_changes has too many entries (max ${MAX.changes})`);
    if (b.changes_ref !== undefined) {
      if (typeof b.changes_ref !== 'string' || b.changes_ref.length < 4 || b.changes_ref.length > 64) throw new Error('changes_ref must be a string of 4-64 characters');
      out.changesRef = b.changes_ref;
    }
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

  if (b.quests !== undefined) {
    if (!Array.isArray(b.quests)) throw new Error('quests must be an array');
    if (b.quests.length > MAX.quests) throw new Error(`quests has too many entries (max ${MAX.quests})`);
    out.quests = b.quests.map((q, i) => {
      if (!q || !isInt(q.id, 0, 1e6)) throw new Error(`quests[${i}].id must be an integer`);
      if (typeof q.name !== 'string' || !q.name.trim() || q.name.length > 100) throw new Error(`quests[${i}].name must be a string`);
      if (!['not_started', 'started', 'finished'].includes(q.state)) throw new Error(`quests[${i}].state must be not_started, started or finished`);
      return { id: q.id, name: q.name.trim(), state: q.state,
        members: q.members === undefined ? null : (q.members ? 1 : 0),
        points: isInt(q.points, 0, 1000) ? q.points : null,
        canStart: q.can_start === undefined ? null : (q.can_start ? 1 : 0) };
    });
    out.questsFull = b.quests_full === true;
  }

  if (b.achievements !== undefined) {
    if (!Array.isArray(b.achievements)) throw new Error('achievements must be an array');
    if (b.achievements.length > MAX.achievements) throw new Error(`achievements has too many entries (max ${MAX.achievements})`);
    out.achievements = b.achievements.map((a, i) => {
      if (!a || !isInt(a.id, 0, 1e7)) throw new Error(`achievements[${i}].id must be an integer`);
      if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 160) throw new Error(`achievements[${i}].name must be a string`);
      const opt = v => (isInt(v, -1, 1e7) ? v : null);
      return { id: a.id, name: a.name.trim(), category: opt(a.category), sub: opt(a.sub_category), completed: a.completed !== false,
        description: typeof a.description === 'string' ? a.description.slice(0, 300) : null,
        reward: typeof a.reward === 'string' ? a.reward.slice(0, 200) : null,
        tallyProgress: isInt(a.tally_progress, 0, 2147483647) ? a.tally_progress : null,
        tallyTarget: isInt(a.tally_target, 1, 2147483647) ? a.tally_target : null,
        members: a.members === undefined ? null : (a.members ? 1 : 0), score: isInt(a.rune_score, 0, 1e6) ? a.rune_score : null };
    });
    out.achievementsFull = b.achievements_full === true;
  }

  if (b.boss_kills !== undefined) {
    if (!Array.isArray(b.boss_kills)) throw new Error('boss_kills must be an array');
    if (b.boss_kills.length > 150) throw new Error('boss_kills has too many entries (max 150)');
    out.bossKills = b.boss_kills.map((k, i) => {
      if (!k || typeof k.key !== 'string' || !/^[A-Z0-9_]{3,60}$/.test(k.key)) throw new Error(`boss_kills[${i}].key must be an upper-case record name`);
      if (typeof k.name !== 'string' || !k.name.trim() || k.name.length > 80) throw new Error(`boss_kills[${i}].name must be a string`);
      if (!isInt(k.kills, 0, 1e9)) throw new Error(`boss_kills[${i}].kills must be a non-negative integer`);
      return { key: k.key, name: k.name.trim(), kills: k.kills,
        combatReq: isInt(k.combat_req, 0, 5000) ? k.combat_req : null, isGroup: k.group === undefined ? null : (k.group ? 1 : 0) };
    });
  }

  if (b.kill_vars !== undefined) {
    const kv = b.kill_vars;
    if (!kv || typeof kv !== 'object' || Array.isArray(kv)) throw new Error('kill_vars must be an object');
    const entries = Object.entries(kv);
    if (entries.length > 200) throw new Error('kill_vars has too many entries (max 200)');
    out.killVars = entries.map(([name, value]) => {
      if (!/^[a-z0-9_]{1,60}$/.test(name)) throw new Error(`kill_vars name "${name}" is not valid`);
      if (!isInt(value, 0, 2147483647)) throw new Error(`kill_vars.${name} must be a non-negative integer`);
      return [name, value];
    });
  }

  if (b.kills !== undefined) {
    if (!Array.isArray(b.kills)) throw new Error('kills must be an array');
    if (b.kills.length > MAX.kills) throw new Error(`kills has too many entries (max ${MAX.kills})`);
    if (b.kills_ref !== undefined) {
      if (typeof b.kills_ref !== 'string' || b.kills_ref.length < 4 || b.kills_ref.length > 64) throw new Error('kills_ref must be a string of 4-64 characters');
      out.killsRef = b.kills_ref;
    }
    out.kills = b.kills.map((k, i) => {
      if (!k || typeof k.npc !== 'string' || !k.npc.trim() || k.npc.length > 80) throw new Error(`kills[${i}].npc must be a string`);
      if (!isInt(k.kills, 1, 10000)) throw new Error(`kills[${i}].kills must be an integer between 1 and 10000`);
      return { npc: k.npc.trim(), kills: k.kills };
    });
  }

  if (b.drops !== undefined) {
    if (!Array.isArray(b.drops)) throw new Error('drops must be an array');
    if (b.drops.length > MAX.drops) throw new Error(`drops has too many entries (max ${MAX.drops})`);
    out.drops = b.drops.map((d, i) => {
      if (!d || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 80) throw new Error(`drops[${i}].name must be a string`);
      if (typeof d.ref !== 'string' || d.ref.length < 4 || d.ref.length > 64) throw new Error(`drops[${i}].ref must be a unique string of 4-64 characters`);
      if (!isInt(d.quantity, 1, Number.MAX_SAFE_INTEGER)) throw new Error(`drops[${i}].quantity must be a positive integer`);
      const ts = d.ts ? new Date(d.ts) : null;
      if (ts && isNaN(ts.getTime())) throw new Error(`drops[${i}].ts is not a valid date`);
      return { ref: d.ref, name: d.name.trim(), quantity: d.quantity,
        value: Number.isFinite(d.value) && d.value >= 0 ? Math.round(d.value) : null,
        npc: typeof d.npc === 'string' && d.npc.trim() ? d.npc.trim().slice(0, 80) : null,
        ts: ts ? ts.toISOString() : null };
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
  const applied = {};
  db.runTransaction(() => {
    // A heartbeat usually carries nothing new: write only the columns that arrived, not the whole row (a bank is
    // 100 KB; rewriting it every 30 seconds for every online player is pure waste).
    const set = { updated_at: now };
    if (data.world !== undefined) set.world = data.world;
    if (data.position !== undefined) set.position_json = JSON.stringify(data.position);
    if (data.skills !== undefined) set.skills_json = JSON.stringify(data.skills);
    if (data.inventory !== undefined) set.inventory_json = JSON.stringify(data.inventory);
    if (data.equipment !== undefined) set.equipment_json = JSON.stringify(data.equipment);
    if (data.bank !== undefined) set.bank_json = JSON.stringify(data.bank);
    if (data.groupStorage !== undefined) { set.group_storage_json = JSON.stringify(data.groupStorage); set.group_storage_at = now; }
    if (prev.player_id === undefined) {
      const cols = Object.keys(set);
      db.prepare(`INSERT INTO player_live_state (player_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(playerId, ...cols.map(c => set[c]));
    } else {
      const cols = Object.keys(set);
      db.prepare(`UPDATE player_live_state SET ${cols.map(c => c + ' = ?').join(', ')} WHERE player_id = ?`).run(...cols.map(c => set[c]), playerId);
    }

    const ins = db.prepare(`
      INSERT OR IGNORE INTO storage_ledger (player_id, store, item_id, item_name, delta, value_each, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const freshChanges = !data.changes || sync.claimBatch(playerId, data.changesRef);
    // The Bank Journal is about the group storage only; bank movements from older plugin versions are ignored.
    for (const c of freshChanges ? (data.changes ?? []).filter(x => x.store === 'group') : []) ledgerAdded += ins.run(playerId, c.store, c.id, c.name, c.delta, c.value, c.ts).changes;

    if (data.quests) applied.quests = sync.applyQuests(playerId, data.quests, data.questsFull, now);
    if (data.bossKills) {
      const up = db.prepare(`INSERT INTO player_boss_kills (player_id, key, name, kills, updated_at, combat_req, is_group) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id, key) DO UPDATE SET name = excluded.name, kills = excluded.kills, updated_at = excluded.updated_at,
          combat_req = COALESCE(excluded.combat_req, combat_req), is_group = COALESCE(excluded.is_group, is_group)`);
      for (const k of data.bossKills) up.run(playerId, k.key, k.name, k.kills, now, k.combatReq, k.isGroup);
      applied.boss_kills = data.bossKills.length;
    }
    if (data.killVars) {
      const up = db.prepare('INSERT INTO player_kill_vars (player_id, name, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(player_id, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
      for (const [name, value] of data.killVars) up.run(playerId, name, value, now);
      applied.kill_vars = data.killVars.length;
    }
    if (data.achievements) applied.achievements = sync.applyAchievements(playerId, data.achievements, data.achievementsFull, now);
    if (data.kills) applied.kills_applied = sync.applyKills(playerId, data.kills, data.killsRef, now);
    if (data.drops) applied.drops_added = sync.applyDrops(playerId, data.drops);

    db.prepare('UPDATE plugin_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
  });

  if (data.quests || data.achievements || data.bossKills || data.skills || data.kills) {
    try {
      const gid = db.prepare('SELECT group_id FROM players WHERE id = ?').get(playerId)?.group_id;
      if (gid) require('../services/goalTracker').reconcileGoals(gid, { announce: true });
      require('../services/metrics').snapshotPlayer(playerId);
    } catch (e) { console.error('[goals] reconcile failed:', e.message); }
  }

  res.json({ ok: true, ledger_added: ledgerAdded, ...applied });
});

// ── Reads (group-authenticated) ───────────────────────────────────────────────

const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

router.get('/state', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;

  // Pages ask only for what they show, so a banks page does not download everyone's backpack and a skills panel does not
  // download banks:  ?include=bank,group_storage,inventory,equipment,skills,position  (default: all, as before)
  //                  ?player_id=N            one player only
  //                  ?group_storage=latest   the shared storage once (from the newest snapshot) instead of once per member
  const ALL = ['position', 'skills', 'inventory', 'equipment', 'bank', 'group_storage'];
  const want = req.query.include === undefined ? ALL : String(req.query.include).split(',').map(x => x.trim()).filter(x => ALL.includes(x));
  const col = { position: 'position_json', skills: 'skills_json', inventory: 'inventory_json', equipment: 'equipment_json', bank: 'bank_json', group_storage: 'group_storage_json' };
  const only = parseInt(req.query.player_id, 10);
  const latest = req.query.group_storage === 'latest';
  const selected = want.map(w => `s.${col[w]}`).join(', ');

  const rows = db.prepare(`
    SELECT p.id AS player_id, p.rsn, s.updated_at, s.world, s.group_storage_at${selected ? ', ' + selected : ''},
           (SELECT MAX(last_used_at) FROM plugin_tokens t WHERE t.player_id = p.id AND t.revoked = 0) AS token_last_used,
           EXISTS (SELECT 1 FROM plugin_tokens t WHERE t.player_id = p.id AND t.revoked = 0) AS has_token
    FROM players p
    LEFT JOIN player_live_state s ON s.player_id = p.id
    WHERE p.group_id = ?${Number.isInteger(only) ? ' AND p.id = ' + only : ''}
    ORDER BY p.rsn
  `).all(groupId);

  // with group_storage=latest only the row with the newest storage snapshot carries the contents
  let storageOwner = null;
  if (latest && want.includes('group_storage')) {
    for (const r of rows) if (r.group_storage_at && (!storageOwner || r.group_storage_at > storageOwner.group_storage_at)) storageOwner = r;
  }

  res.json(rows.map(r => {
    const out = { player_id: r.player_id, rsn: r.rsn, has_token: !!r.has_token, token_last_used: r.token_last_used, updated_at: r.updated_at, world: r.world, group_storage_at: r.group_storage_at };
    if (want.includes('position')) out.position = parse(r.position_json);
    if (want.includes('skills')) out.skills = parse(r.skills_json);
    if (want.includes('inventory')) out.inventory = parse(r.inventory_json) ?? [];
    if (want.includes('equipment')) out.equipment = parse(r.equipment_json) ?? [];
    if (want.includes('bank')) out.bank = parse(r.bank_json) ?? [];
    if (want.includes('group_storage')) out.group_storage = latest && r !== storageOwner ? [] : (parse(r.group_storage_json) ?? []);
    return out;
  }));
});

router.get('/ledger', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);

  const rows = db.prepare(`
    SELECT l.id, l.player_id, p.rsn, l.store, l.item_id, l.item_name, l.delta, l.value_each, l.occurred_at
    FROM storage_ledger l JOIN players p ON p.id = l.player_id
    WHERE p.group_id = ? AND l.store = 'group'
    ORDER BY l.occurred_at DESC, l.id DESC
    LIMIT ?
  `).all(groupId, limit);
  res.json(rows);
});

// The plugin fetches these rules when it starts: which drops are worth reporting.
router.get('/config', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const ok = token.startsWith(TOKEN_PREFIX) && db.prepare('SELECT 1 FROM plugin_tokens WHERE token_hash = ? AND revoked = 0').get(hashToken(token));
  if (!ok) return res.status(401).json({ error: 'Missing or invalid plugin token' });
  res.json({ drop_threshold: DROP_THRESHOLD, rare_names: sync.rareItemNames() });
});

// GET /api/plugin/presence?group_id= — who is online and playing: the plugin has been heard from in the last 3 minutes.
// Only the time is shared (no world, no position).
router.get('/presence', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  const rows = db.prepare(`SELECT p.id AS player_id, s.updated_at FROM players p JOIN player_live_state s ON s.player_id = p.id WHERE p.group_id = ?`).all(groupId);
  const now = Date.now();
  res.json(rows.map(r => {
    const t = Date.parse(r.updated_at);
    return { player_id: r.player_id, last_seen: r.updated_at, online: Number.isFinite(t) && now - t < 3 * 60 * 1000 };
  }));
});

router.get('/quests', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  res.json(db.prepare(`
    SELECT q.player_id, p.rsn, q.quest_id, q.name, q.state, q.members, q.points, q.updated_at
    FROM player_quests q JOIN players p ON p.id = q.player_id
    WHERE p.group_id = ? ORDER BY q.name, p.rsn
  `).all(groupId));
});

router.get('/achievements', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  res.json(db.prepare(`
    SELECT a.player_id, p.rsn, a.achievement_id, a.name, a.category, a.sub_category, a.members, a.rune_score, a.completed_at, a.completed,
           a.description, a.reward, a.tally_progress, a.tally_target
    FROM player_achievements a JOIN players p ON p.id = a.player_id
    WHERE p.group_id = ? ORDER BY a.name, p.rsn
  `).all(groupId));
});

router.get('/boss-kills', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  res.json(db.prepare(`
    SELECT b.player_id, p.rsn, b.key, b.name, b.kills, b.updated_at
    FROM player_boss_kills b JOIN players p ON p.id = b.player_id
    WHERE p.group_id = ? ORDER BY b.kills DESC
  `).all(groupId));
});

router.get('/slayer-kills', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  res.json(require('../services/slayerKills').slayerKills(db, groupId));
});

router.get('/kill-vars', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  res.json(db.prepare(`
    SELECT v.player_id, p.rsn, v.name, v.value, v.updated_at
    FROM player_kill_vars v JOIN players p ON p.id = v.player_id
    WHERE p.group_id = ? ORDER BY v.name, p.rsn
  `).all(groupId));
});

router.get('/kills', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!checkGroupAuth(req, res, groupId)) return;
  res.json(db.prepare(`
    SELECT k.player_id, p.rsn, k.npc, k.kills, k.last_seen
    FROM plugin_npc_kills k JOIN players p ON p.id = k.player_id
    WHERE p.group_id = ? ORDER BY k.kills DESC
  `).all(groupId));
});

module.exports = router;
