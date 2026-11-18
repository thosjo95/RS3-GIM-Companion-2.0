import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { MEMBER_COLORS, fmtNum } from '../lib/rs3';

// GIM 2.0 — live group items, bank ledger and plugin setup.
// All data is pushed by the in-game RS3 plugin (see /plugin) and is private to the group.

const SOURCES = [
  { id: 'all',       label: 'All' },
  { id: 'bank',      label: 'Bank' },
  { id: 'inventory', label: 'Backpack' },
  { id: 'equipment', label: 'Equipped' },
];

// Server timestamps are ISO strings with a trailing Z; SQLite CURRENT_TIMESTAMP values have none.
const toMs = iso => new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z').getTime();

function timeAgo(iso) {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - toMs(iso)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function pillStyle(active) {
  return {
    fontSize: 12, padding: '4px 12px', borderRadius: 'var(--radius)', cursor: 'pointer',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
    background: active ? 'rgba(200,168,75,0.15)' : 'transparent',
    color: active ? 'var(--gold)' : 'var(--text-dim)',
  };
}

// ── Items ─────────────────────────────────────────────────────────────────────

function ItemsView({ state, colorOf }) {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [playerId, setPlayerId] = useState(null);
  const [sort, setSort] = useState('count');

  const items = useMemo(() => {
    const byItem = new Map();
    for (const p of state) {
      if (playerId && p.player_id !== playerId) continue;
      for (const src of ['bank', 'inventory', 'equipment']) {
        if (source !== 'all' && source !== src) continue;
        for (const it of p[src]) {
          const key = it.id;
          const row = byItem.get(key) ?? { id: it.id, name: it.name || `Item ${it.id}`, value: it.value, total: 0, holders: [] };
          row.total += it.count;
          row.value = row.value ?? it.value;
          row.holders.push({ rsn: p.rsn, playerId: p.player_id, src, count: it.count });
          byItem.set(key, row);
        }
      }
    }
    const q = search.trim().toLowerCase();
    const list = [...byItem.values()].filter(r => !q || r.name.toLowerCase().includes(q));
    const worth = r => (r.value ?? 0) * r.total;
    list.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'value' ? worth(b) - worth(a) : b.total - a.total);
    return list;
  }, [state, search, source, playerId, sort]);

  const totalValue = items.reduce((n, r) => n + (r.value ?? 0) * r.total, 0);
  const withData = state.filter(p => p.updated_at).length;

  if (withData === 0) {
    return (
      <div className="empty-state">
        <div className="icon">🎒</div>
        <p>No plugin data yet.</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Open <strong>Plugin setup</strong> to connect each member's in-game plugin.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input className="form-input" style={{ maxWidth: 240 }} placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} />
        {SOURCES.map(s => <button key={s.id} style={pillStyle(source === s.id)} onClick={() => setSource(s.id)}>{s.label}</button>)}
        <select className="form-select" style={{ maxWidth: 160 }} value={sort} onChange={e => setSort(e.target.value)}>
          <option value="count">Sort: quantity</option>
          <option value="value">Sort: total value</option>
          <option value="name">Sort: name</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}>
          {items.length} items · base value {fmtNum(totalValue)} gp
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button style={pillStyle(!playerId)} onClick={() => setPlayerId(null)}>All players</button>
        {state.map(p => (
          <button key={p.player_id} style={{ ...pillStyle(playerId === p.player_id), color: playerId === p.player_id ? colorOf(p.player_id) : undefined }}
            onClick={() => setPlayerId(playerId === p.player_id ? null : p.player_id)}>{p.rsn}</button>
        ))}
      </div>
      {items.length === 0
        ? <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: 20, textAlign: 'center' }}>No items match.</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
            {items.slice(0, 400).map(r => (
              <div key={r.id} style={{ padding: '10px 12px', background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text-bright)' }}>{r.name}</strong>
                  <span style={{ fontWeight: 700, color: 'var(--gold)' }}>{fmtNum(r.total)}</span>
                </div>
                {r.value != null && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>value {fmtNum(r.value)} each · {fmtNum(r.value * r.total)} total</div>}
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {r.holders.map((h, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: colorOf(h.playerId) }}>{h.rsn} <span style={{ color: 'var(--text-dim)' }}>· {h.src === 'inventory' ? 'backpack' : h.src === 'equipment' ? 'equipped' : 'bank'}</span></span>
                      <span style={{ color: 'var(--text)' }}>{fmtNum(h.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      {items.length > 400 && <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>Showing the first 400 — narrow the search to see the rest.</div>}
    </div>
  );
}

// ── Ledger ────────────────────────────────────────────────────────────────────

function LedgerView({ ledger, colorOf }) {
  const [playerId, setPlayerId] = useState(null);
  const [op, setOp] = useState('all');
  const rows = ledger.filter(r => (!playerId || r.player_id === playerId) && (op === 'all' || (op === 'in' ? r.delta > 0 : r.delta < 0)));
  const players = [...new Map(ledger.map(r => [r.player_id, r.rsn])).entries()];

  if (ledger.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon">📒</div>
        <p>No deposits or withdrawals recorded yet.</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>They appear here as members use the group storage with the plugin running.</p>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {[['all', 'All movements'], ['in', 'Deposits'], ['out', 'Withdrawals']].map(([id, label]) => <button key={id} style={pillStyle(op === id)} onClick={() => setOp(id)}>{label}</button>)}
        <span style={{ width: 12 }} />
        <button style={pillStyle(!playerId)} onClick={() => setPlayerId(null)}>All members</button>
        {players.map(([id, rsn]) => <button key={id} style={{ ...pillStyle(playerId === id), color: playerId === id ? colorOf(id) : undefined }} onClick={() => setPlayerId(playerId === id ? null : id)}>{rsn}</button>)}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <th style={{ padding: '6px 8px' }}>Operation</th><th>Time</th><th>Item</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ paddingLeft: 12 }}>Member</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px', color: r.delta > 0 ? 'var(--green-bright)' : 'var(--orange)' }}>{r.delta > 0 ? '+ Deposited' : '− Withdrew'}</td>
                <td style={{ color: 'var(--text-dim)' }}>{new Date(r.occurred_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{r.item_name || `Item ${r.item_id}`} <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>({r.store === 'group' ? 'group storage' : 'bank'})</span></td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.delta > 0 ? '+' : '−'}{fmtNum(Math.abs(r.delta))}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{r.value_each != null ? fmtNum(r.value_each * Math.abs(r.delta)) : '—'}</td>
                <td style={{ paddingLeft: 12, color: colorOf(r.player_id) }}>{r.rsn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Plugin setup ──────────────────────────────────────────────────────────────

function SetupView({ state, canWrite, onToast, reload }) {
  const [fresh, setFresh] = useState(null); // { player_id, rsn, token } — shown once

  async function mint(p) {
    try {
      const r = await api.createPluginToken(p.player_id);
      setFresh({ ...r, rsn: p.rsn });
      reload();
    } catch (e) { onToast?.(e.message, 'error'); }
  }
  async function revoke(p) {
    if (!window.confirm(`Disconnect ${p.rsn}'s plugin? Their token stops working immediately.`)) return;
    try { await api.revokePluginToken(p.player_id); setFresh(null); reload(); onToast?.('Token revoked', 'success'); }
    catch (e) { onToast?.(e.message, 'error'); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="callout callout-info" style={{ fontSize: 12, lineHeight: 1.6, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        Each member installs the GIM Companion plugin in the RuneScape client and pastes their own token into it. A token can only submit
        that one player's data — it can't read anything or touch the rest of the group. Tokens are shown once; generating a new one disables the old.
      </div>

      {fresh && (
        <div style={{ padding: 12, border: '1px solid var(--gold-dark)', borderRadius: 'var(--radius)', background: 'rgba(200,168,75,0.08)' }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>Token for <strong>{fresh.rsn}</strong> — copy it now, it won't be shown again:</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" readOnly value={fresh.token} onFocus={e => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 12 }} />
            <button className="btn btn-primary btn-sm" onClick={() => { navigator.clipboard?.writeText(fresh.token); onToast?.('Copied', 'success'); }}>Copy</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setFresh(null)}>Done</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {state.map(p => {
          const live = p.updated_at && (Date.now() - toMs(p.updated_at)) < 10 * 60 * 1000;
          return (
            <div key={p.player_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: live ? 'var(--green-bright)' : p.has_token ? 'var(--orange)' : 'var(--border)' }} />
              <strong style={{ fontSize: 13, minWidth: 130 }}>{p.rsn}</strong>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', flex: 1 }}>
                {p.updated_at ? `last update ${timeAgo(p.updated_at)}${p.world ? ` · world ${p.world}` : ''}` : p.has_token ? 'token created — waiting for the plugin' : 'not connected'}
              </span>
              {canWrite && <button className="btn btn-secondary btn-sm" onClick={() => mint(p)}>{p.has_token ? 'New token' : 'Connect'}</button>}
              {canWrite && p.has_token && <button className="btn btn-ghost btn-sm" onClick={() => revoke(p)}>Disconnect</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export default function ItemsTab({ players, groupId, canWrite, onToast }) {
  const [view, setView] = useState('items');
  const [state, setState] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [error, setError] = useState(null);
  const colorOf = id => MEMBER_COLORS[Math.max(0, players.findIndex(p => p.id === id)) % MEMBER_COLORS.length];

  const load = useCallback(() => {
    if (!canWrite || !groupId) return;
    Promise.all([api.getPluginState(groupId), api.getPluginLedger(groupId)])
      .then(([s, l]) => { setState(s); setLedger(l); setError(null); })
      .catch(e => setError(e.message));
  }, [groupId, canWrite]);

  // The plugin sends about every 30 s, so poll quickly (only while this browser tab is visible) and
  // refresh immediately when the user comes back to it.
  useEffect(() => {
    load();
    const tick = () => { if (!document.hidden) load(); };
    const t = setInterval(tick, 8000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  if (!canWrite) {
    return (
      <div className="empty-state">
        <div className="icon">🔒</div>
        <p>Live items and the bank ledger are private to the group.</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Unlock the group with its secret to view them.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-body">
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[['items', '🎒 Items'], ['ledger', '📒 Bank ledger'], ['setup', '🔌 Plugin setup']].map(([id, label]) => (
            <button key={id} style={pillStyle(view === id)} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
        {error && <div style={{ color: 'var(--red-bright)', fontSize: 12, marginBottom: 10 }}>Couldn't load plugin data: {error}</div>}
        {view === 'items'  && <ItemsView  state={state} colorOf={colorOf} />}
        {view === 'ledger' && <LedgerView ledger={ledger} colorOf={colorOf} />}
        {view === 'setup'  && <SetupView  state={state} canWrite={canWrite} onToast={onToast} reload={load} />}
      </div>
    </div>
  );
}
