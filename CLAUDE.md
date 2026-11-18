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
npm test --prefix server       # server tests (node:test), currently 32
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
the Journey, Leaderboards incl. Slayer Kills, group leaderboard and competitions, Manage group, top bar rearrangement, new
activity feed, tour rewritten, Discord notifications with honest test); scale work (hourly hiscores sync for active groups
with back-off, slim `/plugin/state`, gzip, partial heartbeat writes, cached leaderboards, snapshot thinning); plugin cleaned
for release (probes removed, debug off, manifest 1.0.0, `https://api.groupiron.com`, contact rs3groupiron@pm.me); privacy
notice (`docs/privacy.html`); mod.io listing text; deploy files for a fresh server.

**Where things stand (handover, 2026-11-18 evening):**
- GitHub `main` has everything. The release zip `plugin/dist/gim-companion-100.zip` (git-ignored, uploaded to mod.io by hand)
  matches `plugin/gim-companion/` exactly; rebuild it (`plugin\build-release.ps1`) after ANY plugin change. The beta client's
  dev copy is installed (`plugin\install-dev.ps1`, points at localhost:3001).
- Live server (Hetzner, 2.29.193.18, beta.groupiron.com / api.groupiron.com): running, but one deploy behind `main` (it lacks the
  admin "New Group Secret" and the Unlock window help). The owner deploys: `sudo -u gim bash /opt/gim2/deploy/deploy-gim2.sh`.
  No admin login exists there yet: `cd /opt/gim2/server && sudo -u gim env GIM_DATA_DIR=/var/lib/gim2 node scripts/setAdminPassword.js`.
- Real game test (2026-11-18, character Degree C, local dev server): joining with the group secret, sending, kills, drops,
  money pouch (inventory 623), backpack slots and noted items all work. Dev plugins lose their permissions on a client
  restart and the Plugin Hub cannot tick HTTP Access for them ("That permission could not be changed"): use `pon`, `ppr`,
  `ppe gim-companion httpAccess` in the console. For mod.io installs the Hub shows a permissions screen with an HTTP Access
  checkbox (optional, unticked by default); the plugin now waits and starts by itself once it is allowed (untested for a
  real mod.io install until approval).
- Owner decisions today: ONE group secret (OSRS style) used for the website and typed into the plugin; claiming happens in the
  Plugin window; the tour asks New/Existing group; demo data must be clearly labelled "Demo"; existing 1.x groups must keep
  their history and secret when they open the new site.

**Open, in this order:**
1. **Migration rehearsal.** The owner made a consistent snapshot of the 1.x production database on the old server
   (root@178.104.126.158, Hetzner nbg1; app in /var/www/RS3-GIM-Companion, database server/data/gim.db) at /root/gim-1x-copy.db.
   DOWNLOADED 2026-11-18 to server/data/gim-1x-copy.db (385 MB, git-ignored). The owner should still delete /root/gim-1x-copy.db on the old server. Then rehearse on a COPY with `GIM_DATA_DIR` (never the dev database):
   2.0 must start on it and upgrade it; every group opens; old secrets unlock (legacy SHA-256 rows are upgraded on first
   unlock); history shows; clean names with non-breaking spaces and duplicate members. Delete the copy afterwards (player data).
2. **Beta as a labelled preview** (agreed in principle, not built): copy of the 1.x database as beta's database, a banner
   "Preview: a copy of your groupiron.com data from <date>; keep using groupiron.com until launch; changes here are not kept",
   new groups claim on groupiron.com (the secret carries over). At launch a fresh copy replaces beta's data.
3. **Live demo group on beta** (agreed, not built): "Misthalin Five" labelled Demo (name and banner), readable by everyone
   without the secret but read-only (needs a demo flag: reads without auth, all writes and plugin joins refused), left out of
   the hiscores sync and the 30-day cleanup, and a feeder in the server (switched on by a setting) that every ~30 s brings
   members online, XP drops, backpack changes, and now and then a boss kill, drop, clue or activity line.
   `server/scripts/devShowcase.js` already creates the group (refuses NODE_ENV=production: the demo variant must be allowed there).
4. **Pre-launch note** in the Plugin window (not built): "The GIM Companion plugin is waiting for Jagex's approval. Claim your
   group and save the secret now; you'll type it into the plugin on launch day."
5. The owner must read through `main.lua` before submitting (AI policy); offer a section-by-section walkthrough. It changed
   today (join window, permission wait, money pouch, slots, notes).
6. Submit on mod.io (steps and picture list in `plugin/submission/listing.md`); do not change files while Jagex has a freeze on.
7. The 1.x announcement popup change (old repo, local `main`, commit `275b135`, worktree `../GIM-1x-announce`) promotes
   https://beta.groupiron.com. Not pushed, not deployed: the owner decides when.
8. Optional: more slayer creature counters, a cross-group "RuneScape 3 GIM" hiscore page, casket rewards in the clue log
   (needs a plugin change, so a later version).

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
- Until the group is claimed on 2.0, the old secret should still unlock the website for viewing? Owner to decide; default:
  no, the old secret is only accepted by the one-time claim step.

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
