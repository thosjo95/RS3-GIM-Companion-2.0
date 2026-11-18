# GIM Companion: the in-game plugin

A plugin for the RuneScape 3 client that sends **your own character's** data to your Group Ironman's dashboard
(the GIM Companion website), so the dashboard can show what the web APIs cannot: your bank and the shared group
storage, backpack and worn gear, quest and achievement progress, area tasks, the Group Ironman Journey, lifetime boss
and slayer kills and valuable drops.

It only **reads** the game. It never clicks, never sends input to the game and never changes anything.

## What it sends, and what it never sends

| Sent (your own character only) | Never sent |
|---|---|
| Character name, skills and levels | Anything about other players (their names, items, positions, chat) |
| Backpack, worn items, bank, group storage contents | Chat messages, friends list, clan lists |
| Quest states, completed achievements and area tasks, the Journey | Your RuneScape login, password or payment details |
| Boss and slayer kill counts, notable drops | Anything outside the RuneScape client |
| World and position | |

Group storage is the group's shared chest. The plugin sends its contents and what **you** put in or take out; it
does not look at what other members do.

Every update carries your personal **token**. A token can only send data for the one character it was created for.
The website stores only a hash of it. Data is sent over HTTPS to the single address declared in `plugin.json`
(`https://api.groupiron.com`).

## Permission

The plugin asks for one optional permission, **httpAccess**, to send your data to the website. Without it the plugin
stays idle and does nothing. You can withdraw it at any time in the plugin settings.

## Install and connect (players)

1. In the RuneScape client open the plugin browser, search for **GIM Companion** and install it.
2. Enable it and allow network access (httpAccess) when the game asks.
3. On the website: unlock your group, press **Plugin** in the top bar, then **Connect** next to your name.
   A token is shown **once**: copy it.
4. Paste the token into the plugin's `config.lua` between the quotes (`config.example.lua` shows how).

Within a minute your numbers appear on the dashboard and the dot next to your name turns green.
If the token leaks, press **Connect** again: the old one stops working at once.

## Your data

Removing a member from the group on the website deletes that player's data. To have data deleted in any other way,
write to **rs3groupiron@pm.me**. The privacy notice is on the project's documentation site.

## Settings (`config.lua`, all optional)

| Setting | Effect |
|---|---|
| `debug = true` | Print a line before every step. The last line shows where a problem happened. |
| `dryRun = true` | Read the game and print what would be sent, without any network request. |
| `features = { ... }` | Switch parts off: `quests`, `kills`, `drops`, `achievements`, `killtracker`, `bosses`. |

## How it works

```
RuneScape client (this plugin, HTTPS POST with your token)  ->  /api/plugin/ingest  ->  database  ->  dashboard
```

`main.lua` is one file, read top to bottom in numbered sections: settings, reading the game, bank and group-storage
changes, quests, achievements and area tasks, the game's kill tracker, boss records, kills, drops, sending and
scheduling. Every read of the game is wrapped so one unexpected value cannot stop the plugin. Updates are
retry-safe: kill batches, storage changes and drops carry references the server de-duplicates.

`json.lua` encodes and decodes the JSON the plugin exchanges with the server.

## For developers

```bash
npm install --prefix plugin
npm test --prefix plugin     # runs main.lua against a MOCKED RuneScape API and feeds the output to the real server
npm test --prefix server     # API tests (auth, validation, isolation, ledger, scale)
```

Run it in the RuneScape **beta** client against a server on your own computer:

```powershell
powershell -File plugin\install-dev.ps1          # copies the plugin to dev_plugins and points it at http://localhost:3001
```

Then, in the beta client, open the console with **ALT + the key under Esc** and run `prf`, then
`ppe gim-companion httpAccess`, then `pon gim-companion` (`prl gim-companion` after edits).
Official guide: <https://developer.runescape.com/rs/tutorial/1helloworld.html>

Build the release zip that is submitted on mod.io (`main.lua` and `plugin.json` at the top level):

```powershell
powershell -File plugin\build-release.ps1        # writes plugin\dist\gim-companion-100.zip
```

Licence: MIT (see the repository). Development and use of the plugin are subject to the Jagex End User Licence
Agreement (<https://legal.jagex.com>).
