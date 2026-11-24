# Contributing to GIM Companion 2.0

Thanks for helping. This is a dashboard for RuneScape 3 Group Ironman teams plus a Lua plugin for the official RS3 plugin system.
Read the [project guide](CLAUDE.md) for how it fits together. This page is the short version for contributors.

## Stack

| Part | Tech |
|---|---|
| `server/` | Node 22 or newer, Express 4, the built-in `node:sqlite` (one SQLite file, no database server), `node:test` |
| `client/` | React and Vite |
| `plugin/gim-companion/` | Lua for the official RS3 plugin system (`main.lua`, `json.lua`, `plugin.json`) |
| `plugin/test/` | the real `main.lua` run against a mocked game API (fengari) |
| `deploy/` | nginx, PM2 and scripts for the Hetzner server |
| `docs/` | the GitHub Pages site |

## Run it

```bash
npm run install:all        # once
npm run dev                # API on :3001, UI on :5173
npm test --prefix server   # API tests
npm test --prefix plugin   # plugin against the mocked game
cd client && npx vite build   # must build cleanly
```

`GIM_DATA_DIR=<folder>` points the server at another database folder. Use a scratch folder for experiments, never a real database.
`node server/scripts/devShowcase.js` builds the demo group in your dev database.

## Branches and pull requests

- **New work goes into `v1.0.x`** (the default branch). `main` is the stable line and only receives merges from `v1.0.x` when a release is ready.
- Create your own branch from `v1.0.x` (for example `fix/area-task-icons`), or fork the repo and do it there.
- Open a pull request **into `v1.0.x`**. Keep it focused: one change, a short description, what you tested.
- The tests and the client build must pass before you ask for a review.

## Rules that matter

- **The plugin only reads the logged-in character's own data.** Never read, store or send anything about other players (Jagex rule).
  Plugin code must stay readable and commented, because the owner has to understand and review every line.
- **Changing a file in `plugin/gim-companion/` means the release zip has to be rebuilt** (`powershell -File plugin\build-release.ps1`) and
  resubmitted. Say so in the pull request so the owner can plan for it.
- **No personal data in the repo.** Never commit a database, a secret, a token or a real group secret. Test data is made up.
- **Names:** RuneScape writes names with a non-breaking space. Always compare names after replacing `\s` with a normal space.
- **Looks:** official RuneScape icons and images (from the game or the RuneScape Wiki), no emoji icons in the UI or the docs, panels that
  float over the page instead of pushing content down.
- **Never deploy or touch production.** The owner deploys. Server steps are written as commands in `deploy/README.md`.
- Add or update a test when you change server behaviour (`server/test/`).

## Commit messages

Short and in the imperative: "Fix the backpack stack counts", not "fixed stuff". Explain the why in the body when it is not obvious.

## Questions

Open an issue, or ask in the GIM Companion community Discord (link in the docs).
