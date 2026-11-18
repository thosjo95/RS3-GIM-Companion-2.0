import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import RsIcon from './RsIcon';
import { ItemIcon } from './GameIcon';
import { EquipmentGrid } from './WornGear';
import { SKILLS, SKILL_ICON_URLS, xpForLevel } from '../lib/rs3';

// A player's live loadout, opened from the equipment button on their card: backpack, equipment and skills,
// laid out like the game's own tabs. Data comes from the plugin (live while logged in, last seen after logout);
// skills fall back to the hiscores when the plugin has not reported them.

const TABS = [['backpack', 'Backpack', '🎒'], ['equipment', 'Equipment', '🛡️'], ['skills', 'Skills', '📊']];
const COINS_ID = 995;

const qtyColor = n => (n >= 10_000_000 ? '#00ff80' : n >= 100_000 ? '#ffffff' : '#ffff00');
const qtyText = n => (n >= 10_000_000 ? `${Math.floor(n / 1_000_000)}M` : n >= 100_000 ? `${Math.floor(n / 1000)}K` : n.toLocaleString());
const stroke = { textShadow: '1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000' };

function timeAgo(iso) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function Backpack({ items }) {
  const coins = items.find(i => i.id === COINS_ID)?.count ?? 0;
  const cells = Array.from({ length: 28 }, (_, i) => items[i] ?? null);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 56px)', gridAutoRows: '52px', gap: 4, justifyContent: 'center' }}>
        {cells.map((it, i) => (
          <div key={i} title={it ? `${it.name}${it.count > 1 ? ` ×${it.count.toLocaleString()}` : ''}` : ''} style={{ position: 'relative', background: 'var(--bg-root)', border: '1px solid var(--border)', borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {it && <ItemIcon id={it.id} name={it.name} size={34} />}
            {it && it.count > 1 && <span style={{ position: 'absolute', top: 1, left: 3, fontSize: 10, fontWeight: 700, color: qtyColor(it.count), ...stroke }}>{qtyText(it.count)}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: 'var(--text-dim)' }}>
        <span><strong style={{ color: 'var(--text-bright)' }}>{items.length}</strong> / 28 slots</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><ItemIcon id={COINS_ID} name="Coins" size={16} /><strong style={{ color: 'var(--gold)' }}>{coins.toLocaleString()}</strong></span>
      </div>
    </div>
  );
}

function SkillTip({ tip }) {
  if (!tip) return null;
  const { sk, level, xp } = tip.data;
  const elite = sk === 'Invention';                                  // elite skills follow another XP curve: no next-level figures
  const next = !elite && level < 120 && xp < 200_000_000 ? xpForLevel(level + 1) : null;
  const row = (label, value) => <div><span style={{ color: 'var(--text-dim)' }}>{label}:</span> <strong style={{ color: 'var(--text-bright)' }}>{value}</strong></div>;
  return (
    <div style={{ position: 'fixed', left: tip.x, top: tip.y, transform: 'translate(-50%, -100%)', zIndex: 200, pointerEvents: 'none', padding: '6px 9px', fontSize: 11, lineHeight: 1.45,
      background: '#1d160d', border: '1px solid var(--gold-dark, #7a6a30)', borderRadius: 4, boxShadow: '0 6px 18px rgba(0,0,0,0.6)', whiteSpace: 'nowrap' }}>
      <div style={{ color: 'var(--gold)', fontWeight: 700 }}>{sk}: {level}/{level}</div>
      {row('Current XP', xp.toLocaleString())}
      {next != null && row('Next level', next.toLocaleString())}
      {next != null && row('Remainder', Math.max(0, next - xp).toLocaleString())}
      {xp >= 200_000_000 && <div style={{ color: 'var(--text-dim)' }}>Maxed (200M)</div>}
    </div>
  );
}

function Skills({ player, live, questPoints }) {
  const [tip, setTip] = useState(null);
  const level = {}, xp = {};
  for (const s of player.skills ?? []) { level[s.skill_name] = s.level; xp[s.skill_name] = s.xp ?? 0; }
  for (const [k, v] of Object.entries(live ?? {})) {
    if (v?.level) level[k] = Math.max(level[k] ?? 0, v.level);
    if (Number.isFinite(v?.xp)) xp[k] = Math.max(xp[k] ?? 0, v.xp);
  }
  const total = SKILLS.reduce((n, s) => n + (level[s] ?? 0), 0);
  const icon = (src, alt) => <img src={src} alt={alt} width={16} height={16} style={{ imageRendering: 'crisp-edges' }} onError={e => { e.target.style.display = 'none'; }} />;
  const stat = (src, alt, value, title) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon(src, alt)}<strong style={{ color: 'var(--text-bright)' }}>{value}</strong></span>
  );
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 62px)', gap: 4, justifyContent: 'center' }}>
        {SKILLS.map(sk => (
          <div key={sk}
            onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top - 6, data: { sk, level: level[sk] ?? 1, xp: xp[sk] ?? 0 } }); }}
            onMouseLeave={() => setTip(null)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, padding: '4px 6px', background: 'var(--bg-root)', border: '1px solid var(--border)', borderRadius: 4 }}>
            <img src={SKILL_ICON_URLS[sk]} alt={sk} width={18} height={18} style={{ flexShrink: 0 }} onError={e => { e.target.style.visibility = 'hidden'; }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-bright)' }}>{level[sk] ?? '–'}</span>
          </div>
        ))}
      </div>
      <SkillTip tip={tip} />
      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginTop: 12, fontSize: 12, color: 'var(--text-dim)' }}>
        {stat('https://runescape.wiki/images/Statistics.png', 'Total level', total.toLocaleString(), 'Total level')}
        {stat('https://runescape.wiki/images/Multicombat.png', 'Combat level', player.combat_level ?? '?', 'Combat level')}
        {stat('https://runescape.wiki/images/Quest_points.png', 'Quest points', (questPoints ?? player.quest_points ?? 0).toLocaleString(), 'Quest points')}
      </div>
    </div>
  );
}

export default function PlayerLoadout({ player, groupId, canWrite, onClose }) {
  const [tab, setTab] = useState('equipment');
  const [row, setRow] = useState(null);
  const [error, setError] = useState(false);
  const [questPoints, setQuestPoints] = useState(null);   // from the quests the plugin read in the game

  useEffect(() => {
    if (!canWrite || !groupId) return undefined;
    let alive = true;
    const load = () => api.getPluginState(groupId, { player_id: player.id, include: 'inventory,equipment,skills' })
      .then(r => { if (alive) { setRow((Array.isArray(r) ? r : []).find(x => x.player_id === player.id) ?? null); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [groupId, canWrite, player.id]);

  useEffect(() => {
    setQuestPoints(null);
    if (!canWrite || !groupId) return;
    let alive = true;
    api.getPluginQuests(groupId).then(r => {
      const mine = (Array.isArray(r) ? r : []).filter(q => q.player_id === player.id);
      if (alive && mine.length) setQuestPoints(mine.filter(q => q.state === 'finished').reduce((n, q) => n + (q.points || 0), 0));
    }).catch(() => {});
    return () => { alive = false; };
  }, [groupId, canWrite, player.id]);

  const fresh = row?.updated_at && Date.now() - Date.parse(row.updated_at) < 5 * 60 * 1000;
  let body;
  if (tab === 'skills') body = <Skills player={player} live={row?.skills} questPoints={questPoints} />;      // hiscores are public: no unlock needed
  else if (!canWrite) body = <Note>Unlock the group to see {player.rsn}'s items.</Note>;
  else if (error) body = <Note>Could not load the plugin data.</Note>;
  else if (!row || !row.updated_at) body = <Note>{player.rsn} has not sent any data from the plugin yet.</Note>;
  else body = tab === 'backpack' ? <Backpack items={row.inventory ?? []} /> : <EquipmentGrid equipment={row.equipment ?? []} />;

  return (
    <div style={{ width: 360, maxWidth: '100%', margin: '0 auto', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--border)', background: 'var(--bg-root)' }}>
        {TABS.map(([id, label, fb]) => (
          <button key={id} type="button" onClick={() => setTab(id)} title={label} style={{
            flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer', background: 'transparent',
            borderBottom: `2px solid ${tab === id ? 'var(--gold)' : 'transparent'}`, opacity: tab === id ? 1 : 0.55,
          }}><RsIcon name={id} fallback={fb} size={22} /></button>
        ))}
        <button type="button" onClick={onClose} title="Close" style={{ width: 36, border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: 'var(--text-dim)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: fresh ? '#4caf50' : 'var(--text-dim)' }} />
          <span><strong style={{ color: 'var(--text-bright)' }}>{player.rsn}</strong>{row?.updated_at ? ` · ${fresh ? 'live' : `last seen ${timeAgo(row.updated_at)}`}` : ''}</span>
        </div>
        {body}
      </div>
    </div>
  );
}

function Note({ children }) {
  return <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '18px 4px', textAlign: 'center' }}>{children}</div>;
}
