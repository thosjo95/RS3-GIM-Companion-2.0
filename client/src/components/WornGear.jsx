import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { EQUIPMENT_SLOTS } from '../data/gearSuggestions';
import { ItemIcon } from './GameIcon';

// What a player is wearing: read from the game by the plugin, live while they are logged in and as last seen after
// logout. One player at a time: it follows the player picked in the pinned player bar.

// The game's equipment slot numbers (the plugin sends them for worn items).
const SLOT_BY_INDEX = { 0: 'head', 1: 'cape', 2: 'neck', 3: 'weapon', 4: 'body', 5: 'offhand', 7: 'legs', 9: 'gloves', 10: 'boots', 12: 'ring', 13: 'ammo', 17: 'pocket' };

// Fallback for data stored before the plugin sent slot numbers: guess the slot from the item's name.
const NAME_RULES = [
  ['pocket', /grimoire|\bbook\b|scripture|\bwar\b.*\btome\b|\bpage\b|^erethdor|sign of|\borb\b|\bstone of\b|\bpocket\b/i],
  ['cape',   /\bcape\b|\bcloak\b|\bcape of\b|\bshroud\b|kal-/i],
  ['neck',   /amulet|necklace|pendant|\bscarab\b|\bsymbol\b|reaper|\bchain\b|\bchoker\b|\blocket\b/i],
  ['ring',   /\bring\b|\bsignet\b|\bband\b/i],
  ['gloves', /glove|gauntlet|vambrace|\bbracers?\b|\bwristband\b|\bcuffs?\b/i],
  ['boots',  /boots?\b|\bshoes?\b|\bsandals?\b|\bgreaves\b|\bsabatons?\b/i],
  ['head',   /\bhood\b|\bhelm|\bhat\b|\bcowl\b|\bmask\b|\bcoif\b|\bcrown\b|\bheadgear\b|\bfaceguard\b|\bcirclet\b/i],
  ['legs',   /legs|platelegs|chaps|tassets|robe bottom|\bskirt\b|\bcuisses\b|\bbottoms?\b|\btrousers\b|\bgreaves\b/i],
  ['body',   /body|platebody|robe top|\bhauberk\b|\bchestplate\b|\btop\b|\bbrassard\b|\bcuirass\b|\bjerkin\b|\btunic\b|\bvest\b/i],
  ['ammo',   /\barrows?\b|\bbolts?\b|\bspikes\b|\bjavelins?\b|\bthrowing\b|\bdarts?\b|\brune pouch\b|\bammo\b/i],
  ['offhand', /shield|defender|\bkiteshield\b|\bbuckler\b|\blantern\b|\bofhand\b|\boff-hand\b|\bward\b|\bspellbook\b|\bscripts?\b/i],
];
function slotOf(item) {
  if (Number.isInteger(item.slot) && SLOT_BY_INDEX[item.slot]) return SLOT_BY_INDEX[item.slot];
  const n = item.name || '';
  for (const [slot, rx] of NAME_RULES) if (rx.test(n)) return slot;
  return 'weapon';   // what is left in the hands is most likely a weapon
}

function timeAgo(iso) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function Img({ src, alt, size, fallback }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (!src || bad) return fallback ?? null;
  return <img src={src} alt={alt} onError={() => setBad(true)} style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />;
}

const wikiImg = name => `https://runescape.wiki/images/${encodeURIComponent(String(name).trim().replace(/ /g, '_'))}.png`;

function Slot({ def, item }) {
  const slotIcon = <Img src={`https://runescape.wiki/images/${def.wikiImg}`} alt={def.label} size={28} fallback={<span style={{ fontSize: 20 }}>{def.icon}</span>} />;
  return (
    <div title={item ? `${item.name}${item.count > 1 ? ` ×${item.count}` : ''}` : `${def.label} — empty`} style={{
      gridColumn: def.gridCol, gridRow: def.gridRow, width: 96, height: 82, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '6px 4px',
      background: item ? 'rgba(200,168,75,0.07)' : 'var(--bg-root)',
      border: `1px solid ${item ? 'rgba(200,168,75,0.45)' : 'var(--border)'}`, borderRadius: 'var(--radius)',
    }}>
      {item
        ? <ItemIcon id={item.id} name={item.name} size={34} />
        : <div style={{ opacity: 0.45 }}>{slotIcon}</div>}
      <div style={{ fontSize: 10, lineHeight: 1.15, textAlign: 'center', color: item ? 'var(--text-bright)' : 'var(--text-dim)', maxWidth: 88,
        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {item ? item.name : def.label}
      </div>
    </div>
  );
}

export default function WornGear({ players, groupId, canWrite, selectedPlayerId = null }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!canWrite || !groupId) { setState(null); return; }
    let alive = true;
    const load = () => api.getPluginState(groupId).then(r => { if (alive) setState(Array.isArray(r) ? r : []); }).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [groupId, canWrite]);

  const player = players.find(p => p.id === selectedPlayerId) ?? null;
  const row = state?.find(r => r.player_id === selectedPlayerId) ?? null;

  const { bySlot, extra } = useMemo(() => {
    const bySlot = {}, extra = [];
    for (const it of row?.equipment ?? []) {
      const slot = Number.isInteger(it.slot) && it.slot === 14 ? 'aura' : slotOf(it);
      if (slot !== 'aura' && !bySlot[slot]) bySlot[slot] = it; else extra.push(it);
    }
    return { bySlot, extra };
  }, [row]);

  if (!player) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '24px 4px' }}>To see what a player is wearing right now, pick a player card above.</div>;
  }
  if (!canWrite) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '24px 4px' }}>Unlock the group to see worn gear.</div>;
  }
  if (!row || !row.updated_at) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '24px 4px' }}>{player.rsn} has not sent any data from the plugin yet.</div>;
  }

  const fresh = Date.now() - Date.parse(row.updated_at) < 5 * 60 * 1000;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-dim)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: fresh ? '#4caf50' : 'var(--text-dim)' }} />
        <span><strong style={{ color: 'var(--text-bright)' }}>{player.rsn}</strong> · {fresh ? 'live' : `last seen ${timeAgo(row.updated_at)}`}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 96px)', gridAutoRows: '82px', gap: 6, justifyContent: 'center' }}>
        {EQUIPMENT_SLOTS.map(def => <Slot key={def.slot} def={def} item={bySlot[def.slot]} />)}
      </div>
      {extra.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-dim)' }}>
          Also worn: {extra.map(it => it.name).filter(Boolean).join(', ')}
        </div>
      )}
      {(row.equipment ?? []).length === 0 && <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-dim)' }}>Nothing is worn.</div>}
    </div>
  );
}
