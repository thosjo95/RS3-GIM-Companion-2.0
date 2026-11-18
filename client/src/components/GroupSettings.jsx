import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useConfig } from './PreviewBanner';

// The group's own settings, in the Plugin window. They appear once the group is claimed and at least one member's plugin
// is connected (that is when they matter: they decide what the plugin's data shows).

// The smallest drop (total gp) to show in the group's Drops. The plugin reads the value too, when it starts.
const DROP_STEPS = [[0, 'Every drop'], [50_000, '50K'], [100_000, '100K'], [250_000, '250K'], [500_000, '500K'], [1_000_000, '1M'], [2_500_000, '2.5M'], [5_000_000, '5M'], [10_000_000, '10M']];

function Row({ title, children, select }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-panel-alt)' }}>
      <div style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--text-bright)' }}>{title}</strong><br />{children}
      </div>
      {select}
    </div>
  );
}

export default function GroupSettings({ group, onChanged, onToast }) {
  const config = useConfig();
  const defaultMin = config?.drop_default_min ?? 100_000;
  const [connected, setConnected] = useState(null);                 // null = not known yet
  const [dropMin, setDropMin] = useState(group?.drop_min_value ?? defaultMin);
  useEffect(() => { setDropMin(group?.drop_min_value ?? defaultMin); }, [group?.drop_min_value, defaultMin]);

  useEffect(() => {
    if (!group?.id) return;
    api.getPluginState(group.id, { include: '' }).then(s => setConnected(Array.isArray(s) && s.some(p => p.has_token))).catch(() => setConnected(false));
  }, [group?.id]);

  async function saveDropMin(v) {
    const prev = dropMin;
    setDropMin(v);
    try {
      await api.setDropMin(group.id, v);
      onToast?.('Drops now show from ' + (v === 0 ? 'every drop' : DROP_STEPS.find(s => s[0] === v)?.[1] ?? v.toLocaleString() + ' gp'), 'success');
      onChanged?.();
    } catch (e) { setDropMin(prev); onToast?.(e.message, 'error'); }
  }

  if (connected === null) return null;
  const head = <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Group settings</div>;
  if (!connected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {head}
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Settings for what the plugin's data shows appear here once a member's plugin is connected.</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {head}
      <Row title="Smallest drop to show"
        select={
          <select className="form-input" value={dropMin} onChange={e => saveDropMin(Number(e.target.value))} style={{ width: 120 }}>
            {!DROP_STEPS.some(s => s[0] === dropMin) && <option value={dropMin}>{dropMin.toLocaleString()} gp</option>}
            {DROP_STEPS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        }>
        Drops worth less than this (quantity times value) stay out of the Drops list and Discord. Drops of unknown value are always shown.
        The plugin picks the new value up the next time it starts.
      </Row>
    </div>
  );
}
