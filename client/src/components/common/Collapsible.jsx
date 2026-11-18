import React, { useState } from 'react';

// A boxed note with a title that can be folded away. The choice is remembered in this browser (per storageKey).
export default function Collapsible({ title, storageKey, defaultOpen = true, tone, children }) {
  const read = () => { try { const v = localStorage.getItem(`collapsed_${storageKey}`); return v == null ? defaultOpen : v !== '1'; } catch { return defaultOpen; } };
  const [open, setOpen] = useState(read);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(`collapsed_${storageKey}`, next ? '0' : '1'); } catch { /* not remembered */ }
  };
  return (
    <div style={{ border: `1px solid ${tone === 'gold' ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--radius)', fontSize: 12, lineHeight: 1.6, color: 'var(--text-dim)' }}>
      <button type="button" onClick={toggle} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
          color: tone === 'gold' ? 'var(--gold)' : 'var(--text-bright)', fontSize: 12, fontWeight: 700 }}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>
          <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {title}
      </button>
      {open && <div style={{ padding: '0 12px 12px', color: tone === 'gold' ? 'var(--text)' : undefined }}>{children}</div>}
    </div>
  );
}
