import React, { useMemo } from 'react';
import { fmtXp } from '../lib/rs3';
import SkillTable from './overview/SkillTable';
import SnapshotButton from './overview/SnapshotButton';
import GroupStats from './overview/GroupStats';
import RightPanel from './overview/RightPanel';
import GroupLeaderboard from './GroupLeaderboard';

// ── Main export ───────────────────────────────────────────────────────────────

// The player cards (and the player filter) live in PlayerBar, pinned above every page; `selectedId` comes from there.
export default function OverviewTab({ group, goals, players, groupId, onRefresh, onToast, canWrite, myRsn, selectedId = null, pendingRequests = [], onGoToRequests }) {

  const selectedPlayer = players.find(p => p.id === selectedId) ?? null;

  const groupTotals = useMemo(() => {
    let totalXp = 0, totalLevel = 0;
    for (const p of players) {
      const ov = p.skills?.find(s => s.skill_name === 'Overall');
      totalXp += ov?.xp || 0;
      totalLevel += ov?.level || 0;
    }
    return { totalXp, totalLevel };
  }, [players]);

  // Active players: weekly_xp_gain > 0 means they earned XP in the past 7 days
  const activePlayers = useMemo(
    () => players.filter(p => p.weekly_xp_gain != null && p.weekly_xp_gain > 0),
    [players]
  );
  const hasWeeklyData = players.some(p => p.weekly_xp_gain != null);

  const selOverall = selectedPlayer?.skills?.find(s => s.skill_name === 'Overall');
  const selWeeklyXp = selectedPlayer?.weekly_xp_gain;

  // 4 stat boxes — same positions, last box swaps between group/player
  const statBoxes = selectedPlayer
    ? [
        { label: 'Combat Level', value: selectedPlayer.combat_level ?? '—' },
        { label: 'Total XP', value: fmtXp(selOverall?.xp) },
        { label: 'Total Level', value: selOverall?.level ?? '—' },
        {
          label: 'XP This Week',
          value: selWeeklyXp != null ? (selWeeklyXp > 0 ? `+${fmtXp(selWeeklyXp)}` : '—') : 'No data',
          dim: selWeeklyXp == null || selWeeklyXp === 0,
          tooltip: 'XP gained by this player in the past 7 days based on snapshots',
        },
      ]
    : [
        { label: 'Members', value: players.length },
        { label: 'Total XP', value: fmtXp(groupTotals.totalXp) },
        { label: 'Total Levels', value: groupTotals.totalLevel.toLocaleString() },
        {
          label: 'Active This Week',
          value: hasWeeklyData ? `${activePlayers.length} / ${players.length}` : 'Sync needed',
        },
      ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stat boxes */}
      <div className="grid-4">
        {statBoxes.map(b => (
          <div
            key={b.label}
            className="stat-box"
          >
            <div className="stat-label">{b.label}</div>
            <div className="stat-value" style={{ color: b.dim ? 'var(--text-dim)' : undefined }}>
              {b.value}
            </div>
          </div>
        ))}
      </div>

      {/* Pending item requests banner */}
      {pendingRequests.length > 0 && (
        <button
          onClick={onGoToRequests}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', cursor: 'pointer',
            background: 'rgba(200,168,75,0.07)',
            border: '1px solid rgba(200,168,75,0.35)',
            borderRadius: 'var(--radius-lg)', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>📦</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--gold)' }}>
              {pendingRequests.length} active item request{pendingRequests.length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 8 }}>
              {[...new Set(pendingRequests.map(r => r.owner_rsn ?? r.rsn).filter(Boolean))].join(', ')}
            </span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--gold)', flexShrink: 0 }}>View in Active Goals →</span>
        </button>
      )}

      {/* The group's own leaderboard and competitions */}
      <GroupLeaderboard players={players} groupId={groupId} canWrite={canWrite} onToast={onToast} />

      {/* Two-column content */}
      <div className="grid-2">
        {/* Left */}
        <div className="panel">
          <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="panel-title" style={{ flex: 1 }}>
              {selectedPlayer ? selectedPlayer.rsn : 'Group Stats'}
            </span>
            {!selectedPlayer && group && (
              <SnapshotButton group={group} players={players} goals={goals} onToast={onToast} />
            )}
          </div>
          <div className="panel-body">
            {selectedPlayer
              ? selectedPlayer.skills?.length > 0
                ? <SkillTable player={selectedPlayer} />
                : <div className="empty-state"><p>No data — sync this player first.</p></div>
              : players.length > 0
                ? <GroupStats players={players} goals={goals} groupId={groupId} />
                : <div className="empty-state"><p>No players yet.</p></div>}
          </div>
        </div>

        {/* Right: Goals + Activity */}
        <div className="panel">
          <div className="panel-body">
            <RightPanel
              goals={goals}
              players={players}
              filteredPlayerId={selectedId}
              groupId={groupId}
              onRefresh={onRefresh}
              onToast={onToast}
              canWrite={canWrite}
              myRsn={myRsn}
            />
          </div>
        </div>
      </div>

      {/* Group notes */}
      {group?.notes && (
        <div className="panel">
          <div className="panel-header"><span className="panel-title">Notes</span></div>
          <div className="panel-body text-dim" style={{ fontSize: 13 }}>{group.notes}</div>
        </div>
      )}

    </div>
  );
}
