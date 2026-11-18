/**
 * DEV ONLY: builds the demo group "Misthalin Five (Demo)" in the dev database, for screenshots and for trying the demo.
 * The same group is built by the server itself on the beta server (GIM_DEMO=1, see services/demoGroup.js), which also keeps it
 * moving. It has no secret: it is read-only for everyone.
 *
 *   node server/scripts/devShowcase.js        (safe to re-run: replaces the demo group)
 */
if (process.env.NODE_ENV === 'production') { console.error('Refusing to run in production (the server builds its own demo group when GIM_DEMO=1).'); process.exit(1); }
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { createDemoGroup, NAME } = require('../services/demoGroup');
const r = createDemoGroup(require('../services/demoTemplate.json'));
console.log(`Created "${NAME}" (group ${r.gid}) with ${r.players.length} members. Area task sets derived: ${r.areaTasks}`);
