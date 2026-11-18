import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { MEMBER_COLORS, SKILLS, SKILL_ICON_URLS, fmtXp } from '../lib/rs3';
import RsIcon from './RsIcon';

// The group's own leaderboard on the front page: the default boards (day / week / month) and the competitions the
// group sets up itself (what to track, when it starts and ends, an optional goal).

const PERIODS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const METRIC_LABEL = { xp: 'XP gained', quest_points: 'Quest points', boss_kills: 'Boss kills', slayer_kills: 'Slayer kills', total_level: 'Levels gained', drops: 'Drops' };
const fmt = (n, metric) => (n == null ? '—' : metric === 'xp' ? (n >= 100_000 ? fmtXp(n) : n.toLocaleString()) : n.toLocaleString());
const fmtDate = iso => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ── Start times for the presets ───────────────────────────────────────────────
function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const local = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const PRESETS = () => {
  const mon = mondayOf(new Date());
  const month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  return [
    { label: 'Most XP this week',          title: 'Most XP this week',          metric: 'xp', target: 'Overall', starts: mon, ends: addDays(mon, 7) },
    { label: 'Most quest points this week', title: 'Most quest points this week', metric: 'quest_points', starts: mon, ends: addDays(mon, 7) },
    { label: 'Most boss kills this week',   title: 'Most boss kills this week',   metric: 'boss_kills', target: 'all', starts: mon, ends: addDays(mon, 7) },
    { label: 'First to 50 kills of a boss', title: 'First to 50 kills',           metric: 'boss_kills', target: '', goal: 50, starts: new Date(), ends: null, pickBoss: true },
    { label: 'Most slayer kills this month', title: 'Most slayer kills this month', metric: 'slayer_kills', starts: month, ends: nextMonth },
    { label: 'Most levels this month',      title: 'Most levels this month',      metric: 'total_level', starts: month, ends: nextMonth },
    { label: 'First to 10M XP in a skill',  title: 'First to 10M XP',             metric: 'xp', target: 'Mining', goal: 10_000_000, starts: new Date(), ends: null },
  ];
};

// ── Ranking rows ──────────────────────────────────────────────────────────────
function Ranking({ rows, metric, colorOf, goal }) {
  const top = Math.max(goal ?? 0, ...rows.map(r => r.value ?? 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r, i) => {
        const done = goal != null && r.value != null && r.value >= goal;
        return (
          <div key={r.player_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 18, textAlign: 'center', fontWeight: 700, color: i === 0 && (r.value ?? 0) > 0 ? 'var(--gold)' : 'var(--text-dim)' }}>{i + 1}</span>
            <span style={{ width: 100, flexShrink: 0, fontWeight: 600, color: colorOf(r.player_id), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rsn}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-root)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, ((r.value ?? 0) / top) * 100)}%`, height: '100%', background: done ? '#4caf50' : colorOf(r.player_id), opacity: 0.9, transition: 'width 0.4s' }} />
            </div>
            <span style={{ minWidth: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: done ? '#4caf50' : (r.value ?? 0) > 0 ? 'var(--text-bright)' : 'var(--text-dim)', fontWeight: 700 }}>
              {fmt(r.value, metric)}{goal != null ? ` / ${fmt(goal, metric)}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Competition form ──────────────────────────────────────────────────────────
function CompetitionModal({ groupId, initial, bosses, onClose, onSaved, onToast }) {
  const presets = useMemo(PRESETS, []);
  const [f, setF] = useState(() => initial ?? { title: '', metric: 'xp', target: 'Overall', goal: '', starts_at: local(mondayOf(new Date())), ends_at: local(addDays(mondayOf(new Date()), 7)) });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const applyPreset = p => setF({ title: p.title, metric: p.metric, target: p.target ?? '', goal: p.goal ?? '', starts_at: local(p.starts), ends_at: p.ends ? local(p.ends) : '' });

  async function save() {
    setBusy(true);
    try {
      const body = { group_id: groupId, title: f.title, metric: f.metric, target: f.target || null, goal: f.goal === '' ? null : Number(f.goal),
        starts_at: new Date(f.starts_at).toISOString(), ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : null };
      if (initial?.id) await api.updateCompetition(initial.id, body); else await api.createCompetition(body);
      onSaved(); onClose();
    } catch (e) { onToast?.(e.message, 'error'); } finally { setBusy(false); }
  }

  const input = { width: '100%' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 15, color: 'var(--gold)', flex: 1 }}>{initial?.id ? 'Edit competition' : 'New competition'}</strong>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        {!initial?.id && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Start from a ready-made one (everything stays editable):</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {presets.map(p => <button key={p.label} type="button" className="chip" onClick={() => applyPreset(p)}>{p.label}</button>)}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12 }}>Name
            <input className="form-input" style={input} value={f.title} onChange={e => set('title', e.target.value)} placeholder="Most XP this week" maxLength={80} />
          </label>
          <label style={{ fontSize: 12 }}>What is tracked
            <select className="form-select" style={input} value={f.metric} onChange={e => setF(x => ({ ...x, metric: e.target.value, target: e.target.value === 'xp' ? 'Overall' : e.target.value === 'boss_kills' ? 'all' : '' }))}>
              {Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {f.metric === 'xp' && (
            <label style={{ fontSize: 12 }}>Skill
              <select className="form-select" style={input} value={f.target || 'Overall'} onChange={e => set('target', e.target.value)}>
                <option value="Overall">All skills (total XP)</option>
                {SKILLS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          {f.metric === 'boss_kills' && (
            <label style={{ fontSize: 12 }}>Boss
              <select className="form-select" style={input} value={f.target || 'all'} onChange={e => set('target', e.target.value)}>
                <option value="all">All bosses</option>
                {bosses.map(b => <option key={b.key} value={b.key}>{b.name}</option>)}
              </select>
              {bosses.length === 0 && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Individual bosses appear once the plugin has reported them (unlock the group).</span>}
            </label>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ fontSize: 12, flex: 1 }}>Starts
              <input type="datetime-local" className="form-input" style={input} value={f.starts_at} onChange={e => set('starts_at', e.target.value)} />
            </label>
            <label style={{ fontSize: 12, flex: 1 }}>Ends <span style={{ color: 'var(--text-dim)' }}>(optional)</span>
              <input type="datetime-local" className="form-input" style={input} value={f.ends_at ?? ''} onChange={e => set('ends_at', e.target.value)} />
            </label>
          </div>
          <label style={{ fontSize: 12 }}>Goal <span style={{ color: 'var(--text-dim)' }}>(optional, e.g. first to reach 50)</span>
            <input type="number" min="1" className="form-input" style={input} value={f.goal ?? ''} onChange={e => set('goal', e.target.value)} />
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Progress is counted from the start time using what the app has recorded. Numbers from before the app first saw a player cannot be counted.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !f.title.trim()}>{initial?.id ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

// ── The leaderboard ───────────────────────────────────────────────────────────
export default function GroupLeaderboard({ players, groupId, canWrite, onToast }) {
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [boardId, setBoardId] = useState('xp');
  const [comps, setComps] = useState([]);
  const [bosses, setBosses] = useState([]);
  const [modal, setModal] = useState(null);                 // null | {} (new) | competition (edit)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('gim_leaderboard_collapsed') !== '0'; } catch { return true; } });
  const toggleCollapsed = () => setCollapsed(v => { try { localStorage.setItem('gim_leaderboard_collapsed', v ? '0' : '1'); } catch { /* not saved */ } return !v; });
  const colorOf = id => MEMBER_COLORS[Math.max(0, players.findIndex(p => p.id === id)) % MEMBER_COLORS.length];

  const load = useCallback(() => {
    if (!groupId) return;
    api.getGroupLeaderboard(groupId, period).then(setData).catch(() => setData(null));
    api.getCompetitions(groupId).then(r => setComps(Array.isArray(r) ? r : [])).catch(() => setComps([]));
  }, [groupId, period, canWrite]);
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (groupId) api.getCompetitionOptions(groupId).then(r => setBosses(r?.bosses ?? [])).catch(() => {}); }, [groupId, canWrite]);

  if (!players.length) return null;
  const board = data?.boards?.find(b => b.id === boardId) ?? data?.boards?.[0];
  const pill = active => ({ fontSize: 11, padding: '3px 12px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer', background: active ? 'var(--gold)' : 'transparent', color: active ? '#111' : 'var(--text-dim)', fontWeight: active ? 700 : 400 });

  async function remove(c) {
    if (!window.confirm(`Delete the competition "${c.title}"?`)) return;
    try { await api.deleteCompetition(c.id); load(); } catch (e) { onToast?.(e.message, 'error'); }
  }
  const targetName = c => (c.metric === 'xp' ? (c.target && c.target !== 'Overall' ? c.target : 'all skills') : c.metric === 'boss_kills' && c.target && c.target !== 'all' ? (bosses.find(b => b.key === c.target)?.name ?? 'one boss') : '');

  return (
    <div className="panel" data-tour="group-leaderboard" style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
      <div className="panel-header" onClick={toggleCollapsed} title={collapsed ? 'Show the leaderboard' : 'Collapse'} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer', padding: '8px 14px' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 11, width: 12 }}>{collapsed ? '▸' : '▾'}</span>
        <span className="panel-title" style={{ flex: 1 }}>Group Leaderboard</span>
        {!collapsed && (
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 2, background: 'var(--bg-panel-alt)', borderRadius: 'var(--radius)', padding: 3 }}>
            {PERIODS.map(([id, label]) => <button key={id} style={pill(period === id)} onClick={() => setPeriod(id)}>{label}</button>)}
          </div>
        )}
      </div>
      {!collapsed && <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 14px' }}>
        {/* default boards */}
        <div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {(data?.boards ?? []).map(b => <button key={b.id} className={`chip${board?.id === b.id ? ' active' : ''}`} onClick={() => setBoardId(b.id)}>{b.title}</button>)}
          </div>
          {!data && <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Loading…</div>}
          {board?.locked && <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>These numbers come from the plugin: unlock the group to see them.</div>}
          {board && !board.locked && <Ranking rows={board.rows} metric={board.metric} colorOf={colorOf} />}
          {board && !board.locked && <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8 }}>Last {period === 'day' ? '24 hours' : period === 'week' ? '7 days' : '30 days'} · counted from what the app has recorded</div>}
        </div>

        {/* competitions */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>Competitions</span>
            {canWrite
              ? <button className="btn btn-primary btn-sm" onClick={() => setModal({})}>+ New competition</button>
              : <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>🔒 Unlock to create</span>}
          </div>
          {comps.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: '4px 0 2px' }}>No competitions yet. Create one to race for the most XP, quest points, boss kills and more.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {comps.map(c => (
              <div key={c.id} style={{ padding: '12px 14px', background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {c.metric === 'xp' && c.target && SKILL_ICON_URLS[c.target] && <img src={SKILL_ICON_URLS[c.target]} alt="" width={18} height={18} />}
                  <strong style={{ fontSize: 13, color: 'var(--text-bright)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</strong>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: c.status === 'live' ? 'rgba(76,175,80,0.18)' : c.status === 'upcoming' ? 'rgba(200,168,75,0.18)' : 'var(--bg-root)', color: c.status === 'live' ? '#4caf50' : c.status === 'upcoming' ? 'var(--gold)' : 'var(--text-dim)' }}>
                    {c.status === 'live' ? 'Live' : c.status === 'upcoming' ? 'Starts soon' : 'Ended'}
                  </span>
                  {canWrite && <button title="Edit" onClick={() => setModal({ ...c, starts_at: local(new Date(c.starts_at)), ends_at: c.ends_at ? local(new Date(c.ends_at)) : '', goal: c.goal ?? '' })} style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}>✎</button>}
                  {canWrite && <button title="Delete" onClick={() => remove(c)} style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer' }}>✕</button>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>
                  {METRIC_LABEL[c.metric]}{targetName(c) ? ` · ${targetName(c)}` : ''} · {fmtDate(c.starts_at)}{c.ends_at ? ` → ${fmtDate(c.ends_at)}` : ''}{c.goal ? ` · first to ${c.goal.toLocaleString()}` : ''}
                </div>
                {c.locked ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Unlock the group to see the standings.</div>
                  : c.status === 'upcoming' ? <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Not started yet.</div>
                  : <Ranking rows={c.rows} metric={c.metric} colorOf={colorOf} goal={c.goal} />}
              </div>
            ))}
          </div>
        </div>
      </div>}

      {modal && <CompetitionModal groupId={groupId} initial={modal.id ? modal : null} bosses={bosses} onClose={() => setModal(null)} onSaved={load} onToast={onToast} />}
    </div>
  );
}
