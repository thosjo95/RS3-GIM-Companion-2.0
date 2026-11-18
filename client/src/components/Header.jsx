import React, { useState } from 'react';
import { api } from '../api/client';
import GroupNotesOverlay from './GroupNotesOverlay';
import PluginSetupModal from './PluginSetupModal';
import GroupHeaderInfo from './GroupHeaderInfo';
import HeaderStats from './HeaderStats';
import ManageGroupModal from './ManageGroupModal';
import DiscordLogo from './DiscordLogo';
import RsIcon from './RsIcon';

export default function Header({ group, onSynced, onToast, isUnlocked, isClaimed, myRsn, onLockClick, onClaimClick, onSetRsnClick, onWebhookClick, onMenuToggle, mobileMenuOpen, onTourClick, onAddPlayer }) {
  const [syncing, setSyncing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pluginOpen, setPluginOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

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

  const showClaimNudge = group && !isClaimed && !isUnlocked;

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
      {/* everything on the right: group actions first, then the quiet site links */}
      <div className="header-right">
        {lastSync && <span className="last-sync">Sync: {syncAgo}</span>}

        {/* ── Auth indicator ── */}

        {/* Group not claimed → prompt to claim */}
        {group && !isClaimed && (
          <button
            data-tour="lock"
            className="sync-btn"
            onClick={onClaimClick}
            title="Claim this group to protect it with a secret and enable editing"
            style={{
              background: 'transparent',
              border: '1px solid var(--gold)',
              color: 'var(--gold)',
              padding: '0 12px', fontSize: 12, fontWeight: 600,
              animation: 'pulse 2s ease-in-out infinite',
            }}>
            🔒 Claim group
          </button>
        )}

        {/* Claimed but not yet unlocked on this browser → unlock button */}
        {group && isClaimed && !isUnlocked && (
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
            🔒 Unlock
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

        {/* Add a character to the group by hand (unlocked groups) */}
        {group && isUnlocked && onAddPlayer && (
          <button
            data-tour="add-player"
            className="sync-btn"
            onClick={() => setManageOpen(true)}
            title="Manage group: add players, correct names, remove members"
            style={{
              width: 32, height: 32, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, fontSize: 18, fontWeight: 700,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
            }}>
            +
          </button>
        )}

        {/* Plugin setup — the group's connection to the game; needs the unlocked group to create tokens */}
        {group && (
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


        {group && (
          <button data-tour="sync" className="sync-btn" onClick={syncAll} disabled={syncing}>
            {syncing ? <><span className="spinner" style={{width:14,height:14}} /> Syncing…</> : '↻ Sync All'}
          </button>
        )}

        <span className="header-sep" style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px', flexShrink: 0 }} />
        {/* Tour replay button */}
        {group && onTourClick && (
          <button
            className="sync-btn"
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
          href="https://discord.gg/uZT4JDdtn2"
          target="_blank"
          rel="noopener noreferrer"
          title="Community: news, and get in touch with the developers and other enthusiasts"
          className="header-quiet"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', height: 32, borderRadius: 'var(--radius)', color: 'var(--text-dim)', fontSize: 12, textDecoration: 'none', flexShrink: 0 }}
        >
          <DiscordLogo size={15} />
          Community
        </a>
      </div>
      {manageOpen && group && <ManageGroupModal group={group} onClose={() => setManageOpen(false)} onAddPlayer={() => onAddPlayer?.()} onChanged={() => onSynced?.()} onToast={onToast} />}
      {pluginOpen && group?.id && (
        <PluginSetupModal group={group} canWrite={isUnlocked} onToast={onToast} onClose={() => setPluginOpen(false)} />
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
