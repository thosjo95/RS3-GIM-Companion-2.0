import React, { useEffect, useState } from 'react';

// Official images for game things, used across the whole app.
//   ItemIcon: Jagex's item sprite by the game's item id (the plugin knows it; for items known only by name the id is
//             looked up on the server), then the RuneScape Wiki image by name, then a lettered tile.
//   BossIcon: the RuneScape Wiki's chathead of a boss, then its NPC image, else nothing.

// ── name -> item id, resolved in batches by the server ────────────────────────
const idCache = new Map();          // lowercase name -> id | null (unknown)
const waiting = new Set();          // names queued for the next request
const listeners = new Set();
let timer = null;

function flush() {
  timer = null;
  const names = [...waiting]; waiting.clear();
  if (names.length === 0) return;
  fetch('/api/rs3/item-ids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names: names.slice(0, 400) }) })
    .then(r => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then(found => {
      for (const n of names) idCache.set(n.toLowerCase(), found[n] ?? null);
      listeners.forEach(fn => fn());
    });
}

function useItemId(id, name) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (id != null || !name) return undefined;
    const key = name.toLowerCase();
    if (!idCache.has(key)) { waiting.add(name); if (!timer) timer = setTimeout(flush, 60); }
    const fn = () => bump(n => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, [id, name]);
  if (id != null) return id;
  return name ? (idCache.get(name.toLowerCase()) ?? null) : null;
}

const wikiFile = name => `https://runescape.wiki/images/${encodeURIComponent(String(name).trim().replace(/ /g, '_'))}.png`;

export function ItemIcon({ id, name, size = 36 }) {
  const resolved = useItemId(id, name);
  const [stage, setStage] = useState(0);
  useEffect(() => setStage(0), [resolved, name]);
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  const src = stage === 0 && resolved != null ? `https://secure.runescape.com/m=itemdb_rs/obj_sprite.gif?id=${resolved}`
    : stage <= 1 && name ? wikiFile(name) : null;
  if (!src) {
    return <div style={{ width: size, height: size, borderRadius: 6, background: 'var(--bg-root)', border: '1px solid var(--border)', color: 'var(--text-dim)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.45, flexShrink: 0 }}>{letter}</div>;
  }
  return <img src={src} alt={name || ''} loading="lazy" onError={() => setStage(st => (resolved != null && st === 0 ? 1 : 2))}
    style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, imageRendering: src.includes('obj_sprite') ? 'pixelated' : 'auto' }} />;
}

// "Giant Mole — 50 Kills", "K'ril Tsutsaroth (Zamorak)" and the like -> the plain boss name
const bossBase = s => String(s || '').replace(/\s*[—–]\s.*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();

export function BossIcon({ name, size = 24, fallback = null }) {
  const [stage, setStage] = useState(0);
  const base = bossBase(name);
  useEffect(() => setStage(0), [base]);
  if (!base || stage >= 2) return fallback;
  const src = stage === 0 ? wikiFile(`${base} chathead`) : wikiFile(base);
  return <img src={src} alt={base} loading="lazy" onError={() => setStage(s => s + 1)} style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />;
}
