import React, { useState } from 'react';
import { IconLabel } from '../RsIcon';
import { api } from '../../api/client';
import { normRsn } from '../../lib/rs3';
import GoalModal from '../GoalModal';
import DropsPanel, { ChestButton, useRecentDrops, useUnseenDrops } from '../DropsChest';
import ActivityFeed from './ActivityFeed';
import GoalItem from './GoalItem';
import { STATUS_CYCLE } from './constants';

// ── Right panel: Goals + Activity ─────────────────────────────────────────────

export default function RightPanel({ goals, players, filteredPlayerId, groupId, onRefresh, onToast, canWrite, myRsn }) {
  const [open, setOpen] = useState(null);          // 'drops' | 'goals' | null: the floating panel that is open
  const drops = useRecentDrops(groupId);
  const { fresh: freshDrops } = useUnseenDrops(groupId, drops, open === 'drops');
  const [showModal, setShowModal] = useState(false);
  const [prefill, setPrefill] = useState({});

  // Resolve "me" — the player whose RSN matches what the user set as their character
  const myPlayerId = myRsn
    ? (players.find(p => normRsn(p.rsn) === normRsn(myRsn))?.id ?? null)
    : null;

  const filtered = filteredPlayerId
    ? goals.filter(g => g.owner_id === filteredPlayerId || g.type === 'group')
    : goals;

  // Exclude vaulted goals from both lists — they belong in the Vault tab
  const active = filtered.filter(g => g.status !== 'complete' && g.status !== 'vaulted');
  const done   = filtered.filter(g => g.status === 'complete');

  async function cycleStatus(goal) {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(goal.status) + 1) % STATUS_CYCLE.length];
    try { await api.updateGoal(goal.id, { status: next }); onRefresh(); }
    catch (err) { onToast(err.message, 'error'); }
  }

  async function deleteGoal(id) {
    if (!confirm('Delete this goal?')) return;
    try { await api.deleteGoal(id); onRefresh(); }
    catch (err) { onToast(err.message, 'error'); }
  }

  async function updateCount(id, value) {
    try { await api.updateGoal(id, { current_value: value }); onRefresh(); }
    catch (err) { onToast(err.message, 'error'); }
  }

  async function vaultGoal(id) {
    try { await api.updateGoal(id, { status: 'vaulted' }); onRefresh(); onToast('Moved to the Vault', 'success'); }
    catch (err) { onToast(err.message, 'error'); }
  }

  const hasActivity = players.some(p => p.activities_json);
  const { fresh: freshGoals } = useUnseenDrops(groupId, goals, open === 'goals', 'gim_goals_seen_');
  const openAddGoal = () => {
    // Priority: active player card, then the myRsn match, then nothing (GoalModal uses the first player)
    const defaultOwner = filteredPlayerId ?? myPlayerId ?? null;
    setPrefill(defaultOwner ? { owner_id: defaultOwner } : {});
    setOpen(null);
    setShowModal(true);
  };
  const toggle = id => setOpen(o => (o === id ? null : id));

  return (
    <div>
      {/* Drops chest + Goals: tiles that open as panels floating over the page (they do not push the activity down) */}
      <div style={{ position: 'relative', marginBottom: 18 }}>
        <div data-tour="drops-chest" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <ChestButton drops={drops} fresh={freshDrops} open={open === 'drops'} onClick={() => toggle('drops')} />
          <ChestButton icon="goals" fallback="🎯" label="Goals" fresh={freshGoals} open={open === 'goals'} onClick={() => toggle('goals')}
            sub={`${active.length} active${done.length ? ` · ${done.length} done` : ''}`} />
        </div>

        {open && (
          <>
            <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, zIndex: 91, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto', width: 'min(520px, 100%)', boxShadow: '0 12px 36px rgba(0,0,0,0.65)', borderRadius: 'var(--radius-lg)' }}>
              {open === 'drops' && <DropsPanel drops={drops} players={players} selectedId={filteredPlayerId} onClose={() => setOpen(null)} />}
              {open === 'goals' && (
                <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-root)' }}>
                    <IconLabel name="goals" fallback="🎯" size={20}><strong style={{ fontSize: 13, color: 'var(--text-bright)' }}>Goals</strong></IconLabel>
                    <span style={{ flex: 1 }} />
                    {canWrite
                      ? <button className="btn btn-primary btn-sm" onClick={openAddGoal}>+ Add Goal</button>
                      : <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>🔒 Claim to add</span>}
                    <button type="button" onClick={() => setOpen(null)} title="Close" style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>×</button>
                  </div>
                  <div style={{ maxHeight: 420, overflowY: 'auto', padding: 10 }}>
                    {[...active].sort((x, y) => (y.id || 0) - (x.id || 0)).map(g => (
                      <GoalItem key={g.id} goal={g} players={players} onCycle={cycleStatus} onDelete={deleteGoal} onUpdateCount={updateCount} onVault={vaultGoal} canWrite={canWrite} />
                    ))}
                    {done.length > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer', userSelect: 'none', marginBottom: 6 }}>✓ {done.length} completed</summary>
                        {done.map(g => (
                          <GoalItem key={g.id} goal={g} players={players} onCycle={cycleStatus} onDelete={deleteGoal} onUpdateCount={updateCount} onVault={vaultGoal} canWrite={canWrite} />
                        ))}
                      </details>
                    )}
                    {active.length === 0 && done.length === 0 && (
                      <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No goals yet. {canWrite ? 'Add your first one!' : ''}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            </div>
          </>
        )}
      </div>

      {hasActivity && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Recent Activity</div>
          <ActivityFeed players={players} filteredPlayerId={filteredPlayerId} />
        </div>
      )}

      {showModal && (
        <GoalModal
          players={players}
          prefill={filteredPlayerId ? { ...prefill, owner_id: filteredPlayerId } : prefill}
          myRsn={myRsn}
          onClose={() => setShowModal(false)}
          onSaved={onRefresh}
          onToast={onToast}
        />
      )}
    </div>
  );
}
