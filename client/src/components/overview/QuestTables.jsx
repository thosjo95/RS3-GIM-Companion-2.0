import React from 'react';

// ── Quest helpers ─────────────────────────────────────────────────────────────

export const DIFF_LABELS_MAP = { 0: 'Novice', 1: 'Intermediate', 2: 'Experienced', 3: 'Master', 4: 'Grandmaster' };

export const DIFF_COLORS     = { 0: '#7ef7a8', 1: '#7eb8f7', 2: '#f7c97e', 3: '#f77e7e', 4: '#d07ef7' };

export function QuestStatusIcon({ status }) {
  if (status === 'COMPLETED')  return <span style={{ color: 'var(--green-bright)', fontWeight: 700, fontSize: 14 }} title="Completed">✓</span>;
  if (status === 'STARTED')    return <span style={{ color: 'var(--gold)',         fontWeight: 600, fontSize: 13 }} title="Started">~</span>;
  return <span style={{ color: 'var(--border)', fontSize: 16, lineHeight: 1 }} title="Not started">·</span>;
}

export function DiffBadge({ difficulty }) {
  const label = DIFF_LABELS_MAP[difficulty] ?? '?';
  const color = DIFF_COLORS[difficulty]     ?? '#8a80a0';
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
      background: color + '22', color, whiteSpace: 'nowrap', flexShrink: 0 }}>
      {label}
    </span>
  );
}
