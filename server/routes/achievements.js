const express = require('express');
const router  = express.Router();
const db      = require('../database');

// GET /api/achievements?group_id=X
// Returns all achievements for every player in the group (public, no auth needed)
router.get('/', (req, res) => {
  const { group_id } = req.query;
  if (!group_id) return res.status(400).json({ error: 'group_id required' });

  const rows = db.prepare(`
    SELECT a.*, p.rsn
    FROM achievements a
    JOIN players p ON p.id = a.player_id
    WHERE p.group_id = ?
    ORDER BY a.player_id, a.key
  `).all(group_id);

  res.json(rows);
});

// PUT /api/achievements/:playerId/:key — manual toggle, switched off: area tasks come from the game (plugin) and the
// Adventurer's Log. Marks made by hand on 1.x stay in the database and still show.
router.put('/:playerId/:key', (req, res) => {
  res.status(410).json({ error: 'Area tasks are read from the game and can no longer be marked by hand.' });
});

module.exports = router;
