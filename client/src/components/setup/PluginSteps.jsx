import React from 'react';
import { usePreview, useConfig } from '../PreviewBanner';

// 2.0: the in-game part of "Your group is ready" (components/setup/GroupReady.jsx). The 1.x copy of this file shows nothing.
export const PLUGIN_MESSAGE = 'In RuneScape: install the GIM Companion plugin, log in and type the same secret into its window.';

export default function PluginSteps({ num, step }) {
  const preview = usePreview();
  const config = useConfig();
  return (
    <div>
      <div className="gr-label">What every member does in the game</div>
      {config && !config.plugin_live && (
        <div className="gr-note">
          The GIM Companion plugin is waiting for Jagex's approval. Save the secret now: on launch day every member types it into the plugin.
        </div>
      )}
      {preview && (
        <div className="gr-note">
          This is the preview: a secret made here is only for trying it out and is not kept. Claim your group again on launch day.
        </div>
      )}
      <div style={{ fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={step}><span style={num}>1</span><span>In the RuneScape client open the plugin browser, search for <strong>GIM Companion</strong>, install it and enable it. Allow network access when the game asks.</span></div>
        <div style={step}><span style={num}>2</span><span>Log in. A <strong>GIM Companion</strong> window asks for the group secret. Type it and press <strong>Connect</strong>.</span></div>
        <div style={step}><span style={num}>3</span><span>Done. The plugin now sends that character's bank, backpack, kills, drops and more to the group. Each member does this once per computer.</span></div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
        The plugin only sends the logged-in character's own data, and only for members of this group. The Plugin window in the top bar
        shows who is connected.
      </div>
    </div>
  );
}
