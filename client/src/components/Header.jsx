import React, { useState } from 'react';
import { api } from '../api/client';
import GroupNotesOverlay from './GroupNotesOverlay';
import PluginSetupModal from './PluginSetupModal';
import GroupHeaderInfo from './GroupHeaderInfo';
import HeaderStats from './HeaderStats';
import DiscordLogo from './DiscordLogo';
import RsIcon from './RsIcon';

export default function Header({ group, onSynced, onToast, isUnlocked, isClaimed, myRsn, onLockClick, onClaim, onClaimV2, onSetRsnClick, onWebhookClick, onMenuToggle, mobileMenuOpen, onTourClick, onAddPlayer }) {
  const [syncing, setSyncing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pluginOpen, setPluginOpen] = useState(false);

  async function syncAll() {
    if (!group?.id) return;
    setSyncing(true);
    try {
      const results = await api.syncAll(group.id);
      const failed = results.filter(r => !r.success);
      if (failed.length === 0) {
        onToast(`All ${results.length} players synced`, 'success');
      } else {
        onToast(`${results.length - failed.length} synced, ${failed.length} failed`, 'error');
      }
      onSynced();
    } catch (err) {
      onToast(err.message, 'error');
    } finally {
      setSyncing(false);
    }
  }

  const lastSync = group?.players
    ?.map(p => p.last_synced)
    .filter(Boolean)
    .sort()
    .reverse()[0];

  const syncAgo = lastSync
    ? (() => {
        // SQLite CURRENT_TIMESTAMP has no timezone indicator — treat as UTC
        const utcStr = lastSync.includes('T') ? lastSync : lastSync.replace(' ', 'T') + 'Z';
        const diff = Math.floor((Date.now() - new Date(utcStr)) / 60000);
        if (diff < 1) return 'just now';
        if (diff < 60) return `${diff}m ago`;
        const h = Math.floor(diff / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
      })()
    : 'never';

  const demo = !!group?.is_demo;                       // the public demo group: read-only, no claim, no unlock, no plugin, no sync
  const showClaimNudge = group && !demo && !isClaimed && !isUnlocked;

  return (
    <header className="header">
      {/* Hamburger — mobile only */}
      {onMenuToggle && (
        <button
          className="mobile-menu-btn btn btn-ghost btn-icon"
          onClick={onMenuToggle}
          title="Toggle groups menu"
          style={{ fontSize: 18, padding: '4px 6px', flexShrink: 0 }}>
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      )}
      <div className="header-logo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/logo-banner.png" alt="Group Ironman RS3 Companion" width={960} height={462} loading="eager" style={{ height: 34, width: 'auto', flexShrink: 0 }} />
      </div>
      {group && <GroupHeaderInfo group={group} />}
      {group && <HeaderStats group={group} />}
      {/* right side, left to right: Docs and Community, the small buttons, then Plugin and Sync All at the far right */}
      <div className="header-right">
        {/* ── Quiet links: documentation and community. Deliberately plainer than the buttons that act on the group. ── */}
        <a
          href="https://thosjo95.github.io/RS3-GIM-Companion-2.0/"
          target="_blank"
          rel="noopener noreferrer"
          title="Documentation: how everything works"
          className="header-quiet"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', height: 32, borderRadius: 'var(--radius)', color: 'var(--text-dim)', fontSize: 12, textDecoration: 'none', flexShrink: 0 }}
        >
          Docs
        </a>
        <a
          href="https://discord.gg/xbB2T2Q6A"
          target="_blank"
          rel="noopener noreferrer"
          title="Community: news, and get in touch with the developers and other enthusiasts"
          className="header-quiet"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 32, borderRadius: 'var(--radius)', color: 'var(--text-dim)', fontSize: 12, textDecoration: 'none', flexShrink: 0 }}
        >
          <DiscordLogo size={15} />
          Community
        </a>
        <span className="header-sep" style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px', flexShrink: 0 }} />
        {/* ── Auth indicator ── */}

        {/* Group not claimed → prompt to claim */}
        {group && !demo && !isClaimed && (
          <button
            data-tour="lock"
            className="sync-btn"
            onClick={() => setPluginOpen(true)}
            title="Claim this group to protect it with a secret and enable editing"
            style={{
              background: 'transparent',
              border: '1px solid var(--gold)',
              color: 'var(--gold)',
              padding: '0 12px', fontSize: 12, fontWeight: 600,
              animation: 'pulse 2s ease-in-out infinite',
            }}>
            <RsIcon name="group" fallback="" size={14} /> Claim group
          </button>
        )}

        {/* Claimed but not yet unlocked on this browser → unlock button */}
        {group && !demo && isClaimed && !isUnlocked && (
          <button
            data-tour="lock"
            className="sync-btn"
            onClick={onLockClick}
            title="Enter your group secret to enable editing"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              padding: '0 12px', fontSize: 12,
            }}>
            <RsIcon name="group" fallback="" size={14} /> Unlock
          </button>
        )}

        {/* Already unlocked → show player badge (no action required) */}
        {group && isClaimed && isUnlocked && (
          <button
            data-tour="rsn"
            className="sync-btn"
            onClick={onSetRsnClick}
            title={myRsn ? `Logged in as ${myRsn} · Click to change character` : 'Set your character name'}
            style={{
              background: 'transparent',
              border: '1px solid var(--green)',
              color: myRsn ? 'var(--green-bright)' : 'var(--text-dim)',
              padding: '0 12px', fontSize: 12, fontWeight: myRsn ? 600 : 400,
            }}>
            {myRsn || 'Set your name'}
          </button>
        )}

        {/* Group Notes — always accessible when a group is loaded */}
        {group && (
          <button
            data-tour="notes"
            className="sync-btn"
            onClick={() => setNotesOpen(n => !n)}
            title="Group Notes"
            style={{
              width: 32, height: 32, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, fontSize: 16,
              background: notesOpen ? 'rgba(200,168,75,0.15)' : 'transparent',
              border: `1px solid ${notesOpen ? 'var(--gold)' : 'var(--border)'}`,
              color: 'var(--gold)',
            }}>
            📝
          </button>
        )}

        {/* Notifications / webhook settings — only when unlocked */}
        {group && isClaimed && isUnlocked && onWebhookClick && (
          <button
            className="sync-btn"
            onClick={onWebhookClick}
            title="Discord notifications: send group events to a Discord channel"
            style={{
              width: 32, height: 32, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              background: 'rgba(88,101,242,0.15)',
              border: '1px solid rgba(88,101,242,0.45)',
              color: '#8b9afc',
            }}>
            <DiscordLogo size={18} />
          </button>
        )}

        {/* Tour replay button */}
        {group && onTourClick && (
          <button
            className="sync-btn"
            data-tour="help"
            onClick={onTourClick}
            title="Show feature tour"
            style={{
              width: 32, height: 32, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, fontSize: 16, fontWeight: 700,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
            }}>
            ?
          </button>
        )}

        <span className="header-sep" style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px', flexShrink: 0 }} />
        {lastSync && <span className="last-sync">Sync: {syncAgo}</span>}

        {/* Plugin setup — the group's connection to the game; needs the unlocked group to create tokens */}
        {group && !demo && (
          <button
            data-tour="plugin"
            onClick={() => setPluginOpen(true)}
            title="Plugin setup — connect each member's in-game plugin"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '0 10px', height: 32, borderRadius: 'var(--radius)', cursor: 'pointer',
              background: pluginOpen ? 'rgba(200,168,75,0.22)' : 'rgba(200,168,75,0.10)',
              border: '1px solid rgba(200,168,75,0.35)',
              color: 'var(--gold)', fontSize: 12, fontWeight: 600, flexShrink: 0,
            }}>
            <RsIcon name="setup" fallback="🔌" size={16} />
            Plugin
          </button>
        )}


        {group && !demo && (
          <button data-tour="sync" className="sync-btn" onClick={syncAll} disabled={syncing}>
            {syncing ? <><span className="spinner" style={{width:14,height:14}} /> Syncing…</> : '↻ Sync All'}
          </button>
        )}

      </div>
      {pluginOpen && group?.id && (
        <PluginSetupModal group={group} canWrite={isUnlocked} isClaimed={isClaimed} onClaim={onClaim} onClaimV2={onClaimV2} onUnlock={onLockClick} onToast={onToast} onChanged={onSynced} onAddPlayer={onAddPlayer} onClose={() => setPluginOpen(false)} />
      )}
      {notesOpen && group?.id && (
        <GroupNotesOverlay
          groupId={group.id}
          canWrite={isUnlocked}
          onToast={onToast}
          onClose={() => setNotesOpen(false)}
        />
      )}
    </header>
  );
}
