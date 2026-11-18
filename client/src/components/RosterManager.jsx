import React, { useState } from 'react';
import { api } from '../api/client';
import { MEMBER_COLORS } from '../lib/rs3';
import EditRsnModal from './overview/EditRsnModal';

// The group's members, in the Plugin window: add a player, correct a character name, remove a member.
// (This used to be the "+" button in the top bar.)
export default function RosterManager({ group, onAddPlayer, onChanged, onToast }) {
  const players = group?.players ?? [];
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);       // the player waiting for a second click to confirm

  async function remove(p) {
    try {
      await api.deletePlayer(p.id);
      setRemoving(null);
      onToast?.(`${p.rsn} removed`, 'success');
      onChanged?.();
    } catch (e) { onToast?.(e.message, 'error'); }
  }

  const iconBtn = { background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, padding: '4px 10px' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Members ({players.length})
        </div>
        {onAddPlayer && <button className="btn btn-primary btn-sm" onClick={onAddPlayer}>+ Add player</button>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        For a Group Ironman, new members are added automatically every night. Use Add player for a custom group or to add someone by hand.
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
      {removing != null && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Removing a member deletes their skills, goals, gear, drops and plugin data. This cannot be undone.</div>
      )}

      {editing && (
        <EditRsnModal player={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged?.(); }} onToast={onToast} />
      )}
    </div>
  );
}
