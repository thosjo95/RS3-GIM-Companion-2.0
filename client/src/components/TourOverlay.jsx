import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ── Tour steps ────────────────────────────────────────────────────────────────
// The main tour starts with one question (new or existing group), then the setup steps for that answer, then the
// feature steps. A step with `action` gets a button that clicks its target (opens the claim, unlock or Plugin window);
// the tour then waits as a small floating pill until the player continues it.

const WELCOME_STEP = {
  target: null,
  title: 'Welcome to GIM Companion 2.0',
  body: 'First a quick setup for your group and the game plugin (about five minutes), then a walk through everything the dashboard can do. Is your group new here, or did you already use GIM Companion?',
  choices: [
    { path: 'new',      label: 'New group',      hint: 'First time here' },
    { path: 'existing', label: 'Existing group', hint: 'We used GIM Companion before' },
  ],
  skipLabel: 'Just show me around',
};

// The plugin steps are the same for both answers.
const PLUGIN_STEPS = [
  {
    target: null,
    title: 'Install GIM Companion and type the secret',
    body: 'The plugin reads what the web cannot: bank, group storage, backpack, worn gear, quests, achievements, boss and slayer kills, drops. In the RuneScape client open the plugin browser, search for "GIM Companion", install it and enable it, and allow network access when the game asks. Log in: a GIM Companion window asks for your group secret, the same one that unlocks this website. Type it and press Connect. Every member does this once per computer. The plugin only sends your own character, and only if your character is a member of this group.',
  },
  {
    target: '[data-tour="plugin"]',
    title: 'Check who is connected',
    body: 'Plugin shows the same steps, the group secret (to copy or show to a member), and a dot per member that turns green once their plugin sends data. Disconnect stops one member\'s plugin; it asks for the secret again at their next login.',
    action: 'Open Plugin now',
  },
];

const SETUP_STEPS = {
  new: [
    {
      target: '[data-tour="groups"]',
      title: 'Find or create your group',
      body: 'Open "Find or Manage Groups". Search for your Group Ironman by its name or one of its members to add it to this list, or create a custom group by typing the RuneScape names of your players. Groups you add appear in this menu and are remembered in this browser.',
      action: 'Find my group now',
    },
    {
      target: '[data-tour="lock"]',
      title: 'Claim the group and share the secret',
      body: 'Press Claim group. The Plugin window creates your group secret: save it somewhere safe and share it with your members (on Discord, for example). The secret does two things: everyone unlocks the website with it, and everyone types it into the GIM Companion plugin in the game. Without it the group is read-only, and private things (bank, storage, quests from the game) stay hidden.',
      action: 'Claim now',
      missing: 'Pick your group first (previous step). If the group is already unlocked in this browser, there is nothing to do here.',
    },
    {
      target: '[data-tour="rsn"]',
      title: 'Tell the app which character is yours',
      body: 'Set your character name here. Your player card gets the gold YOU badge, and new goals default to you.',
      action: 'Set my character now',
      missing: 'This button appears once the group is unlocked.',
    },
    ...PLUGIN_STEPS,
  ],
  existing: [
    {
      target: '[data-tour="groups"]',
      title: 'Open your group',
      body: 'Your group and its history (skills, activity, goals, drops, notes) came along from the old site. If it is not in the list on the left yet, open "Find or Manage Groups" and search for its name or one of its members.',
      action: 'Find my group now',
    },
    {
      target: '[data-tour="lock"]',
      title: 'Unlock with your group secret',
      body: 'If your group was claimed before, press Unlock and enter the secret you already have; it still works, and it is also what you type into the plugin. If nobody ever claimed it, press Claim group: the Plugin window creates a secret for you to save and share with your members. Without the secret the group is read-only and private things stay hidden.',
      action: 'Claim or unlock now',
      missing: 'Pick your group first (previous step). If the group is already unlocked in this browser, there is nothing to do here.',
    },
    {
      target: '[data-tour="rsn"]',
      title: 'Tell the app which character is yours',
      body: 'Set your character name here if you have not already. Your player card gets the gold YOU badge, and new goals default to you.',
      action: 'Set my character now',
      missing: 'This button appears once the group is unlocked.',
    },
    ...PLUGIN_STEPS,
  ],
};

const FEATURE_STEPS = [
  // ── The front page ───────────────────────────────────────────────────────
  {
    target: '[data-tour="header-stats"]',
    title: 'The group at a glance',
    body: 'Members, total XP, total levels and how many members earned XP this week. Next to the group name you also see the rank of your group on the official Group Ironman hiscores.',
  },
  {
    target: '[data-tour="members"]',
    title: 'Player cards and the roster',
    body: 'Click a card to focus every page on that player. Click more cards to compare just those players side by side, and click a selected card again to deselect it (nothing selected shows everyone). This is the one player filter for the whole app. Your own card has the YOU badge. For a Group Ironman the member list follows the official hiscores and new members are added automatically every night. The Plugin window (top right, unlocked groups) lists the members: add a character by hand (how you build a custom group), correct a character name, or remove a member.',
  },
  {
    target: '[data-tour="inspect"]',
    title: 'Inspect a player',
    body: 'The magnifying glass opens a floating panel with the player\'s backpack, worn equipment and skills, live while they play and as last seen after logout. Hover a skill for its XP, the XP to the next level and the remainder.',
  },
  {
    target: '[data-tour="drops-chest"]',
    title: 'Drops chest and Goals',
    body: 'The chest lists the group\'s recent big drops from the Adventurer\'s Log and the plugin. When a new drop arrives that you have not looked at, the chest glows. The Goals tile shows your active goals and lets you add one; it glows when someone adds a new goal.',
  },
  {
    target: '[data-tour="drops-chest"]',
    title: 'Group Leaderboard and competitions',
    body: 'The Leaderboard tile (trophy) opens a panel to see who gained the most XP, levels, quest points, boss kills, slayer kills or drops over the last day, week or month. Press + New competition to set up your own race: pick what to track (for example 50 Araxxi kills), when it starts and ends, and an optional goal. Ready-made presets help you start.',
  },
  // ── The tabs ─────────────────────────────────────────────────────────────
  {
    target: '[data-tour="tab-vault"]',
    title: 'Group Vault',
    body: 'Players banks shows every item with who has it banked and how many, with real item icons (cards, tiles or list). Group Storage shows the shared storage, and the Bank Journal lists everything put into or taken out of it, and by whom. Needs the plugin and an unlocked group.',
  },
  {
    target: '[data-tour="tab-goals"]',
    title: 'Goals',
    body: 'A planning board with 280 suggestions plus your own goals. Goals the players already achieved are ticked off automatically from the game (levels, quests, area tasks, boss kills) and show live progress. "Recommended next" suggests what to do next based on what the game says you can start or have not tried.',
  },
  {
    target: '[data-tour="tab-achievements"]',
    title: 'Quests and Tasks',
    body: 'Quests read live from the game, the area task grid filled in automatically, and the Group Ironman Journey: which tier your group is on and what is left in each step.',
  },
  {
    target: '[data-tour="tab-leaderboards"]',
    title: 'Leaderboards',
    body: 'Firsts (who did something first), milestones, exact boss kills from the game, slayer kills, clue scrolls and skill mastery per player.',
  },
  {
    target: '[data-tour="notes"]',
    title: 'Group notes',
    body: 'A shared pinboard for the whole group: loot rules, plans, reminders. It saves as you type.',
  },
  {
    target: '[data-tour="sync"]',
    title: 'Sync All',
    body: 'Fetches the latest hiscores for every member. The plugin sends its own data automatically while the game is running.',
  },
  {
    target: null,
    title: 'You are set',
    body: 'That is everything. If something looks empty, it usually just needs the plugin to run for a minute. The documentation site covers the plugin setup in detail, and the ? button replays this tour (or the tour of the page you are on).',
  },
];

// The tour usually opens with a group already on screen (the claim/unlock or character button shows that): then the
// "find your group" step is skipped and the setup starts at claiming or unlocking.
function groupIsOpen() {
  return !!document.querySelector('[data-tour="lock"], [data-tour="rsn"]');
}
function mainTour(path, groupOpen) {
  const setup = (SETUP_STEPS[path] || []).filter(s => !(groupOpen && s.target === '[data-tour="groups"]'));
  return [WELCOME_STEP, ...setup, ...FEATURE_STEPS];
}

const PAD  = 10;
const TT_W = 360;
const TT_H = 230; // conservative tooltip height for placement math

export default function TourOverlay({ steps: stepsProp, onComplete }) {
  const [path, setPath]           = useState(null);    // 'new' | 'existing' | null (main tour only)
  const [groupOpen, setGroupOpen] = useState(false);  // decided once, when the answer is chosen, so the list never shifts mid-tour
  const steps = stepsProp ?? mainTour(path, groupOpen);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect]           = useState(null);
  const [paused, setPaused]       = useState(false);   // true while a window opened by an action button is in use

  const step     = steps[stepIndex];
  const isFirst  = stepIndex === 0;
  const isLast   = stepIndex === steps.length - 1;

  // ── Measure target element ────────────────────────────────────────────────
  useEffect(() => {
    if (!step.target) { setRect(null); return; }

    function measure() {
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right });
      } else {
        setRect(null);
      }
    }

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [stepIndex, path, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tooltip placement ─────────────────────────────────────────────────────
  function tooltipPos() {
    if (!rect) {
      return { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: TT_W };
    }
    const vH = window.innerHeight;
    const vW = window.innerWidth;

    const below = rect.bottom + 14 + TT_H < vH;
    let top = below
      ? rect.bottom + PAD + 14
      : Math.max(8, rect.top - PAD - 14 - TT_H);
    top = Math.min(top, vH - TT_H - 12);

    let left = rect.left + rect.width / 2 - TT_W / 2;
    left = Math.max(12, Math.min(vW - TT_W - 12, left));

    return { top, left, width: TT_W };
  }

  function arrowEl() {
    if (!rect) return null;
    const below = rect.bottom + 14 + TT_H < window.innerHeight;
    const base  = { position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, border: '7px solid transparent' };
    return below
      ? <div style={{ ...base, top: -14,   borderBottomColor: '#7a5c1e', borderTop:    'none' }} />
      : <div style={{ ...base, bottom: -14, borderTopColor:   '#7a5c1e', borderBottom: 'none' }} />;
  }

  const pos = tooltipPos();
  const targetExists = !!(step.target && document.querySelector(step.target));

  function choose(choice) {
    setGroupOpen(groupIsOpen());
    setPath(choice);
    setStepIndex(1);
  }
  function skipSetup() {
    setPath(null);
    setStepIndex(1);                    // without a path the next step is the first feature step
  }
  // Hide the tour, open the window behind the highlighted button, and wait for the player to continue.
  function runAction() {
    const el = step.target && document.querySelector(step.target);
    if (!el) return;
    setPaused(true);
    setTimeout(() => el.click(), 0);
  }
  function resume() {
    setPaused(false);
    if (!isLast) setStepIndex(s => s + 1);
  }

  const goldBtn = { padding:'7px 18px', fontSize:13, fontWeight:700, background:'var(--gold)', color:'#111', border:'none', borderRadius:'var(--radius)', cursor:'pointer' };
  const quietBtn = { padding:'7px 14px', fontSize:12, fontWeight:600, background:'transparent', border:'1px solid var(--border)', borderRadius:'var(--radius)', color:'var(--text-dim)', cursor:'pointer' };

  // While paused only a small pill floats in the corner, so the window the player opened can be used.
  if (paused) {
    return createPortal(
      <div style={{ position:'fixed', zIndex:2147483647, right:20, bottom:20, display:'flex', alignItems:'center', gap:10,
                    background:'var(--bg-panel)', border:'1px solid var(--gold-dark)', borderRadius:'var(--radius-lg)',
                    padding:'10px 12px 10px 16px', boxShadow:'0 8px 32px rgba(0,0,0,0.6)' }}>
        <span style={{ fontSize:12, color:'var(--text-dim)' }}>Done here?</span>
        <button type="button" onClick={resume} style={goldBtn}>{isLast ? 'Finish the tour' : 'Continue the tour'}</button>
        <button type="button" onClick={onComplete} style={{ ...quietBtn, border:'none', padding:'4px 6px' }}>End</button>
      </div>,
      document.body
    );
  }

  // ── Render via portal so we're completely outside the app's stacking context
  return createPortal(
    <>
      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      {rect ? (
        <>
          <div onClick={onComplete} style={{ position:'fixed', inset:0, zIndex:2147483640, pointerEvents:'none' }} />
          <div onClick={onComplete} style={{ position:'fixed', zIndex:2147483641, top:0, left:0, right:0, height:Math.max(0,rect.top-PAD), background:'rgba(0,0,0,0.72)', cursor:'default' }} />
          <div onClick={onComplete} style={{ position:'fixed', zIndex:2147483641, top:rect.bottom+PAD, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.72)', cursor:'default' }} />
          <div onClick={onComplete} style={{ position:'fixed', zIndex:2147483641, top:rect.top-PAD, left:0, width:Math.max(0,rect.left-PAD), height:rect.height+PAD*2, background:'rgba(0,0,0,0.72)', cursor:'default' }} />
          <div onClick={onComplete} style={{ position:'fixed', zIndex:2147483641, top:rect.top-PAD, left:rect.right+PAD, right:0, height:rect.height+PAD*2, background:'rgba(0,0,0,0.72)', cursor:'default' }} />
          {/* Gold spotlight ring */}
          <div style={{ position:'fixed', zIndex:2147483641, pointerEvents:'none', top:rect.top-PAD, left:rect.left-PAD, width:rect.width+PAD*2, height:rect.height+PAD*2, border:'2px solid var(--gold)', borderRadius:8, boxShadow:'0 0 0 3px rgba(200,168,75,0.2), 0 0 24px rgba(200,168,75,0.35)' }} />
        </>
      ) : (
        <div onClick={onComplete} style={{ position:'fixed', zIndex:2147483641, inset:0, background:'rgba(0,0,0,0.78)', cursor:'default' }} />
      )}

      {/* ── Tooltip ──────────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          zIndex: 2147483647, // max z-index
          ...pos,
          background: 'var(--bg-panel)',
          border: '1px solid var(--gold-dark)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 22px 16px',
          boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
          fontFamily: 'inherit',
        }}
      >
        {arrowEl()}

        {/* Step counter */}
        <div style={{ fontSize:10, color:'var(--text-dim)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.8px', fontWeight:600 }}>
          Step {stepIndex + 1} of {steps.length}
        </div>

        {/* Title */}
        <div style={{ fontWeight:700, fontSize:15, color:'var(--gold)', marginBottom:8, lineHeight:1.3 }}>
          {step.title}
        </div>

        {/* Body */}
        <div style={{ fontSize:13, color:'var(--text-dim)', lineHeight:1.65, marginBottom:16 }}>
          {step.body}
        </div>

        {/* First page: new or existing group */}
        {step.choices && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
            {step.choices.map(c => (
              <button key={c.path} type="button" onClick={() => choose(c.path)}
                style={{ textAlign:'left', padding:'10px 12px', cursor:'pointer', borderRadius:'var(--radius)',
                         background:'rgba(200,168,75,0.10)', border:'1px solid rgba(200,168,75,0.45)', fontFamily:'inherit' }}>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--gold)' }}>{c.label}</div>
                <div style={{ fontSize:11, color:'var(--text-dim)', marginTop:2 }}>{c.hint}</div>
              </button>
            ))}
          </div>
        )}

        {/* "Do it now": opens the window behind the highlighted button */}
        {step.action && targetExists && (
          <button type="button" onClick={runAction} style={{ ...goldBtn, width:'100%', marginBottom:14 }}>
            {step.action}
          </button>
        )}
        {step.action && !targetExists && step.missing && (
          <div style={{ fontSize:12, color:'var(--text-dim)', fontStyle:'italic', marginBottom:14 }}>{step.missing}</div>
        )}

        {/* Progress dots */}
        <div style={{ display:'flex', gap:5, marginBottom:14, alignItems:'center' }}>
          {steps.map((_, i) => (
            <div
              key={i}
              onClick={() => setStepIndex(i)}
              style={{
                width: i === stepIndex ? 16 : 6,
                height: 6, borderRadius: 3, flexShrink: 0,
                background: i === stepIndex ? 'var(--gold)' : i < stepIndex ? 'var(--gold-dark)' : 'var(--border)',
                transition: 'all 0.2s', cursor: 'pointer',
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <button
            type="button"
            onClick={onComplete}
            style={{ background:'none', border:'none', color:'var(--text-dim)', cursor:'pointer', fontSize:12, padding:'4px 0' }}>
            Skip tour
          </button>
          <div style={{ display:'flex', gap:8 }}>
            {!isFirst && (
              <button
                type="button"
                onClick={() => setStepIndex(s => s - 1)}
                style={{ padding:'7px 14px', fontSize:12, fontWeight:600, background:'transparent', border:'1px solid var(--border)', borderRadius:'var(--radius)', color:'var(--text-dim)', cursor:'pointer' }}>
                Back
              </button>
            )}
            {step.choices ? (
              <button type="button" onClick={skipSetup} style={quietBtn}>
                {step.skipLabel || 'Next'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => isLast ? onComplete() : setStepIndex(s => s + 1)}
                style={goldBtn}>
                {isLast ? 'Done' : 'Next'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
