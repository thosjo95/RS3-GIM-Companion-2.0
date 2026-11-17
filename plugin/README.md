# GIM Companion — in-game plugin (GIM 2.0)

A Lua plugin for the RuneScape 3 client that sends **your own character's** skills, backpack, bank and
position to your group's dashboard. It never sends anything about other players and never sends actions
back into the game.

> **Status: first draft, not yet run in the game.** It is written only from the public API docs
> (<https://developer.runescape.com/rs/>). Everything the docs don't spell out is wrapped in `pcall` and
> logged, and marked `TODO(beta)` in `main.lua`. The first run in the beta client will tell us what to fix.

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

## Open questions the beta test must answer

| Question | Where |
|---|---|
| Real `SkillType` member names (CONSTITUTION vs HITPOINTS, RUNECRAFTING vs RUNECRAFT…) | `SKILL_NAMES` |
| `InvType` names for equipment and **group storage** (not in the docs I read) | `probeInvType` |
| `CoordGrid` field names | `readPosition` |
| Does the bank inventory exist only while the bank is open? (docs imply yes) | `readInv`, `diffBank` |
| Is plain HTTP to localhost allowed? HTTPS required for production? | `plugin.json` `urls` |
| Kill counts / drops: no event exists — needs `chatAccess` + chat parsing | not built yet |

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
