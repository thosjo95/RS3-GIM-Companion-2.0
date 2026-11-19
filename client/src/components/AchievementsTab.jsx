import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import RsIcon from './RsIcon';
import { MEMBER_COLORS } from '../lib/rs3';

// ── RS3 area task definitions ─────────────────────────────────────────────────

const TIERS = [
  { key: 'easy',   label: 'Easy',   color: 'var(--green-bright)',  bg: 'rgba(90,154,80,0.15)',    border: 'var(--green)' },
  { key: 'medium', label: 'Medium', color: '#7eb8f7',              bg: 'rgba(74,136,184,0.15)',   border: 'var(--blue)' },
  { key: 'hard',   label: 'Hard',   color: 'var(--orange)',        bg: 'rgba(200,120,48,0.15)',   border: 'var(--orange)' },
  { key: 'elite',  label: 'Elite',  color: '#d07ef7',              bg: 'rgba(160,80,220,0.15)',   border: '#a855d4' },
];

// Lumbridge is the only set that uses Beginner/Easy/Medium/Hard instead of
// Easy/Medium/Hard/Elite, so its four rows hold different keys.
const LUMBRIDGE_TIERS = [
  { ...TIERS[0], key: 'beginner', label: 'Beginner' },
  { ...TIERS[1], key: 'easy',     label: 'Easy'     },
  { ...TIERS[2], key: 'medium',   label: 'Medium'   },
  { ...TIERS[3], key: 'hard',     label: 'Hard'     },
];

// Base key must match the server-side diaryRegionKey() in activitySync.js.
// `icon` is the region's lodestone icon (the picture the game's lodestone network shows), hosted by the RuneScape Wiki.
// Daemonheim and the Underworld have no lodestone, so they show the world map icon.
const DIARY_REGIONS = [
  { base: 'diary_lumbridge_draynor',   label: 'Lumbridge & Draynor', tiers: LUMBRIDGE_TIERS, icon: 'Lumbridge_lodestone_icon.png' },
  { base: 'diary_varrock',             label: 'Varrock',        icon: 'Varrock_lodestone_icon.png' },
  { base: 'diary_falador',             label: 'Falador',        icon: 'Falador_lodestone_icon.png' },
  { base: 'diary_karamja',             label: 'Karamja',        icon: 'Karamja_lodestone_icon.png' },
  { base: 'diary_ardougne',            label: 'Ardougne',       icon: 'Ardougne_lodestone_icon.png' },
  { base: 'diary_seers_village',       label: "Seers' Village", icon: "Seers%27_Village_lodestone_icon.png" },
  { base: 'diary_fremennik',           label: 'Fremennik',      icon: 'Fremennik_Province_lodestone_icon.png' },
  { base: 'diary_morytania',           label: 'Morytania',      icon: 'Canifis_lodestone_icon.png' },
  { base: 'diary_desert',              label: 'Desert',         icon: 'Al_Kharid_lodestone_icon.png' },
  { base: 'diary_daemonheim',          label: 'Daemonheim'      },
  { base: 'diary_tirannwn',            label: 'Tirannwn',       icon: 'Tirannwn_lodestone_icon.png' },
  { base: 'diary_wilderness',          label: 'Wilderness',     icon: 'Wilderness_Crater_lodestone_icon.png' },
  { base: 'diary_underworld',          label: 'Underworld'      },
];

const regionTiers = region => region.tiers ?? TIERS;
const WIKI = 'https://runescape.wiki/images/';

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function RegionIcon({ region, size = 34 }) {
  const [failed, setFailed] = useState(false);
  if (!region.icon || failed) return <RsIcon name="areaTasks" fallback="" size={size - 6} />;
  return <img src={WIKI + region.icon} alt="" width={size} height={size} onError={() => setFailed(true)} style={{ objectFit: 'contain', flexShrink: 0 }} />;
}

// ── Main component ───────────────────────────────────────────────────────

// Completed / total area tasks for each player, from the achievement rows the API returns.
export function areaTaskTotals(players, achievements) {
  const done = {};
  for (const a of achievements) if (a.achieved) (done[a.player_id] ??= new Set()).add(a.key);
  const total = DIARY_REGIONS.length * TIERS.length;
  return new Map(players.map(p => [p.id, {
    total,
    done: DIARY_REGIONS.reduce((n, r) => n + regionTiers(r).filter(t => done[p.id]?.has(`${r.base}_${t.key}`)).length, 0),
  }]));
}

// `embedded`: shown inside the Quests & Area Tasks page, which supplies the progress summary and the frame itself.
// Area tasks are read-only: they come from the game (the plugin) and the Adventurer's Log, nobody ticks them by hand.
export default function AchievementsTab({ players, groupId, onToast, embedded = false, onLoaded }) {
  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading]           = useState(true);

  const colorMap = useMemo(
    () => Object.fromEntries(players.map((p, i) => [p.id, MEMBER_COLORS[i % MEMBER_COLORS.length]])),
    [players],
  );

  async function load() {
    if (!groupId) return;
    try {
      const data = await api.getAchievements(groupId);
      setAchievements(data);
      onLoaded?.(data);
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [groupId]);

  // achievementsByPlayer[playerId][key] = achievement row
  const achievementsByPlayer = useMemo(() => {
    const map = {};
    for (const a of achievements) {
      if (!map[a.player_id]) map[a.player_id] = {};
      map[a.player_id][a.key] = a;
    }
    return map;
  }, [achievements]);

  const getAchievement = (playerId, regionBase, tierKey) => achievementsByPlayer[playerId]?.[`${regionBase}_${tierKey}`] ?? null;

  const summary = useMemo(() => {
    const total = DIARY_REGIONS.length * TIERS.length;
    return players.map(p => {
      const done = DIARY_REGIONS.reduce((n, r) =>
        n + regionTiers(r).filter(t => getAchievement(p.id, r.base, t.key)?.achieved).length, 0);
      return { ...p, done, pct: Math.round((done / total) * 100) };
    }).sort((a, b) => b.done - a.done);
  }, [achievements, players]);

  if (players.length === 0) {
    return (
      <div className="empty-state">
        <p>Add and sync players to track area tasks.</p>
      </div>
    );
  }

  return (
    <div style={embedded ? { display: 'flex', flexDirection: 'column', gap: 16 } : {
      display: 'flex', flexDirection: 'column', gap: 16,
      background: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '16px 18px',
    }}>
      <div>
        {!embedded && <div className="section-title" style={{ marginBottom: 4 }}>Area Tasks</div>}
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Read from the game by the plugin and from the Adventurer's Log. A filled circle is a completed tier; hover it for the date.
        </div>
      </div>

      {/* Progress summary row (the combined page shows its own) */}
      {!embedded && <div data-tour="achievements-progress" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {summary.map(p => (
          <div key={p.id} style={{
            flex: '1 1 140px', padding: '10px 14px',
            background: 'var(--bg-panel-alt)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
          }}>
            <div style={{ fontWeight: 700, color: colorMap[p.id], fontSize: 13, marginBottom: 4 }}>{p.rsn}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{p.done} / {DIARY_REGIONS.length * TIERS.length} completed</div>
            <div style={{ height: 4, background: 'var(--bg-root)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
              <div style={{ width: `${p.pct}%`, height: '100%', background: colorMap[p.id], borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        ))}
      </div>}

      {loading
        ? <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /></div>
        : <RegionCards players={players} colorMap={colorMap} getAchievement={getAchievement} />}

      <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
        Lumbridge &amp; Draynor uses Beginner / Easy / Medium / Hard instead of Easy / Medium / Hard / Elite.
      </div>
    </div>
  );
}

// ── One card per region: icon, name, group progress, and a row per tier with one circle per member ───────────────

function RegionCards({ players, colorMap, getAchievement }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 270px), 1fr))', gap: 12 }}>
      {DIARY_REGIONS.map(region => {
        const tiers = regionTiers(region);
        const total = tiers.length * players.length;
        const done = tiers.reduce((n, t) => n + players.filter(p => getAchievement(p.id, region.base, t.key)?.achieved).length, 0);
        const complete = total > 0 && done === total;
        return (
          <div key={region.base} style={{
            padding: 12, borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel-alt)',
            border: `1px solid ${complete ? 'var(--gold)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <RegionIcon region={region} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{region.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{done} / {total} tiers done by the group</div>
              </div>
            </div>
            <div style={{ height: 3, background: 'var(--bg-root)', borderRadius: 2, overflow: 'hidden', marginTop: -4 }}>
              <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: '100%', background: complete ? 'var(--gold)' : 'var(--green-bright)', transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tiers.map(tier => {
                const rows = players.map(p => ({ p, ach: getAchievement(p.id, region.base, tier.key) }));
                const count = rows.filter(r => r.ach?.achieved).length;
                return (
                  <div key={tier.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 'var(--radius)', background: count === players.length ? tier.bg : 'transparent' }}>
                    <span style={{ width: 62, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: tier.color }}>{tier.label}</span>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
                      {rows.map(({ p, ach }) => {
                        const ok = !!ach?.achieved;
                        return (
                          <span key={p.id}
                            title={ok ? `${p.rsn}: completed${ach.achieved_at ? ' · ' + fmtDate(ach.achieved_at) : ''}` : `${p.rsn}: not completed`}
                            style={{
                              width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                              border: `2px solid ${ok ? colorMap[p.id] : 'var(--border)'}`, background: ok ? colorMap[p.id] : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 9, fontWeight: 700, color: ok ? '#111' : 'transparent',
                            }}>
                            {p.rsn.charAt(0).toUpperCase()}
                          </span>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{count}/{players.length}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
