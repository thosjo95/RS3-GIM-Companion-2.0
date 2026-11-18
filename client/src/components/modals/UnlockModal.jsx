import React, { useState } from 'react';

// Unlock modal: enter the group secret (and optionally pick who you are). "Forgot the secret?" explains how to get it back:
// there are no accounts, so the site itself cannot tell who may reset a group's secret. A member who has the group
// unlocked can show it again; otherwise the developer gives the group a new one from the admin portal.
export default function UnlockModal({ group, onConfirm, onCancel }) {
  const [pw, setPw] = useState('');
  const [rsn, setRsn] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const players = group?.players || [];

  async function handleSubmit(e) {
    e.preventDefault();
    if (!pw.trim()) return;
    setChecking(true);
    setError('');
    try {
      await onConfirm(pw.trim(), rsn || null);
    } catch (err) {
      setError(err.message === 'Incorrect group password' || !err.message ? 'That secret is not right for this group.' : err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{maxWidth:420}}>
        <div className="modal-header">
          <span className="modal-title">Unlock group</span>
          {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel} title="Close">×</button>}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{color:'var(--text-dim)',fontSize:13,marginBottom:16}}>
              Enter the secret of <strong style={{color:'var(--text-bright)'}}>{group?.name}</strong>. It is the same secret every member
              types into the GIM Companion plugin in RuneScape.
            </p>
            <div className="form-group">
              <label className="form-label">Group secret</label>
              <input className="form-input" type="password" value={pw}
                onChange={e => setPw(e.target.value)} autoFocus placeholder="XXXX-XXXX-XXXX" />
            </div>
            {players.length > 0 && (
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">Who are you? (optional)</label>
                <input
                  className="form-input"
                  list="unlock-rsn-suggestions"
                  value={rsn}
                  onChange={e => setRsn(e.target.value)}
                  placeholder="Type or select your RSN"
                  autoComplete="off"
                />
                <datalist id="unlock-rsn-suggestions">
                  {players.map(p => <option key={p.id} value={p.rsn} />)}
                </datalist>
              </div>
            )}
            {error && <div style={{color:'var(--danger)',fontSize:12,marginTop:8}}>{error}</div>}

            <button type="button" onClick={() => setForgot(f => !f)}
              style={{ marginTop: 12, padding: 0, border: 'none', background: 'none', color: 'var(--gold)', fontSize: 12, cursor: 'pointer' }}>
              Forgot the secret?
            </button>
            {forgot && (
              <div style={{ marginTop: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12, lineHeight: 1.6, color: 'var(--text-dim)' }}>
                <div style={{ marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text-bright)' }}>Ask a member.</strong> Anyone in your group who still has the group unlocked can open
                  <strong> Plugin</strong> in the top bar and press <strong>Show</strong>.
                </div>
                <div>
                  <strong style={{ color: 'var(--text-bright)' }}>Nobody has it?</strong> Contact the developer on{' '}
                  <a href="https://discord.gg/xbB2T2Q6A" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>Discord</a> or at{' '}
                  <a href="mailto:rs3groupiron@pm.me" style={{ color: 'var(--gold)' }}>rs3groupiron@pm.me</a> with your group name and character name.
                  After checking that you are a member, your group gets a new secret. The old one stops working; plugins that are already
                  connected keep sending.
                </div>
                <div style={{ marginTop: 6, fontSize: 11 }}>
                  The site has no accounts, so it cannot reset a secret by itself: anyone could otherwise take over a group.
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer">
            {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
            <button type="submit" className="btn btn-primary" disabled={checking || !pw.trim()}>
              {checking ? <span className="spinner" style={{width:12,height:12}} /> : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
