// Consistent backup of the live database (safe while the server runs): node server/scripts/backup.js /path/to/backups
// Keeps the 14 newest backups. Uses SQLite's VACUUM INTO, which writes a clean copy without stopping anything.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), path = require('path');

const dataDir = process.env.GIM_DATA_DIR || path.join(__dirname, '..', 'data');
const outDir = process.argv[2] || path.join(dataDir, 'backups');
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const target = path.join(outDir, `gim-${stamp}.db`);
const db = new DatabaseSync(path.join(dataDir, 'gim.db'), { readOnly: true });
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const old = fs.readdirSync(outDir).filter(f => /^gim-.*\.db$/.test(f)).sort().slice(0, -14);
for (const f of old) fs.unlinkSync(path.join(outDir, f));
console.log(`backup written: ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB), removed ${old.length} old`);
