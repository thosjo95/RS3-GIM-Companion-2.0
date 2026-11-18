import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { MEMBER_COLORS, fmtNum } from '../lib/rs3';
import RsIcon, { IconLabel } from './RsIcon';
import { ItemIcon } from './GameIcon';

// GIM 2.0 — live group items, the Bank Journal (group storage in/out) and plugin setup.
// All data is pushed by the in-game RS3 plugin (see /plugin) and is private to the group.

// The vault shows two places: the shared group storage and everyone's bank.
const SOURCES = [
  { id: 'group', label: 'Group Storage',   icon: 'vault',    fallback: '🏦' },
  { id: 'bank',  label: 'Players banks', icon: 'backpack', fallback: '🎒' },
];

// Server timestamps are ISO strings with a trailing Z; SQLite CURRENT_TIMESTAMP values have none.
const toMs = iso => new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : iso + 'Z').getTime();

// The group storage is shared, so every member's plugin sees the same contents: use the newest snapshot.
function newestGroupStorage(state) {
  let best = null;
  for (const p of state) {
    if (p.group_storage_at && (!best || toMs(p.group_storage_at) > toMs(best.group_storage_at))) best = p;
  }
  return best ? { items: best.group_storage, at: best.group_storage_at, by: best.rsn } : null;
}

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

// RuneScape-style stack text: small stacks in yellow, 100K and above abbreviated in white, 10M and above in green.
function qtyLabel(n) {
  if (n >= 10_000_000) return { t: `${Math.floor(n / 1_000_000)}M`, c: '#00ff80' };
  if (n >= 100_000)    return { t: `${Math.floor(n / 1000)}K`, c: '#ffffff' };
  return { t: n.toLocaleString(), c: '#ffff00' };
}

function StackIcon({ id, name, count, size = 40 }) {
  const q = count > 1 ? qtyLabel(count) : null;
  return (
    <div style={{ position: 'relative', width: size + 6, height: size + 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <ItemIcon id={id} name={name} size={size} />
      {q && <span style={{ position: 'absolute', top: 0, left: 1, fontSize: 10, fontWeight: 700, color: q.c, textShadow: '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000' }}>{q.t}</span>}
    </div>
  );
}

function ItemsView({ state, colorOf, selectedPlayerId }) {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('bank');
  const [sort, setSort] = useState('count');
  const [layout, setLayoutState] = useState(() => { try { return localStorage.getItem('gim_vault_layout') || 'cards'; } catch { return 'cards'; } });
  const setLayout = v => { setLayoutState(v); try { localStorage.setItem('gim_vault_layout', v); } catch { /* not saved */ } };
  const groupStorage = useMemo(() => newestGroupStorage(state), [state]);

  const items = useMemo(() => {
    const byItem = new Map();
    const add = (it, holder) => {
      const row = byItem.get(it.id) ?? { id: it.id, name: it.name || `Item ${it.id}`, value: it.value, total: 0, holders: [] };
      row.total += it.count;
      row.value = row.value ?? it.value;
      row.holders.push({ ...holder, count: it.count });
      byItem.set(it.id, row);
    };
    if (source === 'group') {
      // the group storage belongs to the whole group, so it is never narrowed by the selected player
      for (const it of groupStorage?.items ?? []) add(it, { rsn: 'Group storage', playerId: null });
    } else {
      for (const p of state) {
        if (selectedPlayerId != null && p.player_id !== selectedPlayerId) continue;
        for (const it of p.bank) add(it, { rsn: p.rsn, playerId: p.player_id });
      }
    }
    const q = search.trim().toLowerCase();
    const list = [...byItem.values()].filter(r => !q || r.name.toLowerCase().includes(q));
    for (const r of list) r.holders.sort((a, b) => b.count - a.count);
    const worth = r => (r.value ?? 0) * r.total;
    list.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'value' ? worth(b) - worth(a) : b.total - a.total);
    return list;
  }, [state, search, source, selectedPlayerId, sort, groupStorage]);

  const totalValue = items.reduce((n, r) => n + (r.value ?? 0) * r.total, 0);
  const withData = state.filter(p => p.updated_at).length;
  const limit = source === 'group' ? 500 : 300;

  if (withData === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><RsIcon name="setup" fallback="🔌" size={56} /></div>
        <p>No plugin data yet.</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Open <strong>Plugin setup</strong> to connect each member's in-game plugin.</p>
      </div>
    );
  }

  const note = source === 'group'
    ? (groupStorage
        ? `Group storage: ${groupStorage.items.length} items, last seen ${timeAgo(groupStorage.at)} (opened by ${groupStorage.by}).`
        : 'Group storage: not seen yet. A member with the plugin running needs to open it in-game once.')
    : (selectedPlayerId != null
        ? 'Showing the selected player’s bank. Deselect the player card (click it again) to see who holds what.'
        : 'Each item shows who has it banked and how many.');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {SOURCES.map(x => <button key={x.id} style={pillStyle(source === x.id)} onClick={() => setSource(x.id)}><IconLabel name={x.icon} fallback={x.fallback} size={16}>{x.label}</IconLabel></button>)}
        <input className="form-input" style={{ maxWidth: 220, marginLeft: 8 }} placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" style={{ maxWidth: 160 }} value={sort} onChange={e => setSort(e.target.value)}>
          <option value="count">Sort: quantity</option>
          <option value="value">Sort: total value</option>
          <option value="name">Sort: name</option>
        </select>
        <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
          {[['cards', 'Cards'], ['tiles', 'Tiles'], ['list', 'List']].map(([id, label]) => (
            <button key={id} style={pillStyle(layout === id)} onClick={() => setLayout(id)}>{label}</button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}>
          {items.length.toLocaleString()} items · {fmtNum(totalValue)} gp
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>{note}</div>

      {items.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: 20, textAlign: 'center' }}>No items match.</div>}

      {layout === 'tiles' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {items.slice(0, limit).map(r => (
            <div key={r.id} title={[`${r.name} ×${r.total.toLocaleString()}`, ...(source === 'bank' ? r.holders.map(h => `${h.rsn}: ${h.count.toLocaleString()}`) : [])].join('\n')}
              style={{ position: 'relative', padding: 4, background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <StackIcon id={r.id} name={r.name} count={r.total} size={36} />
              {source === 'bank' && r.holders.length > 1 && (
                <div style={{ display: 'flex', height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
                  {r.holders.map((h, i) => <div key={i} style={{ width: `${(h.count / r.total) * 100}%`, background: colorOf(h.playerId) }} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {layout === 'list' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <th style={{ padding: '6px 8px' }}>Item</th><th style={{ textAlign: 'right' }}>Total</th>{source === 'bank' && <th style={{ paddingLeft: 14 }}>Held by</th>}<th style={{ textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, limit).map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ItemIcon id={r.id} name={r.name} size={26} /><span style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{r.name}</span></div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>{r.total.toLocaleString()}</td>
                  {source === 'bank' && (
                    <td style={{ paddingLeft: 14 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                        {r.holders.map((h, i) => (
                          <span key={i} style={{ whiteSpace: 'nowrap' }}>
                            <span style={{ color: colorOf(h.playerId), fontWeight: 600 }}>{h.rsn}</span> <span style={{ color: 'var(--text-bright)' }}>{h.count.toLocaleString()}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                  <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{r.value != null ? `${fmtNum(r.value * r.total)} gp` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {layout === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${source === 'bank' ? 280 : 200}px, 1fr))`, gap: 10 }}>
          {items.slice(0, limit).map(r => (
            <div key={r.id} style={{ padding: '10px 12px', background: 'var(--bg-panel-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <StackIcon id={r.id} name={r.name} count={r.total} size={40} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                    {source === 'bank' && r.holders.length > 1 ? `${r.holders.length} members · ` : ''}total {fmtNum(r.total)}{r.value != null ? ` · ${fmtNum(r.value * r.total)} gp` : ''}
                  </div>
                </div>
              </div>
              {source === 'bank' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 9 }}>
                  {r.holders.map((h, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorOf(h.playerId), flexShrink: 0 }} />
                      <span style={{ color: colorOf(h.playerId), fontWeight: 600, width: 96, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.rsn}</span>
                      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--bg-root)', overflow: 'hidden' }} title={`${Math.round((h.count / r.total) * 100)}% of the group's ${r.name}`}>
                        <div style={{ width: `${(h.count / r.total) * 100}%`, height: '100%', background: colorOf(h.playerId), opacity: 0.85 }} />
                      </div>
                      <span style={{ color: 'var(--text-bright)', fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right' }}>{h.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {items.length > limit && <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', marginTop: 10 }}>Showing the first {limit} — narrow the search to see the rest.</div>}
    </div>
  );
}

// ── Ledger ────────────────────────────────────────────────────────────────────

// The Bank Journal: what was put into / taken out of the group storage, and by whom.
function LedgerView({ ledger, colorOf, selectedPlayerId }) {
  const [op, setOp] = useState('all');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const rows = ledger.filter(r => (selectedPlayerId == null || r.player_id === selectedPlayerId)
    && (op === 'all' || (op === 'in' ? r.delta > 0 : r.delta < 0))
    && (!q || (r.item_name || '').toLowerCase().includes(q)));

  if (ledger.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><RsIcon name="journal" fallback="📒" size={56} /></div>
        <p>Nothing recorded in the Bank Journal yet.</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Everything a member puts into or takes out of the group storage appears here, as long as their plugin is running.</p>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {[['all', 'All movements'], ['in', 'Deposits'], ['out', 'Withdrawals']].map(([id, label]) => <button key={id} style={pillStyle(op === id)} onClick={() => setOp(id)}>{label}</button>)}
        <span style={{ width: 12 }} />
        <input className="form-input" style={{ maxWidth: 220, marginLeft: 'auto' }} placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-dim)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <th style={{ padding: '6px 8px' }}>Action</th><th>Time</th><th>Item</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Value</th><th style={{ paddingLeft: 12 }}>Member</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px', color: r.delta > 0 ? 'var(--green-bright)' : 'var(--orange)' }}>{r.delta > 0 ? '+ Deposited' : '− Withdrew'}</td>
                <td style={{ color: 'var(--text-dim)' }}>{new Date(r.occurred_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{r.item_name || `Item ${r.item_id}`}</td>
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

// `view` is chosen by the Group Vault's section buttons: 'items' | 'ledger' | 'setup'.
export default function ItemsTab({ players, groupId, canWrite, onToast, selectedPlayerId = null, view = 'items' }) {
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
        <p>The group's items and Bank Journal are private to the group.</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Unlock the group with its secret to view them.</p>
      </div>
    );
  }

  return (
    <div>
      {error && <div style={{ color: 'var(--red-bright)', fontSize: 12, marginBottom: 10 }}>Couldn't load plugin data: {error}</div>}
      {view === 'items'  && <ItemsView  state={state} colorOf={colorOf} selectedPlayerId={selectedPlayerId} />}
      {view === 'ledger' && <LedgerView ledger={ledger} colorOf={colorOf} selectedPlayerId={selectedPlayerId} />}
      {view === 'setup'  && <SetupView  state={state} canWrite={canWrite} onToast={onToast} reload={load} />}
    </div>
  );
}
