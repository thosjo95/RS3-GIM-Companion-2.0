import React, { useState, useEffect, useRef, useCallback } from 'react';

function CustomGroupBanner({ groupId }) {
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => {
    localStorage.setItem(`customGroupBanner_${groupId}`, '1');
    setDismissed(true);
  }, [groupId]);
  if (dismissed) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '12px 16px', marginTop: 16, marginBottom: 20,
      background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.3)',
      borderRadius: 'var(--radius)', fontSize: 13,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
      <span style={{ flex: 1, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        <strong style={{ color: '#38bdf8' }}>Custom Group</strong> — for regular RS3 players tracking shared progress together.
        Stats sync from the RS3 hiscores just like a GIM group.{' '}
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          Note: the activity feed &amp; drops depend on each player's in-game RuneMetrics Event Log settings.
        </span>
      </span>
      <button
        onClick={dismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 16, flexShrink: 0, padding: 0 }}
        title="Dismiss">✕</button>
    </div>
  );
}
import VaultTab from './VaultTab';
import OverviewTab from './OverviewTab';
import LeaderboardsTab from './LeaderboardsTab';
import PlayerBar from './PlayerBar';
import { IconLabel } from './RsIcon';
import QuestsAreaTab from './QuestsAreaTab';
import GoalsTab from './GoalsTab';
import TourOverlay from './TourOverlay';

// ── Per-tab tour step definitions ─────────────────────────────────────────────

const TAB_TOURS = {
  goals: [
    {
      target: null,
      title: 'Goals',
      body: "Your group's planning board. It checks the game for you: goals the players have already achieved are completed automatically and open goals show live progress.",
    },
    {
      target: '[data-tour="goals-sections"]',
      title: 'Goal Browser vs Active Goals',
      body: 'Switch between the Goal Browser (280 suggestions across quests, skills, bosses and items, plus Recommended next) and Active Goals (your live board).',
    },
    {
      target: '[data-tour="goals-browser"]',
      title: 'Goal Browser and recommendations',
      body: 'Recommended next suggests quests you can start now, bosses you have not killed yet, the next area task tier, journey steps and skills close to 99. Suggestions are checked against the player selected at the top. Hit Add to move one to your board.',
    },
    {
      target: '[data-tour="goals-filters"]',
      title: 'Filters and views',
      body: 'On the Active Goals board, filter by player, category, priority or scope, and switch between Board and List.',
    },
  ],

  vault: [
    {
      target: null,
      title: 'Group Vault',
      body: "Everything your group has stored, read from the game by the plugin: every member's bank and the shared group storage. Recent drops live in the chest on the front page.",
    },
    {
      target: '[data-tour="vault-panel"]',
      title: 'Players banks and Group Storage',
      body: 'Players banks (the default) lists each item once with every member who has it banked and how many, with bars showing each share. Group Storage shows the shared storage. Switch between Cards, Tiles and List, search, and sort by quantity, value or name. The Bank Journal button lists deposits and withdrawals of the group storage.',
    },
  ],

  achievements: [
    {
      target: null,
      title: 'Quests and Tasks',
      body: 'Quest progress read live from the game, the area task grid, and the Group Ironman Journey, all on one page.',
    },
    {
      target: '[data-tour="achievements-progress"]',
      title: 'Player progress',
      body: 'Pick a player card at the top to focus on one person, or compare everyone side by side.',
    },
    {
      target: '[data-tour="achievements-view"]',
      title: 'Quests, area tasks and achievements',
      body: 'Switch between the quest grid (filter by difficulty, free-to-play and who is still missing it), the area task grid, and the list of completed achievements.',
    },
  ],

  leaderboards: [
    {
      target: null,
      title: 'Leaderboards',
      body: "Built from the game and your group's activity feeds: no manual tracking needed.",
    },
    {
      target: '[data-tour="leaderboards-nav"]',
      title: 'Sections',
      body: 'Firsts, Milestones, Boss Kills, Slayer Kills, Clue Scrolls and Skill Mastery. Pick a player card at the top to narrow the tables to one player.',
    },
    {
      target: '[data-tour="leaderboards-panel"]',
      title: 'Where the numbers come from',
      body: 'Boss and slayer kills are the exact counts from the game (plugin). Firsts and milestones come from the Adventurer\'s Log feed, clue counts and XP from the hiscores.',
    },
  ],
};

const TAB_TOUR_KEY = {
  goals:         'tourCompleted_goals',
  vault:         'tourCompleted_vault',
  achievements:  'tourCompleted_achievements',
  leaderboards:  'tourCompleted_leaderboards',
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard({ group, goals, pendingRequests, onRefresh, onToast, activeTab, onTabChange, onAddPlayer, groupId, myRsn, canWrite, tabTourReplayKey }) {
  const players = group?.players || [];
  const isCustomGroup = group?.gim_type === 'custom';

  const [tabTour, setTabTour]       = useState(null); // null | 'goals' | 'vault' | ...
  const [goalsJumpKey, setGoalsJumpKey] = useState(0); // incremented to force GoalsTab → Active Goals

  // The ONE player filter for the whole dashboard: the cards pinned at the top (PlayerBar). null = everyone.
  // Several cards can be selected to compare them: one selected player is a single-player view, two or more is a
  // comparison of just those, none is the whole group.
  const [selectedIds, setSelectedIds] = useState([]);
  useEffect(() => {   // forget selected players that were removed or when the group changes
    setSelectedIds(ids => (ids.every(id => players.some(p => p.id === id)) ? ids : ids.filter(id => players.some(p => p.id === id))));
  }, [players]);
  const toggleSelected = id => setSelectedIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
  const selectedPlayerId = selectedIds.length === 1 ? selectedIds[0] : null;       // for pages that take one player
  // Pages that list players side by side (Area Tasks, Leaderboards) receive just the selected players.
  const visiblePlayers = selectedIds.length > 0 ? players.filter(p => selectedIds.includes(p.id)) : players;
  const shownRef                    = useRef({});      // tracks which tours have fired this session
  const prevReplayKey               = useRef(0);

  const TABS = [
    { id: 'overview',      icon: 'overview',     fallback: '📊', label: 'Overview' },
    { id: 'vault',         icon: 'vault',        fallback: '🏆', label: 'Group Vault',         tour: 'tab-vault' },
    { id: 'goals',         icon: 'goals',        fallback: '🎯', label: 'Goals',               tour: 'tab-goals' },
    { id: 'achievements',  icon: 'quests',       fallback: '📜', label: 'Quests and Tasks', tour: 'tab-achievements' },
    { id: 'leaderboards',  icon: 'leaderboards', fallback: '🏅', label: 'Leaderboards',        tour: 'tab-leaderboards' },
  ];

  // Auto-trigger per-tab tour on first visit
  useEffect(() => {
    if (!TAB_TOURS[activeTab]) return;
    if (shownRef.current[activeTab]) return;
    if (localStorage.getItem(TAB_TOUR_KEY[activeTab])) return;
    shownRef.current[activeTab] = true;
    const t = setTimeout(() => setTabTour(activeTab), 500);
    return () => clearTimeout(t);
  }, [activeTab]);

  // Replay signal from the global ? button in the header
  useEffect(() => {
    if (!tabTourReplayKey || tabTourReplayKey === prevReplayKey.current) return;
    prevReplayKey.current = tabTourReplayKey;
    if (TAB_TOURS[activeTab]) {
      shownRef.current[activeTab] = true; // prevent auto-trigger from re-firing
      setTabTour(activeTab);
    }
  }, [tabTourReplayKey, activeTab]);

  function completeTour(tab) {
    localStorage.setItem(TAB_TOUR_KEY[tab], '1');
    setTabTour(null);
  }

  return (
    <div>
      {/* Player cards — pinned above every page; they are the player filter */}
      <PlayerBar
        group={group}
        players={players}
        groupId={groupId}
        canWrite={canWrite}
        myRsn={myRsn}
        selectedIds={selectedIds}
        onToggle={toggleSelected}
        onRefresh={onRefresh}
        onToast={onToast}
        onAddPlayer={onAddPlayer}
      />

      {/* Tab bar */}
      <div className="flex gap-8 mb-20 tab-bar-scroll" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 1 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className="btn btn-ghost"
            {...(t.tour ? { 'data-tour': t.tour } : {})}
            style={{
              borderBottom: activeTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              borderRadius: 0,
              color: activeTab === t.id ? 'var(--gold)' : 'var(--text-dim)',
              paddingBottom: 8,
            }}>
            <IconLabel name={t.icon} fallback={t.fallback} size={18} gap={7}>{t.label}</IconLabel>
          </button>
        ))}
      </div>

      {/* Custom group info banner — dismissable */}
      {isCustomGroup && !localStorage.getItem(`customGroupBanner_${groupId}`) && (
        <CustomGroupBanner groupId={groupId} />
      )}

      {/* Tab content — universal top gap */}
      <div style={{ paddingTop: 12 }}>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <OverviewTab
          group={group}
          goals={goals}
          players={players}
          groupId={groupId}
          onRefresh={onRefresh}
          onToast={onToast}
          canWrite={canWrite}
          myRsn={myRsn}
          selectedId={selectedPlayerId}
          selectedIds={selectedIds}
          pendingRequests={pendingRequests ?? []}
          onGoToRequests={() => { onTabChange('goals'); setGoalsJumpKey(k => k + 1); }}
        />
      )}

      {/* GOALS TAB */}
      {activeTab === 'goals' && (
        <GoalsTab
          group={group}
          goals={goals}
          players={players}
          groupId={groupId}
          onRefresh={onRefresh}
          onToast={onToast}
          canWrite={canWrite}
          myRsn={myRsn}
          jumpToActiveKey={goalsJumpKey}
          selectedPlayerId={selectedPlayerId}
        />
      )}

      {/* VAULT TAB */}
      {activeTab === 'vault' && (
        players.length > 0
          ? <VaultTab players={players} groupId={groupId} goals={goals} onToast={onToast} canWrite={canWrite} myRsn={myRsn} selectedPlayerId={selectedPlayerId} />
          : <div className="empty-state">
              <div className="icon">🏆</div>
              <p>Add players first to use the vault.</p>
            </div>
      )}

      {/* ACHIEVEMENTS TAB */}
      {activeTab === 'achievements' && (
        <QuestsAreaTab
          players={players}
          selectedPlayerId={selectedPlayerId}
          groupId={groupId}
          canWrite={canWrite}
          onToast={onToast}
        />
      )}

      {/* LEADERBOARDS TAB */}
      {activeTab === 'leaderboards' && (
        <LeaderboardsTab players={players} selectedPlayerId={selectedPlayerId} groupId={groupId} canWrite={canWrite} onToast={onToast} />
      )}

      </div>{/* end tab content */}

      {/* Per-tab tour overlay */}
      {tabTour && (
        <TourOverlay
          key={tabTour}
          steps={TAB_TOURS[tabTour]}
          onComplete={() => completeTour(tabTour)}
        />
      )}
    </div>
  );
}
