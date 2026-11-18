import React, { useMemo, useState } from 'react';
import RsIcon from './RsIcon';

// The Group Ironman "Journey": tiers 0–10, each with a handful of steps (quests, skill levels, set tasks, bosses ...).
// Everything here is read LIVE from each member's own character by the in-game plugin: achievements named
// "Journey Tier N" (the tier itself) and "Journey Tier N: <step>" (its steps), in category 5483. A step the game
// counts progress for (like total level) also reports the counter, so the panel can show "2497 / 2600".
export const JOURNEY_CATEGORY = 5483;
const NAME = /^Journey Tier (\d+)(?::\s*(.+))?$/;
const fmt = n => Number(n).toLocaleString();

function buildJourney(rows, playerIds) {
  const tiers = new Map(); // N -> { n, tierId, steps: Map(id -> step), tierDone: Set(playerId) }
  for (const r of rows) {
    const m = NAME.exec(r.name);
    if (!m) continue;
    const n = Number(m[1]);
    const t = tiers.get(n) ?? { n, tierId: null, steps: new Map(), tierDone: new Set() };
    tiers.set(n, t);
    if (!m[2]) { t.tierId = r.achievement_id; if (r.completed !== 0) t.tierDone.add(r.player_id); continue; }
    const step = t.steps.get(r.achievement_id) ?? { id: r.achievement_id, name: m[2], description: null, reward: null, target: null, who: new Map() };
    step.description = step.description ?? r.description;
    step.reward = step.reward ?? r.reward;
    step.target = step.target ?? r.tally_target;
    step.who.set(r.player_id, { done: r.completed !== 0, progress: r.tally_progress });
    t.steps.set(r.achievement_id, step);
  }
  return [...tiers.values()].sort((a, b) => a.n - b.n);
}

const stepDone = (step, pid) => step.who.get(pid)?.done === true;
const stepsDone = (t, pid) => [...t.steps.values()].filter(s => stepDone(s, pid)).length;
const tierComplete = (t, pid) => t.tierDone.has(pid);

export default function JourneyPanel({ rows, players, colorMap }) {
  const ids = players.map(p => p.id);
  const tiers = useMemo(() => buildJourney(rows, ids), [rows, ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Where the group is": the first tier somebody still has to finish.
  const current = tiers.find(t => ids.some(id => !tierComplete(t, id)))?.n ?? null;
  const finished = tiers.length > 0 && current === null;
  const [open, setOpen] = useState(null);       // null = follow the current tier, -1 = everything closed
  const expanded = open ?? current;
  const withData = players.filter(p => tiers.some(t => t.tierDone.has(p.id) || [...t.steps.values()].some(s => s.who.has(p.id))));

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 14px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <RsIcon name="journey" fallback="🛡️" size={24} />
        <div className="section-title" style={{ margin: 0 }}>Group Ironman Journey</div>
      </div>

      {tiers.length === 0 ? (
        <div style={{ padding: '22px 6px 10px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6 }}>
          No journey progress yet.<br />It is read from each Group Ironman member's character by the plugin, a minute or two after they log in.
        </div>
      ) : (
        <>
          {/* Where the group is */}
          <div style={{ margin: '10px 0 12px', padding: '10px 12px', background: 'var(--bg-panel-alt)', border: '1px solid var(--gold-dark)', borderRadius: 'var(--radius)' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>{finished ? 'Journey' : 'The group is on'}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)' }}>{finished ? 'Complete 🎉' : `Tier ${current}`}</div>
            {!finished && (() => {
              const t = tiers.find(x => x.n === current);
              const left = ids.map(id => t.steps.size - stepsDone(t, id)).filter(n => n > 0);
              return <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t.steps.size} steps · {left.length ? `${Math.max(...left)} left for the furthest behind` : 'only the tier reward is missing'}</div>;
            })()}
          </div>

          {/* Each player */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {players.map(p => {
              const doneTiers = tiers.filter(t => tierComplete(t, p.id)).map(t => t.n);
              const top = doneTiers.length ? Math.max(...doneTiers) : null;
              const working = tiers.find(t => !tierComplete(t, p.id));
              const hasData = withData.some(x => x.id === p.id);
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
                  <strong style={{ color: colorMap[p.id], flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.rsn}</strong>
                  {!hasData
                    ? <span style={{ fontSize: 11, color: 'var(--text-dim)' }} title="This member has no plugin data yet">no plugin data</span>
                    : <span style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }}>
                        {top === null ? 'not started' : <><span style={{ color: 'var(--green-bright)' }}>tier {top} done</span></>}
                        {working && <> · tier {working.n}: <span style={{ color: 'var(--gold)' }}>{stepsDone(working, p.id)}/{working.steps.size}</span></>}
                      </span>}
                </div>
              );
            })}
          </div>

          {/* The tiers */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {tiers.map(t => {
              const total = t.steps.size;
              const everyoneDone = ids.length > 0 && ids.every(id => tierComplete(t, id));
              const sum = ids.reduce((n, id) => n + (tierComplete(t, id) ? total : stepsDone(t, id)), 0);
              const pct = total && ids.length ? Math.round((sum / (total * ids.length)) * 100) : 0;
              const isOpen = expanded === t.n;
              const isCurrent = current === t.n;
              return (
                <div key={t.n} style={{ border: `1px solid ${isOpen ? 'var(--gold-dark)' : 'var(--border)'}`, borderRadius: 'var(--radius)', background: isOpen ? 'var(--bg-panel-alt)' : 'transparent' }}>
                  <button onClick={() => setOpen(isOpen ? -1 : t.n)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: everyoneDone ? 'var(--green-bright)' : 'var(--text-bright)', minWidth: 52 }}>
                      Tier {t.n}{isCurrent && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--gold)' }}>●</span>}
                    </span>
                    <span style={{ flex: 1, height: 5, background: 'var(--bg-root)', borderRadius: 3, overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: everyoneDone ? 'var(--green-bright)' : 'var(--gold)', transition: 'width 0.4s' }} />
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', minWidth: 30, textAlign: 'right' }}>{everyoneDone ? '✓' : `${pct}%`}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{isOpen ? '▾' : '▸'}</span>
                  </button>

                  {isOpen && (
                    <div style={{ padding: '4px 10px 11px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {[...t.steps.values()].sort((a, b) => a.name.localeCompare(b.name)).map(step => (
                        <div key={step.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 7 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                            <span style={{ flex: 1, color: 'var(--text-bright)', fontWeight: 600 }}>{step.name}</span>
                            <span style={{ display: 'inline-flex', gap: 3 }}>
                              {players.map(p => {
                                const done = stepDone(step, p.id);
                                return <span key={p.id} title={`${p.rsn}: ${done ? 'done' : 'not yet'}`}
                                  style={{ width: 10, height: 10, borderRadius: '50%', background: done ? colorMap[p.id] : 'transparent', border: `1.5px solid ${colorMap[p.id]}`, opacity: done ? 1 : 0.45 }} />;
                              })}
                            </span>
                          </div>
                          {step.description && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4 }}>{step.description}</div>}
                          {step.reward && <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 2 }}>Reward: {step.reward}</div>}

                          {/* Progress counter, for each player who is not done yet */}
                          {step.target > 0 && players.some(p => step.who.has(p.id) && !stepDone(step, p.id)) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                              {players.filter(p => step.who.has(p.id) && !stepDone(step, p.id)).map(p => {
                                const prog = step.who.get(p.id).progress ?? 0;
                                const pc = Math.min(100, Math.round((prog / step.target) * 100));
                                return (
                                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                                    <span style={{ color: colorMap[p.id], minWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.rsn}</span>
                                    <span style={{ flex: 1, height: 4, background: 'var(--bg-root)', borderRadius: 2, overflow: 'hidden' }}>
                                      <span style={{ display: 'block', width: `${pc}%`, height: '100%', background: colorMap[p.id] }} />
                                    </span>
                                    <span style={{ color: 'var(--text)', minWidth: 78, textAlign: 'right' }}>{fmt(prog)} / {fmt(step.target)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                        {players.map((p, i) => <span key={p.id}>{i > 0 && ' · '}<span style={{ color: colorMap[p.id] }}>{p.rsn}</span> {tierComplete(t, p.id) ? 'tier done' : `${stepsDone(t, p.id)}/${total} steps`}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Read live from each character by the plugin (re-checked every few minutes). Members without the plugin show no progress.
          </div>
        </>
      )}
    </div>
  );
}
