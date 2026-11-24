## What and why

<!-- One change, in a few sentences. -->

## Checklist

- [ ] The pull request targets `v1.0.x`
- [ ] `npm test --prefix server` passes (and `npm test --prefix plugin` if the plugin changed)
- [ ] `cd client && npx vite build` is clean
- [ ] No personal data, secrets or databases are committed
- [ ] If `plugin/gim-companion/` changed: the plugin still reads only the logged-in character's own data, and the release zip needs a rebuild

## How I tested it

<!-- What you ran or clicked. Say plainly what you could not test (for example anything that needs the real game client). -->
