import React, { useEffect, useState } from 'react';

// beta.groupiron.com is a preview: a copy of the groupiron.com data. The server says so on /api/config (GIM_PREVIEW=1).
let cached = null;
export function useConfig() {
  const [info, setInfo] = useState(cached);
  useEffect(() => {
    if (cached) return;
    fetch('/api/config').then(r => r.ok ? r.json() : null).then(c => { cached = c || { preview: false }; setInfo(cached); }).catch(() => {});
  }, []);
  return info;
}
export function usePreview() {
  const info = useConfig();
  return info?.preview ? info : null;
}

// A slim note that floats over the bottom of the page (it never pushes content). Can be closed for the session.
export default function PreviewBanner() {
  const info = usePreview();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('preview_banner_closed') === '1'; } catch { return false; } });
  if (!info || hidden) return null;
  const close = () => { setHidden(true); try { sessionStorage.setItem('preview_banner_closed', '1'); } catch { /* fine */ } };
  return (
    <div role="status" style={{
      position: 'fixed', left: '50%', bottom: 12, transform: 'translateX(-50%)', zIndex: 900,
      maxWidth: 'min(760px, calc(100vw - 24px))', padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center',
      background: 'var(--bg-panel)', border: '1px solid var(--gold)', borderRadius: 'var(--radius)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.5)', fontSize: 12, lineHeight: 1.5, color: 'var(--text)',
    }}>
      <span>
        <strong style={{ color: 'var(--gold)' }}>Preview.</strong> This is a copy of your groupiron.com data{info.copied ? ` from ${info.copied}` : ''}.
        Keep using groupiron.com until launch. Changes made here are not kept.
      </span>
      <button className="btn btn-ghost" onClick={close} style={{ flexShrink: 0 }}>Close</button>
    </div>
  );
}
