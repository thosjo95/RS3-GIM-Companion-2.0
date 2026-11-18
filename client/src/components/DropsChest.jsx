import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import RsIcon from './RsIcon';
import { ItemIcon } from './GameIcon';
import { MEMBER_COLORS, fmtNum } from '../lib/rs3';

// The group's recent big drops, opened from the treasure chest next to the player cards. They come from the
// Adventurer's Log (rare drops the game announces) and from the plugin (valuable drops it sees in-game).

const toMs = iso => { const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(iso || '') ? iso : `${iso}Z`); return Number.isFinite(t) ? t : 0; };
function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - toMs(iso)) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// How many drops landed in the last 7 days (the badge on the chest).
export function useRecentDrops(groupId) {
  const [drops, setDrops] = useState([]);
  useEffect(() => {
    if (!groupId) return undefined;
    let alive = true;
    const load = () => api.getDrops(groupId).then(r => { if (alive) setDrops(Array.isArray(r) ? r : []); }).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [groupId]);
  return drops;
}

// Remembers (per group, in this browser) the newest drop that was looked at. Drops newer than that glow on the chest.
// The first visit marks everything as seen, so old drops never glow.
export function useUnseenDrops(groupId, drops, open, prefix = 'gim_drops_seen_') {
  const key = `${prefix}${groupId}`;
  const newest = drops.reduce((m, d) => Math.max(m, d.id || 0), 0);
  const read = () => { try { const v = localStorage.getItem(key); return v == null ? null : Number(v); } catch { return 0; } };
  const [seen, setSeen] = useState(read);
  useEffect(() => { setSeen(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const markSeen = () => { try { localStorage.setItem(key, String(newest)); } catch { /* not saved */ } setSeen(newest); };
  useEffect(() => { if (seen == null && drops.length > 0) markSeen(); }, [seen, drops.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && newest > (seen ?? 0)) markSeen(); }, [open, newest]); // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = seen == null || open ? [] : drops.filter(d => (d.id || 0) > seen);
  return { fresh, markSeen };
}

const BEAM_CSS = `
@keyframes gimBeam { 0%,100% { opacity: .55; transform: scaleY(.85); } 50% { opacity: 1; transform: scaleY(1.05); } }
@keyframes gimGlow { 0%,100% { box-shadow: 0 0 10px 1px var(--beam), 0 0 0 0 var(--beam); } 50% { box-shadow: 0 0 26px 6px var(--beam), 0 0 40px 10px var(--beam); } }
`;

export function ChestButton({ drops = [], open, onClick, fresh = [], icon = 'vault', fallback = '🧰', label = 'Drops', sub, freshWord = 'new' }) {
  const week = drops.filter(d => Date.now() - toMs(d.dropped_at) < 7 * 86400000).length;
  const glowing = fresh.length > 0;
  const big = fresh.some(d => (d.value_gp || 0) * (d.quantity || 1) >= 5_000_000);
  const beam = big ? '#ff8a2a' : '#ffd75e';
  return (
    <div onClick={onClick} title={glowing ? `${fresh.length} ${freshWord}!` : label} style={{
      '--beam': beam,
      animation: glowing ? 'gimGlow 1.8s ease-in-out infinite' : undefined,
      cursor: 'pointer', width: 130, position: 'relative', padding: '12px 8px', flexShrink: 0, userSelect: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center',
      background: open ? 'var(--bg-panel)' : 'var(--bg-panel-alt)', border: `2px solid ${glowing ? beam : open ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)',
    }}>
      {glowing && (
        <>
          <style>{BEAM_CSS}</style>
          {/* the loot beam: a column of light rising from the chest */}
          <div style={{ position: 'absolute', left: '50%', bottom: '55%', width: 44, height: 170, marginLeft: -22, transformOrigin: 'bottom', pointerEvents: 'none', zIndex: 2,
            background: `linear-gradient(to top, ${beam}ee, ${beam}88 40%, transparent)`, filter: 'blur(3px)', animation: 'gimBeam 1.8s ease-in-out infinite' }} />
        </>
      )}
      <RsIcon name={icon} fallback={fallback} size={44} />
      <div style={{ fontWeight: 700, fontSize: 13, color: open ? 'var(--gold)' : glowing ? beam : 'var(--text-bright)' }}>{label}</div>
      <div style={{ fontSize: 11, color: glowing ? beam : 'var(--text-dim)' }}>{glowing ? `${fresh.length} ${freshWord}!` : sub ?? (week > 0 ? `${week} this week` : 'nothing this week')}</div>
    </div>
  );
}

export default function DropsPanel({ drops, players, selectedId, onClose }) {
  const colorOf = id => MEMBER_COLORS[Math.max(0, players.findIndex(p => p.id === id)) % MEMBER_COLORS.length];
  const list = drops.filter(d => selectedId == null || d.player_id === selectedId).slice(0, 40);
  const who = selectedId != null ? players.find(p => p.id === selectedId)?.rsn : null;
  return (
    <div style={{ width: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-root)' }}>
        <RsIcon name="vault" fallback="🧰" size={22} />
        <strong style={{ fontSize: 13, color: 'var(--text-bright)' }}>Recent drops{who ? ` · ${who}` : ''}</strong>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose} title="Close" style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto', padding: 8 }}>
        {list.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '22px 8px', textAlign: 'center' }}>No drops recorded yet.</div>}
        {list.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6 }}>
            <ItemIcon name={d.item_name} size={32} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--text-bright)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.item_name}{d.quantity > 1 ? ` ×${d.quantity.toLocaleString()}` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                <span style={{ color: colorOf(d.player_id), fontWeight: 600 }}>{d.rsn}</span>
                {d.boss_name ? ` · ${d.boss_name}` : ''}{d.value_gp ? ` · ${fmtNum(d.value_gp * (d.quantity || 1))} gp` : ''}
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{ago(d.dropped_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
