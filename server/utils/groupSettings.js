// A group's own settings (Plugin window > Group settings). Stored as JSON in groups.settings_json; anything not set
// takes its default. The smallest drop value has its own column (groups.drop_min_value, see utils/dropRules.js).
const db = require('../database');

const CLUE_TIERS = ['easy', 'medium', 'hard', 'elite', 'master'];
const DEFAULTS = {
  xp_min: 0,                  // Live XP: smallest drop (xp) to show
  journal_min: 0,             // Bank Journal: smallest entry (total gp) to list
  boss_min_kills: 0,          // Boss log: a boss appears once the member has this many kills
  clue_tiers: CLUE_TIERS,     // Clue log: which tiers appear
  online_minutes: 3,          // someone counts as online this long after the plugin was last heard from
  unlisted: false,            // hidden from "Find groups"
};
const ONLINE_STEPS = [2, 3, 5, 10, 15, 30];

const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const CHECK = {
  xp_min: v => int(v, 0, 1_000_000),
  journal_min: v => int(v, 0, 2_000_000_000),
  boss_min_kills: v => int(v, 0, 100_000),
  online_minutes: v => (ONLINE_STEPS.includes(v) ? v : null),
  unlisted: v => (typeof v === 'boolean' ? v : null),
  clue_tiers: v => (Array.isArray(v) && v.every(t => CLUE_TIERS.includes(t)) ? [...new Set(v)] : null),
};

/** The group's settings with defaults filled in. */
function getSettings(groupId) {
  let saved = {};
  try { saved = JSON.parse(db.prepare('SELECT settings_json FROM groups WHERE id = ?').get(groupId)?.settings_json || '{}') || {}; } catch { /* defaults */ }
  const out = { ...DEFAULTS };
  for (const k of Object.keys(CHECK)) { const v = CHECK[k](saved[k]); if (v !== null) out[k] = v; }
  return out;
}

/** Validates a partial update. Returns { ok: true, patch } or { ok: false, error }. */
function sanitize(body) {
  const patch = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!CHECK[k]) return { ok: false, error: `Unknown setting: ${k}` };
    const clean = CHECK[k](v);
    if (clean === null) return { ok: false, error: `Invalid value for ${k}` };
    patch[k] = clean;
  }
  return { ok: true, patch };
}

function saveSettings(groupId, patch) {
  const next = { ...getSettings(groupId), ...patch };
  db.prepare('UPDATE groups SET settings_json = ? WHERE id = ?').run(JSON.stringify(next), groupId);
  return next;
}

module.exports = { DEFAULTS, CLUE_TIERS, ONLINE_STEPS, getSettings, sanitize, saveSettings };
