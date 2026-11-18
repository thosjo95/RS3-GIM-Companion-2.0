const express      = require('express');
const router       = express.Router();
const path         = require('path');
const { execFile } = require('child_process');
const db           = require('../database');
const {
  hashPassword, verifyPassword, issueToken,
  checkRateLimit, recordFailedAttempt, clearRateLimit, requireAdmin,
} = require('../utils/adminAuth');
const { sanitizeRSN } = require('../services/runescape');

// ── POST /api/admin/login ─────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  // Rate-limit check
  const rl = checkRateLimit(ip);
  if (rl.blocked) {
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${rl.secsLeft}s.` });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  let ok;
  try { ok = verifyPassword(password, user.password_hash, user.salt); }
  catch { ok = false; }

  if (!ok) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Success — clear rate limit, update last_login, issue token
  clearRateLimit(ip);
  db.prepare('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = issueToken(user.username);
  res.json({ token, username: user.username });
});

// ── All routes below require a valid admin JWT ────────────────────────────────

// GET /api/admin/table/:name — browse any RS3 reference table
router.get('/table/:name', requireAdmin, (req, res) => {
  const ALLOWED = ['rs3_bosses','rs3_quests','rs3_gear_items','rs3_gear_paths','rs3_milestone_items','rs3_slayer_creatures','rs3_skill_milestones'];
  if (!ALLOWED.includes(req.params.name)) return res.status(400).json({ error: 'Unknown table' });
  const { search } = req.query;
  let sql = `SELECT * FROM ${req.params.name}`;
  const params = [];
  if (search) { sql += ' WHERE id LIKE ? OR name LIKE ?'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY id LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /api/admin/stats — dashboard counters
router.get('/stats', requireAdmin, (req, res) => {
  const tables = ['rs3_bosses','rs3_quests','rs3_gear_items','rs3_gear_paths','rs3_milestone_items','rs3_slayer_creatures','rs3_skill_milestones'];
  const counts = {};
  for (const t of tables) {
    counts[t] = db.prepare(`SELECT COUNT(*) as n FROM ${t}`).get().n;
  }
  res.json({ table_counts: counts });
});

// ── Maintenance operations ─────────────────────────────────────────────────────

// GET /api/admin/groups — full group listing used by the Groups tab
router.get('/groups', requireAdmin, (req, res) => {
  const groups = db.prepare(`
    SELECT
      g.id,
      g.name,
      g.group_rsn,
      g.gim_type,
      g.gim_size,
      CASE WHEN g.password_hash IS NOT NULL THEN 1 ELSE 0 END AS claimed,
      g.claimed_v2_at,
      g.needs_rekey,
      CASE WHEN g.discord_webhook_url IS NOT NULL THEN 1 ELSE 0 END AS has_webhook,
      g.last_activity,
      g.created_at,
      (SELECT COUNT(*) FROM players WHERE group_id = g.id) AS player_count,
      (SELECT COUNT(*) FROM players WHERE group_id = g.id AND sync_error IS NOT NULL) AS error_count
    FROM groups g ORDER BY g.id DESC
  `).all();
  res.json(groups);
});

// GET /api/admin/maintenance/groups — list all groups with player counts
router.get('/maintenance/groups', requireAdmin, (req, res) => {
  const groups = db.prepare(`
    SELECT
      g.id,
      g.name,
      g.group_rsn,
      g.gim_type,
      g.gim_size,
      CASE WHEN g.password_hash IS NOT NULL THEN 1 ELSE 0 END AS claimed,
      (SELECT COUNT(*) FROM players WHERE group_id = g.id) AS player_count,
      g.created_at
    FROM groups g ORDER BY g.id DESC
  `).all();
  res.json(groups);
});

// GET /api/admin/maintenance/groups/:id/players — list players in a group
router.get('/maintenance/groups/:id/players', requireAdmin, (req, res) => {
  const players = db.prepare(
    'SELECT id, rsn, combat_level, last_synced AS last_synced_at, sync_error FROM players WHERE group_id = ? ORDER BY rsn'
  ).all(req.params.id);
  res.json(players);
});

// POST /api/admin/maintenance/move-players — move all players from one group to another
router.post('/maintenance/move-players', requireAdmin, (req, res) => {
  const { from_group_id, to_group_id } = req.body;
  if (!from_group_id || !to_group_id) return res.status(400).json({ error: 'from_group_id and to_group_id required' });
  const moved = db.prepare('UPDATE players SET group_id = ? WHERE group_id = ?').run(Number(to_group_id), Number(from_group_id));
  res.json({ success: true, moved: moved.changes, message: `Moved ${moved.changes} player(s) from group #${from_group_id} → #${to_group_id}` });
});

// POST /api/admin/maintenance/delete-orphan-group — delete a group that has 0 players
router.post('/maintenance/delete-orphan-group', requireAdmin, (req, res) => {
  const { group_id } = req.body;
  if (!group_id) return res.status(400).json({ error: 'group_id required' });
  const gid = Number(group_id);
  const playerCount = db.prepare('SELECT COUNT(*) as n FROM players WHERE group_id = ?').get(gid).n;
  if (playerCount > 0) return res.status(409).json({ error: `Group ${gid} still has ${playerCount} player(s). Move or delete them first.` });
  const deleted = db.prepare('DELETE FROM groups WHERE id = ?').run(gid);
  if (!deleted.changes) return res.status(404).json({ error: `Group ${gid} not found` });
  res.json({ success: true, message: `Deleted empty group #${gid}` });
});

// POST /api/admin/maintenance/reset-secret — clear a group's password so they can re-claim
router.post('/maintenance/reset-secret', requireAdmin, (req, res) => {
  const { group_id } = req.body;
  if (!group_id) return res.status(400).json({ error: 'group_id required' });
  const gid = Number(group_id);
  const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(gid);
  if (!group) return res.status(404).json({ error: `Group ${gid} not found` });
  db.prepare('UPDATE groups SET password_hash = NULL, password_salt = NULL, needs_rekey = 0, claimed_v2_at = NULL WHERE id = ?').run(gid);
  res.json({ success: true, message: `Secret cleared for "${group.name}" (id ${gid}). They can now re-claim.` });
});

// POST /api/admin/maintenance/new-secret — give a group a new secret right away (for a group that lost theirs). Unlike
// reset-secret there is no moment where the group is unclaimed. The old secret stops working at once; plugins that
// already joined keep sending (their keys stay valid). The new secret is shown once, to the admin.
router.post('/maintenance/new-secret', requireAdmin, (req, res) => {
  const gid = Number(req.body?.group_id);
  if (!gid) return res.status(400).json({ error: 'group_id required' });
  const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(gid);
  if (!group) return res.status(404).json({ error: `Group ${gid} not found` });
  const { newGroupSecret } = require('./groups');
  const { hashPassword } = require('../utils/auth');
  const secret = newGroupSecret();
  const pw = hashPassword(secret);
  db.prepare('UPDATE groups SET password_hash = ?, password_salt = ?, needs_rekey = 0, claimed_v2_at = CURRENT_TIMESTAMP WHERE id = ?').run(pw.hash, pw.salt, gid);
  res.json({ success: true, secret, message: `New secret for "${group.name}" (id ${gid}): ${secret}  (shown once: pass it to the group; the old one no longer works)` });
});

// POST /api/admin/maintenance/delete-group — permanently delete a group and all its players
router.post('/maintenance/delete-group', requireAdmin, (req, res) => {
  const { group_id } = req.body;
  if (!group_id) return res.status(400).json({ error: 'group_id required' });
  const gid = Number(group_id);
  const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(gid);
  if (!group) return res.status(404).json({ error: `Group ${gid} not found` });
  const playerCount = db.prepare('SELECT COUNT(*) as n FROM players WHERE group_id = ?').get(gid).n;
  db.prepare('DELETE FROM players WHERE group_id = ?').run(gid);
  db.prepare('DELETE FROM groups WHERE id = ?').run(gid);
  res.json({ success: true, message: `Deleted group "${group.name}" (id ${gid}) and ${playerCount} player(s). All related data cascaded.` });
});

// POST /api/admin/maintenance/fix-rsn — overwrite a player's RSN and clear their sync error
router.post('/maintenance/fix-rsn', requireAdmin, (req, res) => {
  const { player_id, rsn } = req.body;
  if (!player_id || !rsn) return res.status(400).json({ error: 'player_id and rsn required' });
  const clean = sanitizeRSN(rsn.trim());
  const player = db.prepare('SELECT id, rsn FROM players WHERE id = ?').get(Number(player_id));
  if (!player) return res.status(404).json({ error: `Player ${player_id} not found` });
  db.prepare('UPDATE players SET rsn = ?, sync_error = NULL WHERE id = ?').run(clean, Number(player_id));
  res.json({ success: true, old_rsn: player.rsn, new_rsn: clean, message: `Player #${player_id}: "${player.rsn}" → "${clean}". Sync error cleared.` });
});

// ── Database refresh ──────────────────────────────────────────────

// POST /api/admin/maintenance/reseed — re-run the seed script (all upserts are idempotent)
router.post('/maintenance/reseed', requireAdmin, (req, res) => {
  const scriptPath = path.resolve(__dirname, '../scripts/seedRs3Data.js');
  execFile(process.execPath, [scriptPath], { cwd: path.resolve(__dirname, '..'), timeout: 30000 },
    (err, stdout, stderr) => {
      const output = (stdout + '\n' + stderr).trim().slice(-1200);
      if (err) return res.status(500).json({ error: err.message, output });
      res.json({ success: true, message: 'Seed data re-applied successfully.', output });
    }
  );
});

module.exports = router;
