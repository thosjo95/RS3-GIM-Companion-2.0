# GIM Companion 2.0: project guide and handover

Read this first. It says what the project is, how to run it, what is finished, what is open and how the owner likes to work.

## What it is

A dashboard for RuneScape 3 **Group Ironman** teams plus a **Lua plugin** for the official RS3 plugin system.
1.x (the live site at groupiron.com, a separate older codebase) tracks groups from public hiscores and the Adventurer's Log.
**2.0** keeps that dashboard and adds a plugin that reads the game itself (bank, group storage, quests, achievements,
Journey, exact boss kills, drops, who is online). 2.0 is not released: **1.x stays on production until Jagex approves the
plugin**, then groups are migrated (see "Migration" below). Never touch or deploy to production; the owner does deploys.

Repo: https://github.com/thosjo95/RS3-GIM-Companion-2.0 (public, MIT). Local branch `gim-2.0`; push with
`git push gim2 gim-2.0:main`. The remote `origin` is the old 1.x repo and is left alone. Commit messages end with the
Co-Authored-By line the harness asks for.

## Layout and commands

| Folder | What |
|---|---|
| `server/` | Express 4 + the built-in `node:sqlite` (Node 22+). `index.js`, `routes/`, `services/`, `database.js` (schema and migrations), `test/` |
| `client/` | React + Vite dashboard (`src/components`, `src/api/client.js`) |
| `plugin/gim-companion/` | the Lua plugin: `main.lua` (about 1,150 lines, numbered sections), `json.lua`, `plugin.json`, `config.example.lua` |
| `plugin/test/` | mocked-game tests (`e2e.js`, `pairing.js`, `mock.lua`) using fengari |
| `plugin/submission/listing.md` | text for the mod.io listing |
| `deploy/` | nginx, PM2, bootstrap and deploy scripts for the new server |
| `docs/` | GitHub Pages site (`index.html`, `privacy.html`) |

```bash
npm run install:all            # once
npm run dev                    # API :3001 + UI :5173
npm test --prefix server       # server tests (node:test), currently 62
npm test --prefix plugin       # plugin against the mocked game API
cd client && npx vite build    # must build cleanly before every commit
node server/scripts/devDemo.js # demo group with fake data (dev database only)
powershell -File plugin\install-dev.ps1     # copy the plugin to the RS3 BETA client, pointed at localhost
powershell -File plugin\build-release.ps1   # release zip: plugin\dist\gim-companion-100.zip
```
`GIM_DATA_DIR` points the server at another database folder (tests and rehearsals use it). The dev server auto-restarts;
if port 3001 stays busy after a restart, kill the old node process.

## How data flows

Plugin (Lua, in the game) -> `POST /api/plugin/ingest` with a per-player key (`gimp_...`, only a hash stored) ->
`player_live_state`, `player_quests`, `player_achievements`, `player_boss_kills`, `player_kill_vars`, `storage_ledger`, `drops`.
Public data comes from hiscores and the Adventurer's Log (`services/runescape.js`, `hiscoresSync.js`, `activitySync.js`).
Reads of private data need the group secret (`utils/auth.js checkGroupAuth`); hiscores-derived data is public.
Important services: `goalTracker.js` (auto-completes goals, progress), `recommendations.js`, `metrics.js` (snapshots, gains,
competitions), `gimRank.js` (rank on the official Group Ironman hiscores), `slayerKills.js` (only 8 creature counters matched
so far), `itemIndex.js` (item name to id), `discord.js` (webhooks).

**Connecting the plugin (owner's choice, like the OSRS Group Ironmen tracker):** players only ever use ONE thing, the group
secret (`XXXX-XXXX-XXXX`, made when the group is claimed; it also unlocks the website). The plugin shows a window with an
Input Field, the player types the secret, and the plugin sends it once with the character name to `POST /api/plugin/join`.
The server checks that the character is a member of a claimed group with that secret and returns a per-character key, which
the plugin keeps in `PersistentDB` (per character) instead of the secret. Several computers per character are allowed;
"Disconnect" in the website's Plugin window revokes all of a member's keys. `config.lua` may hold `groupSecret` instead of
typing it. The old link-code flow and the website's manual tokens were removed (`POST /tokens` stays for tests). The masked
Input Field modes return no text to Lua, so the box shows what is typed. The window is **untested in the real client**.

## Plugin rules (Jagex) and lessons from the beta client

Guidelines: developer.runescape.com/rs/submission/guidelines.html and /process.html. Key points: never export information
about other players; code must be readable and commented; `httpAccess` is reviewed; AI-written code is allowed only if the
submitter personally reviews and understands it; no prohibited automation. API lessons: `HTTPRequest.new` must be called
inside a Lua function (never `pcall(HTTPRequest.new, ...)`, it crashes the client); there is no `os` library; the second
callback of `Post/Get` is download progress, not failure; `prf` resets permissions; `PersistentDB` is per plugin and
device, not per character (keys include the character name).

## State of the work (Nov 2026)

**Done and pushed:** server API with plugin ingest and keys; joining with the group secret; listing image; docs updated; live XP drops (`xp_drops`, Live XP tile, drops floating over the cards); boss log with drops and clue log (`progress_log`, services/progressLog.js); clues as a leaderboard/competition metric; backpack slot by slot, noted items (`note_of`), money pouch (`money_pouch`, K/M/B display); claiming moved into the Plugin window (ClaimModal removed; "Claim group" opens PluginSetupModal); tour opens once per group and per browser and starts with New/Existing group; gallery screenshots in `plugin/submission/gallery/` made from the fictional group of `node server/scripts/devShowcase.js` (secret SHOW-CASE-2026); dashboard (player cards with inspect panel for
backpack/equipment/skills, online indicator, Drops chest, Leaderboard and Goals tiles as floating panels, Group Stats grid,
Group Vault with banks and group storage and Bank Journal, Goals with auto-tracking and recommendations, Quests and Tasks with
the Journey, Leaderboards incl. Slayer Kills, group leaderboard and competitions, members in the Plugin window, top bar rearrangement, new
activity feed, tour rewritten, Discord notifications with honest test); scale work (hourly hiscores sync for active groups
with back-off, slim `/plugin/state`, gzip, partial heartbeat writes, cached leaderboards, snapshot thinning); plugin cleaned
for release (probes removed, debug off, manifest 1.0.0, `https://api.groupiron.com`, contact rs3groupiron@pm.me); privacy
notice (`docs/privacy.html`); mod.io listing text; deploy files for a fresh server.

**Where things stand (end of session, 2026-11-18 night):**
- GitHub `main` has everything (last commit of the session: the demo backpack fix). The release zip `plugin/dist/gim-companion-100.zip`
  (git-ignored, uploaded to mod.io by hand) matches `plugin/gim-companion/`; NO plugin file changed this session. Rebuild it
  (`plugin\build-release.ps1`) after ANY plugin change.
- Beta (Hetzner, 2.29.193.18, beta.groupiron.com / api.groupiron.com) runs the migrated COPY of the 1.x database (299 groups,
  copied 18 Nov 2026) with the Preview banner and the live demo group. Server switches are in `/var/lib/gim2/extra-env.json`
  (`GIM_PREVIEW`, `GIM_PREVIEW_COPIED`, `GIM_DEMO`; later `GIM_PLUGIN_LIVE`). The owner deploys:
  `sudo -u gim bash /opt/gim2/deploy/deploy-gim2.sh` (a restart after changing extra-env.json: `pm2 delete gim2` then `pm2 start deploy/ecosystem.gim2.config.js`).
  The owner's 1.x announcement popup (old repo, `main`, 577a25f) is pushed; deploying it to groupiron.com is the owner's step.
- Real game test (2026-11-18, character Degree C, local dev server): join with the group secret, sending, kills, drops, money pouch,
  backpack slots and noted items all work. Dev plugins lose their permissions on a client restart: use `pon`, `ppr`,
  `ppe gim-companion httpAccess` in the console. The mod.io permission screen is untested until approval.
- Owner decisions: ONE group secret (OSRS style) for website and plugin; claiming happens in the Plugin window; every 1.x group gets a NEW
  secret on 2.0 (old secret once, `claimed_v2_at` tracks adoption); demo data clearly labelled "Demo"; the Plugin window holds the members
  (add, rename, remove), the group settings and the Discord webhook.
- Not verified by a human on beta yet: the claim-v2 window with a REAL old secret (only simulated hashes were tested), the group settings
  window, Members section, and the demo group after the last rebuild.

**Open, in this order:**
1. **Retention decision.** The 30-day cleanup cron fails on a foreign key (players.group_id has no cascade), so stale groups are never
   deleted although the privacy notice and listing say 30 days. Fix the cron (delete players first, like the admin tool) or change the wording.
2. The owner must read through `main.lua` before submitting (AI policy); offer a section-by-section walkthrough.
3. Submit on mod.io (steps and picture list in `plugin/submission/listing.md`); do not change files while Jagex has a freeze on.
4. After approval: final migration (`migrate1x.js --assume-1x --drop-loadouts --apply` on a fresh copy), point groupiron.com at the new server
   (api.groupiron.com NEVER changes), set `GIM_PLUGIN_LIVE=1`, drop `GIM_PREVIEW`, check the real mod.io permission screen, change the listing
   link from beta.groupiron.com to groupiron.com. The 1.x announcement text already says groupiron.com will switch by itself.
5. Optional: more slayer creature counters, a cross-group "RuneScape 3 GIM" hiscore page, casket rewards in the clue log (needs a plugin change),
   delete the loose 1.x copies (`/root/gim-1x-copy.db` on the old server, `server/data/gim-1x-copy.db`, `C:\gim-beta`) when no longer needed.

**Done 2026-11-18 (after the handover):** admin portal cleaned for the new server (review queue, audit log and wiki scan removed: 0 submissions ever; reseed and table browser kept because goals/recommendations read the rs3_* tables; `server/test/admin.test.js`). Preview mode: server env `GIM_PREVIEW=1` + `GIM_PREVIEW_COPIED` show a floating "Preview" banner and a trial note in the claim window; `GIM_PLUGIN_LIVE=1` (launch day) removes the "waiting for Jagex's approval" note (step 4 of Open). Env lines are in `deploy/ecosystem.gim2.config.js` (commented out). NOT yet done: loading the 1.x copy on beta (owner step, below) and the Demo group.

**Demo group (built 2026-11-18, step 4):** "Misthalin Five (Demo)", `groups.is_demo = 1`. `services/demoGroup.js` builds it from `services/demoTemplate.json` (game definitions exported from a real character with `scripts/exportDemoTemplate.js`) and a feeder changes something every 30 s (XP drops, backpack, boss kills, drops, clues, activity lines; 3 members always online). Server switch: `"GIM_DEMO":"1"` in `/var/lib/gim2/extra-env.json`; the server then builds the group itself if missing. Read-only for everyone: `checkGroupAuth` lets GETs through and refuses everything else with 403 `demo:true`; no claim, no plugin join, skipped by the hiscores sync, the 2-hour cron, the three public sync endpoints and the cleanup. `scripts/devShowcase.js` now only builds it in the dev database (no secret any more). Tests: `server/test/demo.test.js`. Client: demo banner, no Unlock/Plugin/Sync buttons. Also: the global 401 handler no longer opens the Unlock window for plain reads (guests browsing someone else's group), only for write attempts.

**Group settings (2026-11-18):** Plugin window > Group settings (shown for every claimed, unlocked group; the Members section with add player / edit name / remove sits above it, and the Discord webhook form is inside it; the old "+" button and Manage group window are gone). `groups.drop_min_value` (smallest drop, utils/dropRules.js) and `groups.settings_json` (utils/groupSettings.js: Live XP minimum, Bank Journal minimum, boss minimum kills, clue tiers, online minutes, unlisted) via `PUT /api/groups/:id/settings` (secret needed). Applied on the server when reading (plugin.js xp-drops, ledger, progress-log, presence; groups.js search and list). `GET /api/groups?ids=` keeps unlisted groups visible to browsers that saved them. Tests: dropmin.test.js, settings.test.js. No plugin change.

**Putting the 1.x copy on beta (owner runs this on the new server):** copy the 1.x database to a scratch folder, `GIM_DATA_DIR=<scratch> node server/scripts/migrate1x.js --assume-1x --drop-loadouts --apply`, stop PM2, replace `/var/lib/gim2/gim.db` (keep a backup, and keep `jwt_secret.bin` and the admin user: re-run setAdminPassword.js), create /var/lib/gim2/extra-env.json with the GIM_PREVIEW settings (see ecosystem.gim2.config.js), `pm2 restart gim2 --update-env`. Note beta's current database (plugin tests, Degree C) is then replaced.

**Later on 2026-11-21 (after the notes above):** Area Tasks are region cards with lodestone icons and are read-only in 2.0 (the server answers 410 to manual marks; old marks still show). Skill hover box: `client/src/components/overview/SkillTip.jsx`. Exact per-skill maximum levels: `SKILL_CAPS` in `client/src/lib/rs3.js` (from the RuneScape Wiki: 120 / 110 / 99, shown as /110 or /120). `GameIcon.jsx` tries several spellings of item and boss names. Phone-width fixes: the top-bar buttons scroll inside the bar. **1.x (old repo RS3-GIM-Companion, branch `main`, worktree ../GIM-1x-announce) got the same UI:** official RuneScape icons, region cards (manual marking kept), modern skill grid, activity feed, hover box, group info and real rank in the top bar, item and boss pictures; plus two read-only server routes (item ids, group rank). Data and functions unchanged. Deploy 1.x on the old server with `bash /root/deploy.sh` (git pull, vite build, pm2 restart). Not yet done: server milestones and Discord only fire at 99 and 120 (110-cap skills never get one); the retention decision; the main.lua walkthrough resumes at part 4 (quests, achievements, kill tracker); delete the loose copies of the 1.x database (`/root/gim-beta.db` and `/root/gim-1x-copy.db` on the new server, `C:\gim-beta` on the PC).

**Global Leaderboard (2026-11-22, both versions):** sidebar "Everyone > Global Leaderboard", also `/#global` and a button on the
first-visit screen. `GET /api/global/stats` (`services/globalStats.js`, cached 10 min): groups tracked/active, XP gained (week/month from
snapshots), group and player rankings, most trained skills, boss kills / drops / 99s and 120s from the Adventurer's Log, newest groups,
mode and size split. Names come ONLY from public data. 2.0 adds a "Live from the plugin" strip with anonymous totals only (online now,
boss kills, clues, drops and their value, achievements); never per group or player, because plugin data is private (privacy.html says so).
The demo group is left out; unlisted groups count in totals but are never named. A Mode/Size filter at the top applies to every
board (the server sends numbers per group, and XP per skill / boss kills per mode+size "bucket"); the plugin strip is never filtered.
`services/globalStats.js` and `GlobalLeaderboard.jsx` are the SAME file in both repos (2.0 parts switch on by table/column checks): copy, do not fork.
Tests: `server/test/global.test.js`.

## Migration (do not start before approval)

All existing 1.x groups and the history that is still useful move to 2.0 at cut-over: daily `snapshots`, `player_activities`,
`player_skill_milestones`, `manual_firsts`, `drops`, `goals`/`goal_contributors`, `item_requests`, `group_notes`,
`achievements` (manual marks matter for members without the plugin), `boss_kills`/`boss_kill_log`, group claims
(`password_hash`/`password_salt`), Discord webhooks. Drop `equipment_loadouts`. Plan: schema is additive, so back up the 1.x
database, rehearse on a copy (`GIM_DATA_DIR`), clean names containing non-breaking spaces and duplicate members, then start 2.0
on the final copy and repoint `groupiron.com` at the new server (keep `api.groupiron.com` unchanged forever: it is in the plugin
manifest). 2.0 has never been run against a real 1.x database.

**Owner decision (2026-11-18): every group gets a NEW secret on 2.0, and adoption is tracked.** Design agreed (not built):
- Add a column `groups.claimed_v2_at` (null after migration). It is set when a group is claimed or re-keyed on 2.0. The admin
  group list shows it, so the owner can see which groups came over and when.
- Group that had a 1.x secret: shown as "not claimed on the new version yet". Claiming (in the Plugin window) asks for the
  OLD secret once, then creates a new secret at once (shown once, "save it and share it") and the old one stops working.
  This keeps the history safe from strangers: clearing all secrets outright would let anyone claim a group with its history.
- Group that never had a secret: open claim as today. Lost old secret: the owner checks membership and uses the admin
  tool "New Group Secret" (that also sets `claimed_v2_at`).
- Claim window text for migrated groups: "Your group came over from groupiron.com with all its history. Enter your old
  secret once; you get a new one for the new version and the plugin."
- Until the group is claimed on 2.0 the old secret unlocks nothing: it is only accepted by the one-time claim step (built, tested).

## Working with the owner

- Wants things that look polished and consistent; **official RuneScape icons/images**, no emoji icons in the UI or docs; panels
  that float over the page instead of pushing content down; one global player filter (the player cards at the top).
- Explain briefly and plainly; say honestly what was not verified (for example anything that needs the real game client).
- Do not publish, push settings changes or deploy without being asked. Pushing commits to the 2.0 repo has been standing practice.
- The owner cannot be reached by SSH from here; server steps are written as commands for the owner to run.
- The Vite dev server can miss a file change on Windows (it then serves a half-edited module). If the page shows old behaviour, `touch` the changed files in client/src. Grid columns use `minmax(0, 1fr)` so long lines cannot push the page wider than the screen.
- Shell tips on this Windows machine: heredocs with quotes or backslashes break; write patch scripts with the Write tool and run
  them with node. After server code changes restart the dev API server.
- Names: RuneScape hiscores write names with a non-breaking space; always compare names after replacing `\s` with a normal space.

## Migration rehearsal result (2026-11-18, on a COPY of the 1.x database)

- 2.0 starts on the 1.x copy and upgrades it; every group opens, history intact (checked on a 5-member group: skills, snapshots, activities, goals identical before and after a claim).
- `server/scripts/migrate1x.js` (dry run by default; `--apply`, `--assume-1x`, `--drop-loadouts`) removes orphan rows, writes names with plain spaces, flags groups that have a 1.x secret as `needs_rekey`. For the real migration run it on the final copy with `--assume-1x --apply`.
- Built: `groups.claimed_v2_at` + `needs_rekey`, `POST /api/groups/:id/claim-v2` (old secret once, new secret back, old one dead), Plugin-window claim UI, admin "On 2.0" column and counters. Old secrets unlock nothing until claimed. 40 server tests.
- NOT verified: real legacy SHA-256 secrets (only simulated ones); the claim UI in a browser on a migrated copy.
- Open owner decision: the 30-day cleanup cron fails on a foreign key (players.group_id has no cascade), so stale groups (276 in the copy) are never deleted although the privacy notice and listing say 30 days. Decide: fix the cron or change the wording.
