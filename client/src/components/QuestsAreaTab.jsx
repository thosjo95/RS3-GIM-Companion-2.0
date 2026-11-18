import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { MEMBER_COLORS } from '../lib/rs3';
import { mergeQuests, masterQuestList, questCounts, questKey } from '../lib/questData';
import { DiffBadge, QuestStatusIcon } from './overview/QuestTables';
import AchievementsTab, { areaTaskTotals } from './AchievementsTab';
import { IconLabel } from './RsIcon';
import JourneyPanel, { JOURNEY_CATEGORY } from './JourneyPanel';

// One page for everything a group "completes": quests and area tasks (diaries).
//
//   ┌ summary tiles ─────────────────────────────────────────────┐
//   ├ per-player progress cards (quests + area tasks, side by side)┤
//   ├ [ 📜 Quests | 🗺️ Area Tasks ]                                 ┤
//   └ the detailed grid for the chosen section                     ┘
//
// The player cards at the top of the whole dashboard are the player filter (`selectedPlayerId`).

function Meter({ value, total, color, label, detail }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: 10, fontWeight: 600 }}>{label}</span>
        <span style={{ color: 'var(--text)' }}>
          <strong style={{ color: 'var(--text-bright)' }}>{value}</strong>
          <span style={{ color: 'var(--text-dim)' }}> / {total}</span>
          {detail && <span style={{ color: 'var(--gold)', marginLeft: 8 }}>{detail}</span>}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-root)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

function SummaryTile({ label, value, sub }) {
  return (
    <div className="stat-box">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function pill(active) {
  return {
    fontSize: 12, padding: '5px 14px', borderRadius: 'var(--radius)', cursor: 'pointer', border: 'none',
    background: active ? 'var(--gold)' : 'transparent', color: active ? '#111' : 'var(--text-dim)', fontWeight: active ? 700 : 500,
  };
}
const chip = active => ({
  fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius)', cursor: 'pointer',
  border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
  background: active ? 'rgba(200,168,75,0.15)' : 'transparent', color: active ? 'var(--gold)' : 'var(--text-dim)',
});

// ── Quests grid: one row per quest, one column per player ─────────────────────

const DIFFS = [['', 'All'], ['0', 'Novice'], ['1', 'Intermediate'], ['2', 'Experienced'], ['3', 'Master'], ['4', 'Grandmaster']];

function QuestGrid({ players, colorMap, questData }) {
  const [search, setSearch] = useState('');
  const [diff, setDiff] = useState('');
  const [status, setStatus] = useState('todo');
  const [access, setAccess] = useState('all'); // all | f2p | members (only when the plugin reported it)

  const withData = players.filter(p => (questData.get(p.id)?.list.length ?? 0) > 0);
  const master = useMemo(() => masterQuestList(questData, withData.map(p => p.id)), [questData, withData.length, players]);  // eslint-disable-line react-hooks/exhaustive-deps
  const maps = useMemo(() => Object.fromEntries(withData.map(p => [p.id, new Map(questData.get(p.id).list.map(q => [questKey(q.title), q]))])), [questData, players]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasAccessInfo = master.some(q => q.members !== null && q.members !== undefined);
  const statusOf = (p, q) => maps[p.id].get(questKey(q.title))?.status ?? 'NOT_STARTED';

  const rows = useMemo(() => master.filter(q => {
    if (search.trim() && !q.title.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (diff !== '' && q.difficulty !== Number(diff)) return false;
    if (access === 'f2p' && q.members !== false) return false;
    if (access === 'members' && q.members !== true) return false;
    if (status === 'todo') return withData.some(p => statusOf(p, q) !== 'COMPLETED');
    if (status === 'done') return withData.length > 0 && withData.every(p => statusOf(p, q) === 'COMPLETED');
    if (status === 'started') return withData.some(p => statusOf(p, q) === 'STARTED');
    return true;
  }), [master, search, diff, status, access, maps]); // eslint-disable-line react-hooks/exhaustive-deps

  if (withData.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon">📜</div>
        <p>No quest data yet.</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Connect the in-game plugin, or sync the players so their quests are fetched from the Adventurer's Log.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quests…"
          style={{ flex: '1 1 160px', maxWidth: 240, fontSize: 12, height: 30 }} />
        {[['todo', 'Not all done'], ['started', 'In progress'], ['done', 'Group complete'], ['all', 'All quests']].map(([v, l]) =>
          <button key={v} style={chip(status === v)} onClick={() => setStatus(v)}>{l}</button>)}
        {hasAccessInfo && [['all', 'F2P + Members'], ['f2p', 'F2P'], ['members', 'Members']].map(([v, l]) =>
          <button key={v} style={chip(access === v)} onClick={() => setAccess(v)}>{l}</button>)}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>{rows.length} quests</span>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
        {DIFFS.map(([v, l]) => <button key={v} style={chip(diff === v)} onClick={() => setDiff(v)}>{l}</button>)}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--bg-panel-alt)' }}>
              <th align="left" style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', position: 'sticky', left: 0, background: 'var(--bg-panel-alt)', zIndex: 3, minWidth: 220 }}>Quest</th>
              <th align="center" style={{ padding: '8px 6px', fontSize: 10, textTransform: 'uppercase', color: 'var(--text-dim)' }}>QP</th>
              {withData.map(p => {
                const c = questCounts(questData.get(p.id).list);
                return (
                  <th key={p.id} align="center" style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    <div style={{ color: colorMap[p.id], fontSize: 11, fontWeight: 700 }}>{p.rsn}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 400 }}>{c.done} / {master.length}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((q, i) => {
              const bg = i % 2 ? 'rgba(255,255,255,0.018)' : 'transparent';
              return (
                <tr key={questKey(q.title)} style={{ borderTop: '1px solid var(--border)', background: bg }}>
                  <td style={{ padding: '6px 10px', position: 'sticky', left: 0, background: bg === 'transparent' ? 'var(--bg-panel)' : 'var(--bg-panel-alt)', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {q.difficulty !== undefined ? <DiffBadge difficulty={q.difficulty} /> : <span style={{ width: 8 }} />}
                      <a href={`https://runescape.wiki/w/${encodeURIComponent(q.title.replace(/ /g, '_'))}`} target="_blank" rel="noreferrer"
                        style={{ color: 'var(--text)', textDecoration: 'none' }}>{q.title}</a>
                      {q.members === false && <span title="Free-to-play" style={{ fontSize: 9, color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px' }}>F2P</span>}
                    </div>
                  </td>
                  <td align="center" style={{ color: 'var(--gold)', fontWeight: 600 }}>{q.questPoints || ''}</td>
                  {withData.map(p => <td key={p.id} align="center" style={{ padding: '6px 12px' }}><QuestStatusIcon status={statusOf(p, q)} /></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No quests match these filters.</div>}
    </div>
  );
}

// ── Achievements: everything the plugin has seen completed ───────────────────

// Category numbers come from the game. These three are confirmed from real data (quest names, "<Region> Set Tasks - <Tier>",
// "Journey Tier N"); the rest are shown by number until they are identified.
const CATEGORY_NAMES = { 4746: 'Quests', 4766: 'Area Tasks', 5483: 'Group Ironman Journey' };
const categoryLabel = c => CATEGORY_NAMES[c] ?? `Category ${c ?? '?'}`;

function AchievementList({ rows, colorMap, players }) {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [members, setMembers] = useState('all');
  const rsnOf = id => players.find(p => p.id === id)?.rsn ?? '?';

  const recent = useMemo(() => rows.filter(r => r.completed_at)
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 8), [rows]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const g = m.get(r.achievement_id) ?? { id: r.achievement_id, name: r.name, category: r.category, members: r.members, score: r.rune_score, who: [] };
      g.who.push(r.player_id);
      m.set(r.achievement_id, g);
    }
    return [...m.values()];
  }, [rows]);

  const categories = useMemo(() => {
    const c = new Map();
    for (const g of grouped) c.set(g.category, (c.get(g.category) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [grouped]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return grouped
      .filter(g => (!q || g.name.toLowerCase().includes(q)) && (cat === 'all' || String(g.category) === cat)
        && (members === 'all' || (members === 'f2p' ? g.members === 0 : g.members === 1)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [grouped, search, cat, members]);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon">🏅</div>
        <p>No achievements reported yet.</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>They appear once a member's in-game plugin has finished its first achievement scan (a minute or two after logging in).</p>
      </div>
    );
  }

  return (
    <div>
      {recent.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)', fontWeight: 600, marginBottom: 6 }}>Recently completed</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recent.map(r => (
              <div key={r.player_id + ':' + r.achievement_id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
                <strong style={{ color: colorMap[r.player_id] }}>{r.rsn}</strong>
                <span style={{ color: 'var(--text)' }}>completed {r.name}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 11 }}>{new Date(r.completed_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search achievements…" style={{ flex: '1 1 160px', maxWidth: 260, fontSize: 12, height: 30 }} />
        {[['all', 'F2P + Members'], ['f2p', 'F2P'], ['mem', 'Members']].map(([v, l]) => <button key={v} style={chip(members === v)} onClick={() => setMembers(v)}>{l}</button>)}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>{list.length} of {grouped.length}</span>
      </div>
      {categories.length > 1 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
          <button style={chip(cat === 'all')} onClick={() => setCat('all')}>All categories</button>
          {categories.map(([c, n]) => <button key={c} style={chip(cat === String(c))} onClick={() => setCat(String(c))}>{categoryLabel(c)} · {n}</button>)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
        {list.slice(0, 300).map(g => (
          <div key={g.id} style={{ padding: '8px 10px', background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: 'var(--text-bright)', flex: 1 }}>{g.name}</span>
              {g.score > 0 && <span title="RuneScore" style={{ fontSize: 10, color: 'var(--gold)' }}>{g.score} RS</span>}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', fontSize: 10 }}>
              {g.who.map(id => <span key={id} style={{ color: colorMap[id], border: `1px solid ${colorMap[id]}55`, borderRadius: 8, padding: '0 6px' }}>{rsnOf(id)}</span>)}
              {g.members === 0 && <span style={{ color: 'var(--text-dim)' }}>F2P</span>}
            </div>
          </div>
        ))}
      </div>
      {list.length > 300 && <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>Showing the first 300 — narrow the search to see the rest.</div>}
      {list.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No achievements match these filters.</div>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function QuestsAreaTab({ players, groupId, canWrite, onToast, selectedPlayerId = null }) {
  const [section, setSection] = useState('quests');
  const [pluginQuests, setPluginQuests] = useState([]);
  const [pluginAchs, setPluginAchs] = useState([]);
  const [achievements, setAchievements] = useState([]);

  const visible = selectedPlayerId != null ? players.filter(p => p.id === selectedPlayerId) : players;
  const colorMap = useMemo(() => Object.fromEntries(players.map((p, i) => [p.id, MEMBER_COLORS[i % MEMBER_COLORS.length]])), [players]);

  // Live quest data is private to the group (needs the unlocked group); without it we simply use the Adventurer's Log.
  useEffect(() => {
    if (!canWrite || !groupId) { setPluginQuests([]); setPluginAchs([]); return; }
    let alive = true;
    const load = () => {
      api.getPluginQuests(groupId).then(r => { if (alive) setPluginQuests(r); }).catch(() => {});
      api.getPluginAchievements(groupId).then(r => { if (alive) setPluginAchs(r); }).catch(() => {});
    };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [groupId, canWrite]);

  useEffect(() => {
    if (!groupId) return;
    api.getAchievements(groupId).then(setAchievements).catch(() => {});
  }, [groupId]);

  const visibleIds = useMemo(() => new Set(visible.map(p => p.id)), [visible]);
  const achRows = useMemo(() => pluginAchs.filter(r => visibleIds.has(r.player_id) && r.completed !== 0), [pluginAchs, visibleIds]);
  const journeyRows = useMemo(() => pluginAchs.filter(r => visibleIds.has(r.player_id) && r.category === JOURNEY_CATEGORY), [pluginAchs, visibleIds]);
  const questData = useMemo(() => mergeQuests(players, pluginQuests), [players, pluginQuests]);
  const master = useMemo(() => masterQuestList(questData, visible.map(p => p.id)), [questData, visible]);  // eslint-disable-line react-hooks/exhaustive-deps
  const area = useMemo(() => areaTaskTotals(players, achievements), [players, achievements]);

  const rows = visible.map(p => {
    const q = questCounts(questData.get(p.id)?.list ?? []);
    return { p, q, live: questData.get(p.id)?.live, a: area.get(p.id) ?? { done: 0, total: 0 } };
  });
  const withQuests = rows.filter(r => (questData.get(r.p.id)?.list.length ?? 0) > 0);
  const avgQuest = withQuests.length && master.length ? Math.round(withQuests.reduce((n, r) => n + r.q.done / master.length, 0) / withQuests.length * 100) : null;
  const avgArea = rows.length && rows[0].a.total ? Math.round(rows.reduce((n, r) => n + r.a.done / r.a.total, 0) / rows.length * 100) : null;
  const groupComplete = withQuests.length > 1
    ? master.filter(q => withQuests.every(r => questData.get(r.p.id).list.find(x => questKey(x.title) === questKey(q.title))?.status === 'COMPLETED')).length
    : null;

  if (players.length === 0) {
    return <div className="empty-state"><div className="icon">📜</div><p>Add and sync players to track quests and area tasks.</p></div>;
  }

  const single = visible.length === 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Summary tiles */}
      <div className="grid-4">
        <SummaryTile label={single ? 'Quests completed' : 'Avg. quests completed'} value={avgQuest != null ? `${avgQuest}%` : '—'}
          sub={single && withQuests[0] ? `${withQuests[0].q.done} of ${master.length}` : `${master.length} quests tracked`} />
        <SummaryTile label="Quest points" value={single ? (rows[0].q.qp || '—') : rows.reduce((n, r) => n + r.q.qp, 0) || '—'}
          sub={single ? 'earned' : 'group total'} />
        <SummaryTile label={single ? 'Area tasks completed' : 'Avg. area tasks completed'} value={avgArea != null ? `${avgArea}%` : '—'}
          sub={single ? `${rows[0].a.done} of ${rows[0].a.total}` : 'across all regions'} />
        <SummaryTile label="Completed by everyone" value={groupComplete ?? '—'} sub={groupComplete == null ? 'needs 2+ players' : 'quests the whole group has done'} />
      </div>

      {/* Per-player progress */}
      <div data-tour="achievements-progress" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {rows.map(({ p, q, a, live }) => (
          <div key={p.id} style={{ padding: '12px 14px', background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderLeft: `3px solid ${colorMap[p.id]}`, borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ color: colorMap[p.id], fontSize: 13 }}>{p.rsn}</strong>
              {live && <span title="Quest progress read straight from the game by the plugin" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--green-bright)', border: '1px solid var(--green)', borderRadius: 3, padding: '0 5px' }}>LIVE</span>}
            </div>
            <Meter label="Quests" value={q.done} total={master.length} color={colorMap[p.id]} detail={q.qp ? `${q.qp} QP` : null} />
            <Meter label="Area tasks" value={a.done} total={a.total} color={colorMap[p.id]} />
          </div>
        ))}
      </div>

      {/* The quest / area task / achievement lists, with the Group Ironman Journey right beside them at the same height */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 560px', minWidth: 0, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 18px' }}>
        <div data-tour="achievements-view" style={{ display: 'inline-flex', gap: 3, background: 'var(--bg-root)', borderRadius: 'var(--radius)', padding: 3, marginBottom: 16 }}>
          <button style={pill(section === 'quests')} onClick={() => setSection('quests')}><IconLabel name="quests" fallback="📜" size={16}>Quests</IconLabel></button>
          <button style={pill(section === 'area')} onClick={() => setSection('area')}><IconLabel name="areaTasks" fallback="🗺️" size={16}>Area Tasks</IconLabel></button>
          <button style={pill(section === 'achievements')} onClick={() => setSection('achievements')}><IconLabel name="achievements" fallback="🏅" size={16}>Achievements{achRows.length ? ` · ${new Set(achRows.map(r => r.achievement_id)).size}` : ''}</IconLabel></button>
        </div>

        {section === 'quests' && <QuestGrid players={visible} colorMap={colorMap} questData={questData} />}
        {section === 'area' && <AchievementsTab embedded players={visible} groupId={groupId} canWrite={canWrite} onToast={onToast} onLoaded={setAchievements} />}
        {section === 'achievements' && <AchievementList rows={achRows} colorMap={colorMap} players={players} />}
      </div>

      {/* Always visible, whichever section is open */}
      <aside style={{ flex: '0 1 360px', minWidth: 280, maxWidth: '100%', position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }}>
        <JourneyPanel rows={journeyRows} players={visible} colorMap={colorMap} />
      </aside>
      </div>
    </div>
  );
}
