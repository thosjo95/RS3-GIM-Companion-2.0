// How valuable a drop must be to show up in the group's Drops. The group sets its own minimum (Manage group);
// without one the default applies. GIM_DROP_THRESHOLD overrides the default (for testing).
const db = require('../database');
const DEFAULT_MIN = Number(process.env.GIM_DROP_THRESHOLD) || 100_000;
const MAX_MIN = 2_000_000_000;

/** The minimum total value (gp) for the group's drops. */
function groupMin(groupId) {
  const v = db.prepare('SELECT drop_min_value AS v FROM groups WHERE id = ?').get(groupId)?.v;
  return Number.isInteger(v) ? v : DEFAULT_MIN;
}

module.exports = { DEFAULT_MIN, MAX_MIN, groupMin };
