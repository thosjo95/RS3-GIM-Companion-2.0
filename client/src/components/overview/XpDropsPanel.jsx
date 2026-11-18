import React, { useMemo, useState } from 'react';
import SkillIcon from '../common/SkillIcon';
import { IconLabel } from '../RsIcon';
import { MEMBER_COLORS } from '../../lib/rs3';
import { fmtGain } from '../../lib/xpDrops';

// The Live XP panel (opened from its tile, floats over the page): XP per member in the last hour, then every drop of
// the last 24 hours, newest first. `selectedId` (the player card filter) narrows it to one player.

const HOUR = 3600 * 1000;
const timeOf = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function XpDropsPanel({ drops, players, selectedId, onClose }) {
  const [shown, setShown] = useState(60);
  const colorOf = id => MEMBER_COLORS[Math.max(0, players.findIndex(p => p.id === id)) % MEMBER_COLORS.length];
  const nameOf = id => players.find(p => p.id === id)?.rsn ?? '?';
  const list = selectedId ? drops.filter(d => d.player_id === selectedId) : drops;

  // last hour: total per member and their top three skills
  const lastHour = useMemo(() => {
    const cutoff = Date.now() - HOUR;
    const per = new Map();
    for (const d of list) {
      if (Date.parse(d.at) < cutoff) continue;
      const p = per.get(d.player_id) ?? { total: 0, skills: {} };
      p.total += d.xp; p.skills[d.skill] = (p.skills[d.skill] ?? 0) + d.xp;
      per.set(d.player_id, p);
    }
    return [...per.entries()].map(([id, p]) => ({ id, total: p.total,
      top: Object.entries(p.skills).sort((a, b) => b[1] - a[1]).slice(0, 3) })).sort((a, b) => b.total - a.total);
  }, [list]);

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-root)' }}>
        <IconLabel name="skills" fallback="" size={20}><strong style={{ fontSize: 13, color: 'var(--text-bright)' }}>Live XP</strong></IconLabel>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>from the plugin, about every 30 seconds</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose} title="Close" style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      {lastHour.length > 0 && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Last hour</div>
          {lastHour.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <strong style={{ color: colorOf(r.id), minWidth: 110 }}>{nameOf(r.id)}</strong>
              <strong style={{ color: 'var(--text-bright)', minWidth: 60 }}>+{fmtGain(r.total)}</strong>
              <span style={{ display: 'inline-flex', gap: 10, color: 'var(--text-dim)' }}>
                {r.top.map(([skill, xp]) => <span key={skill} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><SkillIcon name={skill} size={14} />{fmtGain(xp)}</span>)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ maxHeight: 380, overflowY: 'auto', padding: '6px 0' }}>
        {list.length === 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '24px 16px', lineHeight: 1.6 }}>
            No XP in the last 24 hours. Drops appear here while members play with the plugin connected.
          </div>
        )}
        {list.slice(0, shown).map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 14px', fontSize: 12 }}>
            <SkillIcon name={d.skill} size={20} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: colorOf(d.player_id) }}>{nameOf(d.player_id)}</strong>
              <span style={{ color: 'var(--text-dim)' }}> gained </span>
              <strong style={{ color: 'var(--text-bright)' }}>{d.xp.toLocaleString()} XP</strong>
              <span style={{ color: 'var(--text-dim)' }}> in {d.skill}</span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>{timeOf(d.at)}</span>
          </div>
        ))}
        {list.length > shown && (
          <div style={{ textAlign: 'center', padding: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShown(n => n + 100)}>Show more</button>
          </div>
        )}
      </div>
    </div>
  );
}
