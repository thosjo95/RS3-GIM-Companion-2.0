import React, { useState } from 'react';

// Official RuneScape icons (the game's own sprites, as hosted by the RuneScape Wiki) used in place of generic emoji.
// If an image cannot load, the old emoji is shown instead, so a navigation button is never left without an icon.
const BASE = 'https://runescape.wiki/images/';

export const RS_ICON = {
  // dashboard tabs
  overview:     'Statistics.png',                // the red / green / blue stat bars
  goals:        'Task_icon.png',                 // flag
  vault:        'Treasure_Hunter_icon.png',      // treasure chest
  quests:       'Quest_icon.png',                // quest book
  leaderboards: 'Achievements_icon.png',         // trophy
  // vault sections
  drops:        'Casket.png',
  journal:      'Notes_icon.png',
  setup:        'Options_icon.png',              // the options cog
  // quests & area tasks page
  areaTasks:    'World_Map_icon.png',
  achievements: 'RuneScore.png',
  // quests & area tasks page: the Group Ironman Journey panel
  journey:      'Group_Ironman_helm.png',
  // goals page
  browser:      'Compass.png',
  activeGoals:  'Task_icon.png',
  // leaderboard sections
  firsts:       'Task_icon.png',
  milestones:   'Statistics.png',
  bosses:       'Slayer.png',
  clues:        'Clue_scroll_%28master%29.png',
  mastery:      'Max_cape.png',
};

export default function RsIcon({ name, fallback = '', size = 16, style }) {
  const [failed, setFailed] = useState(false);
  const file = RS_ICON[name];
  if (!file || failed) return fallback ? <span style={{ fontSize: size * 0.9, lineHeight: 1, ...style }}>{fallback}</span> : null;
  return (
    <img src={BASE + file} alt="" width={size} height={size} onError={() => setFailed(true)}
      style={{ objectFit: 'contain', flexShrink: 0, verticalAlign: 'middle', ...style }} />
  );
}

/** An icon followed by a label, vertically centred. */
export function IconLabel({ name, fallback, size = 16, gap = 6, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      <RsIcon name={name} fallback={fallback} size={size} />
      {children}
    </span>
  );
}
