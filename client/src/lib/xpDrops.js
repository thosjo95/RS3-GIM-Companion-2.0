import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Live XP drops: the XP each member gained per skill between two plugin updates (about every 30 seconds).
// One poller per group is shared by everything on the page (player cards and the Live XP panel), so the page asks the
// server once every 10 seconds however many places show drops. It only runs while the browser tab is visible.

const POLL_MS = 10_000;
const KEEP_MS = 24 * 3600 * 1000;
const stores = new Map();     // groupId -> { drops, latest, subs, timer, started }

function storeFor(groupId) {
  let s = stores.get(groupId);
  if (!s) { s = { drops: [], latest: null, subs: new Set(), timer: null, started: false }; stores.set(groupId, s); }
  return s;
}

async function poll(groupId) {
  const s = storeFor(groupId);
  if (document.hidden) return;
  try {
    const rows = await api.getXpDrops(groupId, s.latest);
    const known = new Set(s.drops.map(d => d.id));
    const fresh = (Array.isArray(rows) ? rows : []).filter(d => !known.has(d.id));
    const first = !s.started;
    s.started = true;
    if (fresh.length) {
      const cutoff = Date.now() - KEEP_MS;
      s.drops = [...fresh, ...s.drops].filter(d => Date.parse(d.at) > cutoff).sort((a, b) => b.id - a.id);
      s.latest = s.drops[0]?.at ?? s.latest;
    }
    // on the very first load nothing is "new": only drops that arrive while the page is open animate
    s.subs.forEach(fn => fn(first ? [] : fresh));
  } catch { /* locked group or server away: try again next time */ }
}

// Returns the last 24 hours of drops (newest first). `onFresh(drops)` is called with drops that arrived since the
// previous poll, for animations.
export function useXpDrops(groupId, enabled, onFresh) {
  const [drops, setDrops] = useState([]);
  useEffect(() => {
    if (!groupId || !enabled) { setDrops([]); return undefined; }
    const s = storeFor(groupId);
    const sub = fresh => { setDrops(s.drops); if (fresh.length && onFresh) onFresh(fresh); };
    s.subs.add(sub);
    setDrops(s.drops);
    if (!s.timer) { poll(groupId); s.timer = setInterval(() => poll(groupId), POLL_MS); }
    return () => {
      s.subs.delete(sub);
      if (s.subs.size === 0) { clearInterval(s.timer); s.timer = null; }
    };
  }, [groupId, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return drops;
}

// 1,240 -> "1,240"; 125,000 -> "125K"; 2,500,000 -> "2.5M"
export function fmtGain(n) {
  if (n >= 1_000_000) return `${Math.floor(n / 100_000) / 10}M`;
  if (n >= 100_000) return `${Math.floor(n / 1000)}K`;
  return n.toLocaleString();
}
