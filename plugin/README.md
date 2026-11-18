# GIM Companion — in-game plugin (GIM 2.0)

A Lua plugin for the RuneScape 3 client that sends **your own character's** skills, backpack, worn items, bank,
group storage, position, quest progress, kill counts and notable drops to your group's dashboard. It never sends anything about other players and never sends actions
back into the game.

> **Status: second draft, not yet run in the game.** The API names (skills, inventories, worn items, bank, group
> storage, position, events, HTTP) now follow what working RS3 plugins use, so the first beta run should mostly
> work. It reads only; every read is wrapped in `pcall` so one wrong name cannot crash the plugin.

## How the pieces fit

```
RuneScape client ──(Lua plugin, HTTP POST, per-player token)──▶ /api/plugin/ingest ──▶ database ──▶ Items / Bank ledger tabs
```

* A **token** belongs to one player and can only submit that player's data. Create it in the dashboard:
  *Items → Plugin setup → Connect*. It is shown once; only a hash is stored.
* The group secret never goes into the plugin.

## Try it without the game (tested)

```bash
npm install --prefix plugin
npm test --prefix plugin      # runs main.lua against a MOCKED RuneScape API and feeds the output to the real server
npm test --prefix server      # API tests (auth, validation, isolation, ledger)
node server/scripts/devDemo.js   # demo group with fake data for the Items tab (dev database only)
npm run dev                   # API :3001 + UI :5173
```

The mock test proves the plugin's logic and wire format. It **cannot** prove the real API's member names —
that is what the beta client is for.

## Running it in the RuneScape beta client

Official guide: <https://developer.runescape.com/rs/tutorial/1helloworld.html>

1. Launch the **beta** from the Jagex Launcher (the beta link is in the tutorial), log in, click **import save**
   in the lobby (allowed once per hour), then close and relaunch normally once. This creates
   `C:\ProgramData\Jagex\RuneScape-BETA`.
2. Start the dev server (`npm run dev`), open the app, unlock your group, and create a token
   (*Items → Plugin setup*).
3. Install the plugin: `powershell -File plugin\install-dev.ps1`, then paste your token into the
   `config.lua` it creates (`dev_plugins\gim-companion\config.lua`).
4. Start the beta client and log in. Press **ALT + the key under Esc** to open the console and run:
   `prf` (refresh list) → `pon gim-companion` (enable). After edits: re-run the install script and `prl gim-companion`.
5. Read the console. Lines starting with `[GIM]` report what was found; `TODO(beta)` lines list API names to fix.

The plugin talks to `http://localhost:3001` (see `urls` in `plugin.json`). Whether the client allows plain
`http://localhost` is one of the open questions — if requests fail, the console says why.

## Still to confirm in the beta client

| Question | Where |
|---|---|
| Is plain HTTP to localhost allowed? (HTTPS is needed for the real site) | `plugin.json` urls |
| Do the group-storage inventory and window names behave as expected? | `STORES` in `main.lua` |
| `GetLevelGameplay` vs boosted level for the dashboard skill level | `readSkills` |
| Quests: does `config.Quest.FromID` return every quest, and are `name` / `hasFinishedQuest` right? | `sweepQuests` |
| Kills: does the target overlay text (`TOPLEVEL_V2_TARGET_INFO__NAME`) match the NPC's `displayName`? Multi-NPC bosses (Barrows, Dagannoth Kings, Vorago phases ...) | `onNpcRemoved` |
| Drops: `ObjStackEntityAdded` `isOwner` + distance to the kill; auto-loot via backpack comparison | `onGroundItem`, `scanBackpack` |
| Not built: HP / prayer / adrenaline, target health for the dashboard | later |

## Submitting to mod.io later (checklist from the official guide)

* Real contact email in `plugin.json` (a separate address is "strongly recommended").
* Listing sections: email, feedback/collaboration, the exact Jagex EULA statement, what each permission is
  used for, and data protection.
* Data protection: the server is in Germany (EU) → UK-adequate → **case 2**: list endpoints and security
  measures and provide a privacy notice (ICO template tool).
* `httpAccess` makes the plugin "subject to review"; document why in plain language.
* Code must be readable and commented; "unvetted AI generation" is grounds for rejection, so every line
  must be reviewed and understood by the person submitting it.
* Production `urls` must point at the real site (`https://groupiron.com`), not localhost.
