import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useConfig } from './PreviewBanner';

// The group's own settings, in the Plugin window. They appear once the group is claimed and at least one member's plugin
// is connected (that is when they matter: they decide what the plugin's data shows). Saved at once, one setting at a time.

const gp = n => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n));
const DROP_STEPS = [[0, 'Every drop'], [50_000, '50K'], [100_000, '100K'], [250_000, '250K'], [500_000, '500K'], [1_000_000, '1M'], [2_500_000, '2.5M'], [5_000_000, '5M'], [10_000_000, '10M']];
const XP_STEPS = [[0, 'Every drop'], [100, '100 xp'], [500, '500 xp'], [1000, '1,000 xp'], [5000, '5,000 xp'], [10000, '10,000 xp']];
const JOURNAL_STEPS = [[0, 'Every entry'], [10_000, '10K'], [100_000, '100K'], [500_000, '500K'], [1_000_000, '1M'], [5_000_000, '5M']];
const BOSS_STEPS = [[0, 'Every boss'], [5, '5 kills'], [10, '10 kills'], [25, '25 kills'], [50, '50 kills'], [100, '100 kills']];
const ONLINE_STEPS = [[2, '2 minutes'], [3, '3 minutes'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes']];
const TIERS = ['easy', 'medium', 'hard', 'elite', 'master'];

function Row({ title, children, control }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-panel-alt)' }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--text-bright)' }}>{title}</strong><br />{children}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function Pick({ value, steps, onChange, unit = '' }) {
  return (
    <select className="form-input" value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: 120 }}>
      {!steps.some(s => s[0] === value) && <option value={value}>{value.toLocaleString()}{unit}</option>}
      {steps.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

export default function GroupSettings({ group, onChanged, onToast, onOpenWebhook }) {
  const config = useConfig();
  const defaultMin = config?.drop_default_min ?? 100_000;
  const [connected, setConnected] = useState(null);                 // null = not known yet
  const [dropMin, setDropMin] = useState(group?.drop_min_value ?? defaultMin);
  const [s, setS] = useState(group?.settings || {});
  useEffect(() => { setDropMin(group?.drop_min_value ?? defaultMin); }, [group?.drop_min_value, defaultMin]);
  useEffect(() => { setS(group?.settings || {}); }, [group?.settings]);

  useEffect(() => {
    if (!group?.id) return;
    api.getPluginState(group.id, { include: '' }).then(r => setConnected(Array.isArray(r) && r.some(p => p.has_token))).catch(() => setConnected(false));
  }, [group?.id]);

  async function save(patch, message) {
    const prev = s;
    setS({ ...s, ...patch });
    try { const r = await api.setSettings(group.id, patch); setS(r.settings); onToast?.(message, 'success'); onChanged?.(); }
    catch (e) { setS(prev); onToast?.(e.message, 'error'); }
  }
  async function saveDropMin(v) {
    const prev = dropMin;
    setDropMin(v);
    try { await api.setDropMin(group.id, v); onToast?.('Drops now show from ' + (v === 0 ? 'every drop' : gp(v)), 'success'); onChanged?.(); }
    catch (e) { setDropMin(prev); onToast?.(e.message, 'error'); }
  }

  if (connected === null || !s.clue_tiers) return null;
  const head = <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Group settings</div>;
  if (!connected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {head}
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Settings for what the plugin's data shows appear here once a member's plugin is connected.</div>
      </div>
    );
  }
  const toggleTier = t => {
    const next = s.clue_tiers.includes(t) ? s.clue_tiers.filter(x => x !== t) : [...s.clue_tiers, t];
    save({ clue_tiers: TIERS.filter(x => next.includes(x)) }, 'Clue log tiers saved');
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {head}
      <Row title="Smallest drop to show" control={<Pick value={dropMin} steps={DROP_STEPS} unit=" gp" onChange={saveDropMin} />}>
        Drops worth less than this (quantity times value) stay out of the Drops list and Discord. Drops of unknown value are always shown.
        The plugin picks the new value up the next time it starts.
      </Row>
      <Row title="Live XP: smallest drop" control={<Pick value={s.xp_min} steps={XP_STEPS} unit=" xp" onChange={v => save({ xp_min: v }, 'Live XP minimum saved')} />}>
        Smaller XP drops stay out of the Live XP panel and the numbers floating over the player cards.
      </Row>
      <Row title="Bank Journal: smallest entry" control={<Pick value={s.journal_min} steps={JOURNAL_STEPS} unit=" gp" onChange={v => save({ journal_min: v }, 'Bank Journal minimum saved')} />}>
        Deposits and withdrawals worth less than this (quantity times value) are not listed. Entries of unknown value are always listed.
      </Row>
      <Row title="Boss log: hide bosses with few kills" control={<Pick value={s.boss_min_kills} steps={BOSS_STEPS} unit=" kills" onChange={v => save({ boss_min_kills: v }, 'Boss log saved')} />}>
        A boss appears in the boss log once the member has killed it this many times.
      </Row>
      <Row title="Clue log: tiers to show"
        control={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', maxWidth: 200 }}>
            {TIERS.map(t => (
              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text)', cursor: 'pointer', textTransform: 'capitalize' }}>
                <input type="checkbox" checked={s.clue_tiers.includes(t)} onChange={() => toggleTier(t)} />{t}
              </label>
            ))}
          </div>
        }>
        Pick the clue scroll tiers that appear in the clue log.
      </Row>
      <Row title="Counts as online for" control={<Pick value={s.online_minutes} steps={ONLINE_STEPS} unit=" minutes" onChange={v => save({ online_minutes: v }, 'Online time saved')} />}>
        A member shows as online this long after their plugin last sent an update.
      </Row>
      <Row title="Hide from Find groups"
        control={<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!s.unlisted} onChange={e => save({ unlisted: e.target.checked }, e.target.checked ? 'The group is hidden from Find groups' : 'The group can be found again')} />Hidden
        </label>}>
        Nobody finds the group by browsing or searching. Members still open it from their saved groups, and anyone with the link can look at its public data.
      </Row>
      {onOpenWebhook && (
        <Row title="Discord notifications" control={<button className="btn btn-ghost btn-sm" onClick={onOpenWebhook}>Open</button>}>
          Send group events (drops, level-ups and more) to a Discord channel, and choose which ones.
        </Row>
      )}
    </div>
  );
}
