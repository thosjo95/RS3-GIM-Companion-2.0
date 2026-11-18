<div align="center">
  <img src="client/public/logo.svg" alt="RS3 GIM Companion" height="120" />
  <h1>RS3 GIM Companion 2.0</h1>
  <p><strong>The Group Ironman tracker that reads the game itself.</strong></p>
  <p>
    <a href="https://thosjo95.github.io/RS3-GIM-Companion-2.0/"><img src="https://img.shields.io/badge/docs-read%20the%20documentation-c8a84b?style=flat-square" alt="Documentation"/></a>
    <img src="https://img.shields.io/badge/status-in%20development-orange?style=flat-square" alt="Status"/>
    <img src="https://img.shields.io/badge/RuneScape%203-Lua%20plugin-4caf50?style=flat-square" alt="RuneScape 3 Lua plugin"/>
    <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-blue?style=flat-square" alt="MIT"/></a>
  </p>
</div>

GIM Companion 1.x tracks a RuneScape 3 Group Ironman team from the public hiscores and Adventurer's Log. **GIM 2.0 adds a
plugin for the official RuneScape 3 client** that sends what the web APIs can't give you, from your own character:

- 🎒 backpack, worn items, every member's bank and the **shared group storage**
- 📒 a **Bank Journal** of everything put into or taken out of the group storage
- 📜 live **quests**, **area tasks** and **achievements**, and the 🛡️ **Group Ironman Journey** tier by tier
- ⚔️ **exact lifetime boss kills** straight from the game's own kill tracker
- 🎁 valuable **drops**, logged once each
- 👥 one **player filter**: pick a player card and every page follows

> **Status:** under development, not released. The live site (groupiron.com) still runs the 1.x line. The plugin runs in the
> RuneScape **beta client** as a developer plugin and has not been submitted to mod.io yet.

## Documentation

Everything is explained in the documentation, including what's new, the dashboard, the plugin, the API and the changelog:

**https://thosjo95.github.io/RS3-GIM-Companion-2.0/**  (source: [`docs/index.html`](docs/index.html))

## Quick start

Requires **Node 22 or newer** (uses the built-in `node:sqlite`).

```bash
npm install --prefix server
npm install --prefix client
npm run dev                          # API on :3001, dashboard on :5173
node server/scripts/devDemo.js       # optional: a demo group with fake data
```

Connect the real plugin: open the dashboard, unlock your group, click **Plugin** in the top bar, create a token, then follow
[`plugin/README.md`](plugin/README.md) (beta client, `plugin/install-dev.ps1`, the console commands).

## Repository layout

| Path | What |
|---|---|
| `client/` | React + Vite dashboard |
| `server/` | Express + SQLite API (`server/routes/plugin.js` is the plugin's API) |
| `plugin/gim-companion/` | The Lua plugin (`main.lua`, `plugin.json`, `json.lua`) |
| `plugin/test/` | Runs the real `main.lua` against a mocked game API and the real server |
| `docs/` | The documentation site (GitHub Pages) |

## Tests

```bash
npm test --prefix server
npm test --prefix plugin
npm run build --prefix client
```

## Privacy

The plugin only **reads** your own character, never other players, never chat, and sends nothing back into the game. Each member
has a personal token that can only write that player's data. Details: *Privacy & safety* in the documentation.

## Licence

[MIT](LICENSE). RS3 GIM Companion is an unofficial fan project and is not affiliated with or endorsed by Jagex Ltd.
RuneScape® is a registered trademark of Jagex Ltd.
