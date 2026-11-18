import React, { useMemo, useState } from 'react';
import RsIcon from './RsIcon';

// The Group Ironman "Journey": tiers 0–10, each with a handful of steps (quests, skill levels, set tasks, bosses ...).
// Data comes from the in-game plugin as achievements named "Journey Tier N" (the tier itself) and
// "Journey Tier N: <step>" (its steps), in category 5483.
export const JOURNEY_CATEGORY = 5483;
const NAME = /^Journey Tier (\d+)(?::\s*(.+))?$/;

function buildJourney(rows, playerIds) {
  const tiers = new Map(); // N -> { n, steps: Map(id -> name), tierId, done: Map(playerId -> Set(achievement ids completed)) }
  for (const r of rows) {
    const m = NAME.exec(r.name);
    if (!m) continue;
    const n = Number(m[1]);
    const t = tiers.get(n) ?? { n, steps: new Map(), tierId: null, done: new Map(playerIds.map(id => [id, new Set()])) };
    if (m[2]) t.steps.set(r.achievement_id, m[2]); else t.tierId = r.achievement_id;
    if (r.completed !== 0) t.done.get(r.player_id)?.add(r.achievement_id);
    tiers.set(n, t);
  }
  return [...tiers.values()].sort((a, b) => a.n - b.n);
}

const stepsDone = (t, pid) => [...t.steps.keys()].filter(id => t.done.get(pid)?.has(id)).length;
const tierComplete = (t, pid) => t.tierId != null && t.done.get(pid)?.has(t.tierId);

export default function JourneyPanel({ rows, players, colorMap }) {
  const ids = players.map(p => p.id);
  const tiers = useMemo(() => buildJourney(rows, ids), [rows, ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The tier everyone is still working on is opened by default.
  const current = tiers.find(t => ids.some(id => !tierComplete(t, id)))?.n ?? null;
  const [open, setOpen] = useState(null);
  const expanded = open ?? current;

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 14px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <RsIcon name="journey" fallback="🛡️" size={22} />
        <div className="section-title" style={{ margin: 0 }}>Group Ironman Journey</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>Tiers 0–10, read from the game by the plugin</div>

      {tiers.length === 0 ? (
        <div style={{ padding: '18px 6px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6 }}>
          No journey progress yet.<br />It appears once a Group Ironman member's plugin has finished its first achievement scan.
        </div>
      ) : (
        <>
          {/* Where each player is */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
            {players.map(p => {
              const reached = tiers.filter(t => tierComplete(t, p.id)).map(t => t.n);
              const top = reached.length ? Math.max(...reached) : null;
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
                  <strong style={{ color: colorMap[p.id], flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.rsn}</strong>
                  <span style={{ color: top === null ? 'var(--text-dim)' : 'var(--gold)', fontSize: 11 }}>{top === null ? 'not started' : top >= 10 ? 'journey complete' : `tier ${top} complete`}</span>
                </div>
              );
            })}
          </div>

          {/* The tiers */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tiers.map(t => {
              const total = t.steps.size;
              const everyoneDone = ids.length > 0 && ids.every(id => tierComplete(t, id));
              const sum = ids.reduce((n, id) => n + (tierComplete(t, id) ? total : stepsDone(t, id)), 0);
              const pct = total && ids.length ? Math.round((sum / (total * ids.length)) * 100) : 0;
              const isOpen = expanded === t.n;
              return (
                <div key={t.n} style={{ border: `1px solid ${isOpen ? 'var(--gold-dark)' : 'var(--border)'}`, borderRadius: 'var(--radius)', background: isOpen ? 'var(--bg-panel-alt)' : 'transparent' }}>
                  <button onClick={() => setOpen(isOpen ? -1 : t.n)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: everyoneDone ? 'var(--green-bright)' : 'var(--text-bright)', minWidth: 46 }}>Tier {t.n}</span>
                    <span style={{ flex: 1, height: 5, background: 'var(--bg-root)', borderRadius: 3, overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: everyoneDone ? 'var(--green-bright)' : 'var(--gold)', transition: 'width 0.4s' }} />
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 28, textAlign: 'right' }}>{everyoneDone ? '✓' : `${pct}%`}</span>
                  </button>

                  {isOpen && (
                    <div style={{ padding: '2px 9px 9px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {[...t.steps.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
                        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                          <span style={{ flex: 1, color: 'var(--text)' }}>{name}</span>
                          <span style={{ display: 'inline-flex', gap: 3 }}>
                            {players.map(p => {
                              const done = t.done.get(p.id)?.has(id);
                              return <span key={p.id} title={`${p.rsn}: ${done ? 'done' : 'not yet'}`}
                                style={{ width: 9, height: 9, borderRadius: '50%', background: done ? colorMap[p.id] : 'transparent', border: `1.5px solid ${colorMap[p.id]}`, opacity: done ? 1 : 0.45 }} />;
                            })}
                          </span>
                        </div>
                      ))}
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                        {players.map((p, i) => <span key={p.id}>{i > 0 && ' · '}<span style={{ color: colorMap[p.id] }}>{p.rsn}</span> {tierComplete(t, p.id) ? 'done' : `${stepsDone(t, p.id)}/${total}`}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
