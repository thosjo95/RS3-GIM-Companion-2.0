// GET /api/global/stats: the Global Leaderboard page (every tracked group; names only from public data, plugin data
// only as anonymous totals; cached 10 minutes)
const express = require('express');
const { globalStats } = require('../services/globalStats');

const router = express.Router();

router.get('/stats', (req, res) => {
  try {
    // browsers ask again every time (the server keeps its own copy for 10 minutes): a copy kept by the browser could
    // be from before a deploy and miss what the new page expects
    res.set('Cache-Control', 'no-cache');
    res.json(globalStats());
  } catch (err) {
    console.error('[global] stats failed:', err.message);
    res.status(500).json({ error: 'Could not build the global stats' });
  }
});

module.exports = router;
