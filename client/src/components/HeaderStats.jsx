import React, { useMemo } from 'react';
import RsIcon from './RsIcon';
import { fmtXp } from '../lib/rs3';

// The group's headline numbers as a compact strip in the top bar: members, total XP, total levels and how many
// members earned XP in the past 7 days.
export default function HeaderStats({ group }) {
  const players = group?.players ?? [];
  const s = useMemo(() => {
    let xp = 0, levels = 0;
    for (const p of players) {
      const ov = p.skills?.find(x => x.skill_name === 'Overall');
      xp += ov?.xp || 0; levels += ov?.level || 0;
    }
    const hasWeekly = players.some(p => p.weekly_xp_gain != null);
    const active = players.filter(p => (p.weekly_xp_gain ?? 0) > 0).length;
    return { xp, levels, hasWeekly, active };
  }, [players]);
  if (players.length === 0) return null;

  const items = [
    { icon: 'group',  fb: '👥', value: players.length,              tip: 'Members' },
    { icon: 'skills', fb: '✨', value: fmtXp(s.xp),                 tip: 'Total XP of the group' },
    { icon: 'overview', fb: '📊', value: s.levels.toLocaleString(), tip: 'Total levels of the group' },
    { icon: 'fire',   fb: '🔥', value: s.hasWeekly ? `${s.active}/${players.length}` : '–', tip: 'Members who earned XP in the past 7 days' },
  ];
  return (
    <div className="header-stats" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
      {items.map(it => (
        <div key={it.tip} title={it.tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
          background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--gold-light)', whiteSpace: 'nowrap' }}>
          <RsIcon name={it.icon} fallback={it.fb} size={15} />{it.value}
        </div>
      ))}
    </div>
  );
}
