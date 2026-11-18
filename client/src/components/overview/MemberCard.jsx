import React, { useState } from 'react';
import RsIcon from '../RsIcon';

// ── Member card ───────────────────────────────────────────────────────────────

export default function MemberCard({ player, active, color, onClick, isMe, onEditRsn, onSync, canWrite, onRemove, onOpenLoadout, loadoutOpen, online = false }) {
  const [avatarError, setAvatarError] = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const overall = player.skills?.find(s => s.skill_name === 'Overall');
  const hasSyncError = !!player.sync_error;

  async function handleSync(e) {
    e.stopPropagation();
    setSyncing(true);
    try { await onSync(player); } finally { setSyncing(false); }
  }
  const borderColor = active ? color : hasSyncError ? 'var(--red-bright)' : isMe ? 'var(--gold)' : 'var(--border)';
  const avatarUrl = `https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(player.rsn)}/chat.png`;

  return (
    <div onClick={onClick} style={{
      cursor: 'pointer', width: 140, position: 'relative',
      padding: '14px 16px',
      background: active ? 'var(--bg-panel)' : 'var(--bg-panel-alt)',
      border: `2px solid ${borderColor}`,
      borderRadius: 'var(--radius-lg)',
      boxShadow: hasSyncError ? '0 0 8px rgba(192,64,64,0.3)' : isMe && !active ? `0 0 10px ${color}33` : undefined,
      transition: 'border-color 0.15s, background 0.15s',
      userSelect: 'none',
      flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
    }}>
      {/* Sync error badge */}
      {hasSyncError && (
        <div
          title={`Sync error: ${player.sync_error}\nClick ✎ to correct the RSN`}
          style={{
            position: 'absolute', top: 10, right: 38,
            fontSize: 12, lineHeight: 1,
            color: 'var(--red-bright)',
          }}>⚠</div>
      )}

      <div title={online ? 'Online and playing right now' : undefined} style={{ position: 'relative', marginBottom: 8, flexShrink: 0 }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%', background: color,
        overflow: 'hidden', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: online ? '0 0 0 2px #3ddc6a, 0 0 12px 2px rgba(61,220,106,0.45)' : undefined,
      }}>
        {!avatarError ? (
          <img
            src={avatarUrl}
            alt={player.rsn}
            onError={() => setAvatarError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontWeight: 800, fontSize: 16, color: '#111' }}>
            {player.rsn[0].toUpperCase()}
          </span>
        )}
      </div>
      {online && <span className="gs-online-dot" style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: '50%', background: '#3ddc6a', border: '2px solid var(--bg-panel-alt)' }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, marginBottom: 3, maxWidth: '100%' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: active ? color : 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {player.rsn}
        </span>
      </div>
      {online && <div style={{ fontSize: 10, fontWeight: 700, color: '#3ddc6a', letterSpacing: '0.4px', marginBottom: 3 }}>PLAYING NOW</div>}
      {overall
        ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 1, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-dim)' }}>
              <img src="https://runescape.wiki/images/Multicombat.png" alt="Combat"
                width={12} height={12} style={{ imageRendering: 'crisp-edges', opacity: 0.85 }}
                onError={e => { e.target.style.display = 'none'; }} />
              {player.combat_level ?? '?'}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-dim)' }}>
              <img src="https://runescape.wiki/images/Statistics.png" alt="Total Level"
                width={12} height={12} style={{ imageRendering: 'crisp-edges', opacity: 0.85 }}
                onError={e => { e.target.style.display = 'none'; }} />
              {overall.level}
            </span>
            {player.quest_points > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-dim)' }}>
                <img src="https://runescape.wiki/images/Quest_points.png" alt="Quest Points"
                  width={12} height={12} style={{ imageRendering: 'crisp-edges', opacity: 0.85 }}
                  onError={e => { e.target.style.display = 'none'; }} />
                {player.quest_points}
              </span>
            )}
            {player.rune_score > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-dim)' }}>
                <img src="https://runescape.wiki/images/RuneScore.png" alt="RuneScore"
                  width={12} height={12} style={{ imageRendering: 'crisp-edges', opacity: 0.85 }}
                  onError={e => { e.target.style.display = 'none'; }} />
                {player.rune_score.toLocaleString()}
              </span>
            )}
          </div>
        : <div style={{ fontSize: 11, color: hasSyncError ? 'var(--red-bright)' : 'var(--text-dim)' }}>
            {hasSyncError ? 'Sync failed' : 'Not synced'}
          </div>}
      {isMe && (
        <div style={{
          position: 'absolute', top: 8, left: 8, display: 'inline-block',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.5px',
          background: 'var(--gold)', color: '#111',
          borderRadius: 4, padding: '1px 5px',
        }}>YOU</div>
      )}

      {/* Equipment button: opens the player's backpack, equipment and skills. Always visible. */}
      {onOpenLoadout && (
        <button type="button" data-tour="inspect" title="Inspect: backpack, equipment and skills" onClick={e => { e.stopPropagation(); onOpenLoadout(player); }} style={{
          position: 'absolute', top: 6, right: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, padding: 0, borderRadius: 6, cursor: 'pointer',
          background: loadoutOpen ? 'rgba(200,168,75,0.2)' : 'var(--bg-root)', border: `1px solid ${loadoutOpen ? 'var(--gold)' : 'var(--border)'}`,
        }}><RsIcon name="search" fallback="🔍" size={18} /></button>
      )}

    </div>
  );
}
