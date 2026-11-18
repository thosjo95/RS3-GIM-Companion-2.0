import React, { useState } from 'react';
import { api } from '../api/client';
import { MEMBER_COLORS, normRsn } from '../lib/rs3';
import MemberCard from './overview/MemberCard';
import EditRsnModal from './overview/EditRsnModal';
import PlayerLoadout from './PlayerLoadout';

/**
 * The group's player cards, pinned above every page. Clicking a card selects that player; every page then
 * shows only that player's data (click again, or "All players", to see the whole group). This is the ONE
 * place the player filter lives — pages do not have their own.
 *
 * Also owns the roster actions that used to sit in the Overview: add, refresh roster, sync, edit RSN, remove.
 */
export default function PlayerBar({ group, players, groupId, canWrite, myRsn, selectedId, onSelect, onRefresh, onToast, onAddPlayer }) {
  const [editRsnPlayer, setEditRsnPlayer] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [loadoutId, setLoadoutId] = useState(null);       // whose backpack / equipment / skills panel is open
  const loadoutPlayer = players.find(p => p.id === loadoutId) ?? null;
  const closePanels = () => setLoadoutId(null);
  const isUnranked = group?.gim_type === 'regular_unranked';

  async function handleRemovePlayer(player) {
    if (!window.confirm(`Remove ${player.rsn} from this group?\n\nThis will permanently delete their skills, goals, gear and activity data.`)) return;
    try {
      await api.deletePlayer(player.id);
      if (selectedId === player.id) onSelect(null);
      await onRefresh();
      onToast?.(`${player.rsn} removed`, 'success');
    } catch (err) {
      onToast?.(err.message, 'error');
    }
  }

  async function handleRefreshRoster() {
    setRosterLoading(true);
    try {
      const result = await api.refreshRoster(groupId);
      await onRefresh();
      const parts = [];
      if (result.added?.length)   parts.push(`+${result.added.join(', +')}`);
      if (result.removed?.length) parts.push(`−${result.removed.join(', −')}`);
      onToast?.(parts.length ? `Roster updated: ${parts.join(' ')}` : 'Roster is up to date', 'success');
    } catch (err) {
      onToast?.(err.message || 'Roster refresh failed', 'error');
    } finally {
      setRosterLoading(false);
    }
  }

  async function syncOnePlayer(player) {
    try {
      await api.syncPlayer(player.id);
      onToast?.(`${player.rsn} synced`, 'success');
      onRefresh();
    } catch (err) {
      onToast?.(err.message || 'Sync failed', 'error');
      onRefresh(); // refresh anyway to show updated sync_error
    }
  }

  if (players.length === 0 && !canWrite) return null;

  return (
    <div data-tour="members" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      {/* Selection summary + roster controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`chip${selectedId == null ? ' active' : ''}`}
          onClick={() => onSelect(null)}
          title="Show the whole group on every page">
          All players
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {selectedId == null ? 'Click a player to focus every page on them' : 'Showing one player on every page — click their card again to show everyone'}
        </span>
        <div style={{ flex: 1 }} />
        {canWrite && (
          <>
            {!isUnranked && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRefreshRoster}
                disabled={rosterLoading}
                title="Re-fetch member list from RS3 hiscores and apply changes"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {rosterLoading
                  ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Refreshing…</>
                  : '↻ Refresh Roster'}
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={onAddPlayer}>➕ Add Player</button>
          </>
        )}
      </div>

      {players.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 4 }}>
          <div className="icon">👤</div>
          <p>No members yet. Add your first player to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4, position: 'relative' }}>
          {players.map((p, i) => (
            <MemberCard
              key={p.id}
              player={p}
              active={selectedId === p.id}
              color={MEMBER_COLORS[i % MEMBER_COLORS.length]}
              onClick={() => onSelect(selectedId === p.id ? null : p.id)}
              isMe={!!myRsn && normRsn(p.rsn) === normRsn(myRsn)}
              canWrite={canWrite}
              onEditRsn={setEditRsnPlayer}
              onSync={syncOnePlayer}
              onRemove={canWrite ? handleRemovePlayer : undefined}
              onOpenLoadout={pl => { setLoadoutId(id => (id === pl.id ? null : pl.id)); }}
              loadoutOpen={loadoutId === p.id}
            />
          ))}
        </div>
      )}

      {/* Floats over the page (does not push anything down); a click outside closes it */}
      {loadoutPlayer && (
        <>
          <div onClick={closePanels} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
          <div style={{ position: 'relative', height: 0, marginTop: -8, zIndex: 91 }}>
            <div style={{ position: 'absolute', top: 4, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ pointerEvents: 'auto', boxShadow: '0 12px 36px rgba(0,0,0,0.65)', borderRadius: 'var(--radius-lg)', maxWidth: '100%' }}>
                <PlayerLoadout player={loadoutPlayer} groupId={groupId} canWrite={canWrite} onClose={closePanels} />
              </div>
            </div>
          </div>
        </>
      )}

      {editRsnPlayer && (
        <EditRsnModal
          player={editRsnPlayer}
          onClose={() => setEditRsnPlayer(null)}
          onSaved={() => { setEditRsnPlayer(null); onRefresh(); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}
