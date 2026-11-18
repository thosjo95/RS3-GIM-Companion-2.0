import React, { useState } from 'react';
import ItemsTab from './ItemsTab';
import GroupSettings from './GroupSettings';
import RsIcon from './RsIcon';
import { usePreview, useConfig } from './PreviewBanner';

// The Plugin window (top bar). It is the ONE place for the group secret:
//   - group not claimed yet: claim it here. That creates the secret, which the claimer saves and shares with the group;
//   - claimed but locked in this browser: unlock with the secret;
//   - unlocked: how to connect the GIM Companion plugin with the secret, the secret itself, and who is connected.
export default function PluginSetupModal({ group, canWrite, isClaimed, onClaim, onClaimV2, onUnlock, onClose, onToast, onChanged, onOpenWebhook }) {
  const [rsn, setRsn] = useState('');
  const [oldSecret, setOldSecret] = useState('');     // a group that came over from groupiron.com: its old secret, once
  const [busy, setBusy] = useState(false);
  const [newSecret, setNewSecret] = useState(null);    // shown right after claiming
  const [copied, setCopied] = useState(false);
  const players = group?.players ?? [];

  async function claim() {
    setBusy(true);
    try { const r = await onClaim(rsn || null); setNewSecret(r.secret); }
    catch (e) { onToast?.(e.message || 'Could not claim the group', 'error'); }
    finally { setBusy(false); }
  }
  async function claimV2() {
    setBusy(true);
    try { const r = await onClaimV2(oldSecret, rsn || null); setNewSecret(r.secret); setOldSecret(''); }
    catch (e) { onToast?.(e.message || 'Could not claim the group', 'error'); }
    finally { setBusy(false); }
  }
  const copy = () => navigator.clipboard?.writeText(newSecret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });

  const box = { padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12, lineHeight: 1.6, color: 'var(--text-dim)' };
  const preview = usePreview();
  const config = useConfig();
  // On the preview server a new secret is only a trial: the data there is replaced by a fresh copy at launch.
  const previewNote = preview && (
    <div style={{ ...box, borderColor: 'var(--gold)', color: 'var(--text)' }}>
      <strong style={{ color: 'var(--gold)' }}>Preview.</strong> A secret made here is only for trying this out and is not kept. Claim your group again on launch day,
      or use groupiron.com until then.
    </div>
  );
  // Before launch: claim and save the secret now, type it into the plugin once it is approved.
  const prelaunch = config && !config.plugin_live && (
    <div style={box}>
      <strong style={{ color: 'var(--text-bright)' }}>Waiting for approval.</strong> The GIM Companion plugin is waiting for Jagex's approval.
      Claim your group and save the secret now; you will type it into the plugin on launch day.
    </div>
  );
  const notes = (!isClaimed || newSecret) ? <>{prelaunch}{previewNote}</> : prelaunch;
  let body;
  if (!isClaimed && !newSecret && group?.needs_rekey) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={box}>
          <strong style={{ color: 'var(--text-bright)' }}>{group?.name}</strong> came over from groupiron.com with all its history. To use it on the
          new version, enter your <strong>old group secret</strong> once. You then get a <strong>new secret</strong> for the website and the GIM Companion
          plugin, and the old one stops working. Save the new secret and share it with your group.
        </div>
        <label style={{ fontSize: 12 }}>Old group secret
          <input className="form-input" value={oldSecret} onChange={e => setOldSecret(e.target.value)} autoComplete="off" spellCheck={false}
            onKeyDown={e => e.key === 'Enter' && oldSecret.trim() && claimV2()} placeholder="The secret you used on groupiron.com" style={{ width: '100%', marginTop: 4 }} />
        </label>
        {players.length > 0 && (
          <label style={{ fontSize: 12 }}>Which character is yours? (optional)
            <select className="form-input" value={rsn} onChange={e => setRsn(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
              <option value="">Select your character</option>
              {players.map(p => <option key={p.id} value={p.rsn}>{p.rsn}</option>)}
            </select>
          </label>
        )}
        <div style={{ ...box, fontSize: 11 }}>
          Lost the old secret? Ask the member who claimed the group, or contact the developer on{' '}
          <a href="https://discord.gg/xbB2T2Q6A" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>Discord</a> or at{' '}
          <a href="mailto:rs3groupiron@pm.me" style={{ color: 'var(--gold)' }}>rs3groupiron@pm.me</a>.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={claimV2} disabled={busy || !oldSecret.trim()}>{busy ? 'Claiming...' : 'Claim on the new version'}</button>
        </div>
      </div>
    );
  } else if (!isClaimed && !newSecret) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={box}>
          <strong style={{ color: 'var(--text-bright)' }}>{group?.name}</strong> has no group secret yet. Claiming the group creates one.
          The secret does two things: every member <strong>unlocks this website</strong> with it, and every member <strong>types it into the
          GIM Companion plugin</strong> in RuneScape to connect their character.
        </div>
        <div style={{ ...box, background: 'rgba(192,64,64,0.10)', borderColor: 'rgba(192,64,64,0.4)' }}>
          <strong style={{ color: 'var(--red-bright)' }}>Only claim your own group.</strong> The one who claims it must save the secret safely and share it
          with the group. If someone else claimed your group or the secret is lost, contact the developer on{' '}
          <a href="https://discord.gg/xbB2T2Q6A" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>Discord</a> or at{' '}
          <a href="mailto:rs3groupiron@pm.me" style={{ color: 'var(--gold)' }}>rs3groupiron@pm.me</a>.
        </div>
        {players.length > 0 && (
          <label style={{ fontSize: 12 }}>Which character is yours? (optional)
            <select className="form-input" value={rsn} onChange={e => setRsn(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
              <option value="">Select your character</option>
              {players.map(p => <option key={p.id} value={p.rsn}>{p.rsn}</option>)}
            </select>
          </label>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={claim} disabled={busy}>{busy ? 'Claiming...' : 'Claim group and create the secret'}</button>
        </div>
      </div>
    );
  } else if (!canWrite && !newSecret) {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={box}>
          This group is claimed. Enter the group secret to unlock it in this browser. It is the same secret every member types into the
          GIM Companion plugin in RuneScape. Ask the member who claimed the group for it.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => { onClose(); onUnlock(); }}>Unlock with the secret</button>
        </div>
      </div>
    );
  } else {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {newSecret && (
          <div style={{ padding: 14, border: '1px solid var(--gold-dark)', borderRadius: 'var(--radius-lg)', background: 'rgba(200,168,75,0.08)' }}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
              Group claimed. This is your group secret. <strong style={{ color: 'var(--gold)' }}>Save it somewhere safe and share it with your group</strong>:
              only this browser remembers it, and nobody can look it up again.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ flex: 1, fontSize: 18, fontWeight: 700, color: 'var(--gold)', letterSpacing: 2 }}>{newSecret}</code>
              <button className="btn btn-primary btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
        )}
        <ItemsTab players={players} groupId={group?.id} canWrite onToast={onToast} view="setup" />
        {isClaimed && canWrite && <GroupSettings group={group} onChanged={onChanged} onToast={onToast} onOpenWebhook={onOpenWebhook ? () => { onClose(); onOpenWebhook(); } : undefined} />}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && !newSecret && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <span className="modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <RsIcon name="setup" fallback="" size={18} /> {isClaimed || newSecret ? 'Plugin setup' : 'Claim group'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} title="Close">×</button>
        </div>
        <div className="modal-body">{notes && <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>{notes}</div>}{body}</div>
      </div>
    </div>
  );
}
