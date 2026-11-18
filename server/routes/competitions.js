const express = require('express');
const router = express.Router();
const db = require('../database');
const { checkGroupAuth, verifyGroupPassword } = require('../utils/auth');
const { standings, snapshotPlayer, PLUGIN_METRICS } = require('../services/metrics');

const PERIODS = { day: 24 * 3600 * 1000, week: 7 * 24 * 3600 * 1000, month: 30 * 24 * 3600 * 1000 };
const METRICS = ['xp', 'quest_points', 'boss_kills', 'slayer_kills', 'total_level', 'drops'];

// The boards every group has by default (group leaderboard on the front page).
const DEFAULT_BOARDS = [
  { id: 'xp',       title: 'Most XP gained',         metric: 'xp',           target: 'Overall', unit: 'XP' },
  { id: 'levels',   title: 'Most levels gained',      metric: 'total_level',  target: null,      unit: 'levels' },
  { id: 'quests',   title: 'Most quest points',       metric: 'quest_points', target: null,      unit: 'quest points' },
  { id: 'bosses',   title: 'Most boss kills',         metric: 'boss_kills',   target: 'all',     unit: 'kills' },
  { id: 'slayer',   title: 'Most slayer kills',       metric: 'slayer_kills', target: null,      unit: 'kills' },
  { id: 'drops',    title: 'Most drops',              metric: 'drops',        target: null,      unit: 'drops' },
];

// A read is "unlocked" when the group has no secret or the request carries the right one. Plugin-based numbers are
// only shown to those; the hiscores-based ones are public like the rest of the hiscores data.
function unlocked(req, groupId) {
  const g = db.prepare('SELECT id, password_hash, password_salt FROM groups WHERE id = ?').get(groupId);
  if (!g) return false;
  if (!g.password_hash) return true;
  const pw = req.headers['x-group-password'];
  return !!pw && verifyGroupPassword(pw, g);
}

const players = groupId => db.prepare('SELECT id, rsn FROM players WHERE group_id = ?').all(groupId);

// GET /api/competitions/leaderboard?group_id=&period=day|week|month
router.get('/leaderboard', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  const period = PERIODS[req.query.period] ? req.query.period : 'week';
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  const open = unlocked(req, groupId);
  const list = players(groupId);
  const startMs = Date.now() - PERIODS[period];
  res.json({
    period, since: new Date(startMs).toISOString(),
    boards: DEFAULT_BOARDS.map(b => (PLUGIN_METRICS.has(b.metric) && !open
      ? { ...b, locked: true, rows: [] }
      : { ...b, locked: false, rows: standings(list, b.metric, b.target, startMs) })),
  });
});

const cleanComp = (b, groupId) => {
  const title = String(b.title ?? '').trim().slice(0, 80);
  if (!title) throw new Error('A name is required');
  if (!METRICS.includes(b.metric)) throw new Error('Unknown metric');
  const starts = Date.parse(b.starts_at);
  if (!Number.isFinite(starts)) throw new Error('A valid start time is required');
  let ends = null;
  if (b.ends_at) { ends = Date.parse(b.ends_at); if (!Number.isFinite(ends) || ends <= starts) throw new Error('The end must be after the start'); }
  const goal = b.goal === '' || b.goal == null ? null : Number(b.goal);
  if (goal != null && (!Number.isFinite(goal) || goal <= 0)) throw new Error('The goal must be a positive number');
  return { group_id: groupId, title, metric: b.metric, target: b.target ? String(b.target).slice(0, 60) : null,
    starts_at: new Date(starts).toISOString(), ends_at: ends != null ? new Date(ends).toISOString() : null, goal };
};

function present(c, open, list) {
  const startMs = Date.parse(c.starts_at), endMs = c.ends_at ? Date.parse(c.ends_at) : null, now = Date.now();
  const status = now < startMs ? 'upcoming' : endMs != null && now > endMs ? 'ended' : 'live';
  const locked = PLUGIN_METRICS.has(c.metric) && !open;
  return { ...c, status, locked, rows: locked || status === 'upcoming' ? [] : standings(list, c.metric, c.target, startMs, endMs) };
}

// GET /api/competitions/options?group_id= — the bosses the group's plugins have reported (for the "which boss" picker)
router.get('/options', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  if (!unlocked(req, groupId)) return res.json({ bosses: [] });
  const bosses = db.prepare(`SELECT b.key, MAX(b.name) AS name FROM player_boss_kills b JOIN players p ON p.id = b.player_id
    WHERE p.group_id = ? GROUP BY b.key ORDER BY name`).all(groupId);
  res.json({ bosses });
});

// GET /api/competitions?group_id=
router.get('/', (req, res) => {
  const groupId = parseInt(req.query.group_id, 10);
  if (!groupId) return res.status(400).json({ error: 'group_id required' });
  const open = unlocked(req, groupId), list = players(groupId);
  const rows = db.prepare('SELECT * FROM group_competitions WHERE group_id = ? ORDER BY starts_at DESC').all(groupId);
  res.json(rows.map(c => present(c, open, list)));
});

// Everyone who can write to the group may create, change and remove competitions.
router.post('/', (req, res) => {
  const groupId = parseInt(req.body?.group_id, 10);
  if (!checkGroupAuth(req, res, groupId)) return;
  let c; try { c = cleanComp(req.body, groupId); } catch (e) { return res.status(400).json({ error: e.message }); }
  const id = Number(db.prepare('INSERT INTO group_competitions (group_id, title, metric, target, starts_at, ends_at, goal) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(c.group_id, c.title, c.metric, c.target, c.starts_at, c.ends_at, c.goal).lastInsertRowid);
  for (const p of players(groupId)) { try { snapshotPlayer(p.id, true); } catch { /* the baseline falls back to the first snapshot */ } }
  res.status(201).json({ id });
});

router.put('/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM group_competitions WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  if (!checkGroupAuth(req, res, cur.group_id)) return;
  let c; try { c = cleanComp({ ...cur, ...req.body }, cur.group_id); } catch (e) { return res.status(400).json({ error: e.message }); }
  db.prepare('UPDATE group_competitions SET title = ?, metric = ?, target = ?, starts_at = ?, ends_at = ?, goal = ? WHERE id = ?')
    .run(c.title, c.metric, c.target, c.starts_at, c.ends_at, c.goal, cur.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM group_competitions WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  if (!checkGroupAuth(req, res, cur.group_id)) return;
  db.prepare('DELETE FROM group_competitions WHERE id = ?').run(cur.id);
  res.json({ ok: true });
});

module.exports = router;
