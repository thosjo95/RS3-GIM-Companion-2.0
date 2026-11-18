import React from 'react';
import ItemsTab from './ItemsTab';
import RsIcon from './RsIcon';

// "Plugin setup" lives in the top bar (next to Docs / Discord) because it is about the group's connection to the
// game, not about any one page: it explains how members connect the plugin with the group secret and shows whether
// each member's plugin has been heard from.
export default function PluginSetupModal({ group, canWrite, onClose, onToast }) {
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <span className="modal-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <RsIcon name="setup" fallback="🔌" size={18} /> Plugin setup
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <ItemsTab players={group?.players ?? []} groupId={group?.id} canWrite={canWrite} onToast={onToast} view="setup" />
        </div>
      </div>
    </div>
  );
}
