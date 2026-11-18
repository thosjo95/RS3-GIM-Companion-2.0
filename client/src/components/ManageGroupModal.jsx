import React, { useState } from 'react';
import { api } from '../api/client';
import { MEMBER_COLORS } from '../lib/rs3';
import EditRsnModal from './overview/EditRsnModal';
import { useConfig } from './PreviewBanner';

// "Manage group": the roster in one place. Add a player, correct a character name, remove a member. These used to
// sit on the player cards; they live here so the cards stay clean.
// The group's own minimum for a drop (total gp) to show in its Drops. The plugin reads it too when it starts.
const DROP_STEPS = [[0, 'Every drop'], [50_000, '50K'], [100_000, '100K'], [250_000, '250K'], [500_000, '500K'], [1_000_000, '1M'], [2_500_000, '2.5M'], [5_000_000, '5M'], [10_000_000, '10M']];

export default function ManageGroupModal({ group, onClose, onAddPlayer, onChanged, onToast }) {
  const config = useConfig();
  const defaultMin = config?.drop_default_min ?? 100_000;
  const [dropMin, setDropMin] = useState(group?.drop_min_value ?? defaultMin);
  async function saveDropMin(v) {
    const prev = dropMin;
    setDropMin(v);
    try { await api.setDropMin(group.id, v); onToast?.('Drops now show from ' + (v === 0 ? 'every drop' : DROP_STEPS.find(s => s[0] === v)?.[1] ?? v.toLocaleString() + ' gp'), 'success'); onChanged?.(); }
    catch (e) { setDropMin(prev); onToast?.(e.message, 'error'); }
  }
  const players = group?.players ?? [];
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);       // the player waiting for a second click to confirm

  async function remove(p) {
    try {
      await api.deletePlayer(p.id);
      setRemoving(null);
      onToast?.(`${p.rsn} removed`, 'success');
      onChanged();
    } catch (e) { onToast?.(e.message, 'error'); }
  }

  const iconBtn = { background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, padding: '4px 10px' };
  return (
    <>
      <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 520 }}>
          <div className="modal-header">
            <span className="modal-title">Manage group</span>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              {group?.name} has {players.length} member{players.length === 1 ? '' : 's'}. For a Group Ironman, new members are added automatically every night;
              use Add player for a custom group or to add someone by hand.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {players.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: MEMBER_COLORS[i % MEMBER_COLORS.length], flexShrink: 0 }} />
                  <strong style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.rsn}</strong>
                  {p.sync_error && <span title={p.sync_error} style={{ fontSize: 11, color: 'var(--red-bright)' }}>sync error</span>}
                  <button style={iconBtn} onClick={() => setEditing(p)} title="Correct the character name">Edit name</button>
                  {removing === p.id
                    ? (
                      <>
                        <button style={{ ...iconBtn, color: '#fff', background: 'var(--red-bright)', borderColor: 'var(--red-bright)' }} onClick={() => remove(p)} title="Deletes the player and all of their data">Confirm remove</button>
                        <button style={iconBtn} onClick={() => setRemoving(null)}>Cancel</button>
                      </>
                    )
                    : <button style={{ ...iconBtn, color: 'var(--red-bright)' }} onClick={() => setRemoving(p.id)}>Remove</button>}
                </div>
              ))}
              {players.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No members yet.</div>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-panel-alt)' }}>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-bright)' }}>Smallest drop to show</strong><br />
                Drops worth less than this (quantity times value) stay out of the Drops list. Drops of unknown value are always shown. The plugin picks the new value up the next time it starts.
              </div>
              <select className="form-input" value={dropMin} onChange={e => saveDropMin(Number(e.target.value))} style={{ width: 120 }}>
                {!DROP_STEPS.some(s => s[0] === dropMin) && <option value={dropMin}>{dropMin.toLocaleString()} gp</option>}
                {DROP_STEPS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>

            {removing != null && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Removing a member deletes their skills, goals, gear, drops and plugin data. This cannot be undone.</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={() => { onClose(); onAddPlayer(); }}>+ Add player</button>
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <EditRsnModal player={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} onToast={onToast} />
      )}
    </>
  );
}
