#!/usr/bin/env bash
# Deploys GIM Companion 2.0 to /opt/gim2 (first install and every update). Run as the `gim` user on the server:
#   sudo -u gim bash /opt/gim2/deploy/deploy-gim2.sh      (first time: see deploy/README.md)
set -euo pipefail

APP=/opt/gim2
DATA=/var/lib/gim2
REPO=https://github.com/thosjo95/RS3-GIM-Companion-2.0.git
# The branch this server runs. New work goes into v1.0.x; `main` is the stable line (merged from v1.0.x when a release is ready).
# Override for one run with:  GIM_BRANCH=main sudo -u gim -E bash /opt/gim2/deploy/deploy-gim2.sh
BRANCH="${GIM_BRANCH:-v1.0.x}"

node -e 'if (parseInt(process.versions.node) < 22) { console.error("Node 22 or newer is required, found " + process.version); process.exit(1) }'

mkdir -p "$DATA"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch --quiet origin "$BRANCH"
  git -C "$APP" reset --hard FETCH_HEAD
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP"
fi

# back up the 2.0 database before the new code runs against it (skipped on the very first install)
if [ -f "$DATA/gim.db" ]; then GIM_DATA_DIR="$DATA" node "$APP/server/scripts/backup.js" "$DATA/backups"; fi

cd "$APP"
npm ci --prefix server --omit=dev --silent
npm ci --prefix client --silent
npm run build --prefix client --silent

if pm2 describe gim2 >/dev/null 2>&1; then pm2 reload gim2 --update-env; else pm2 start deploy/ecosystem.gim2.config.js; fi
pm2 save >/dev/null

sleep 3
curl -fsS http://127.0.0.1:3001/api/health && echo && echo "GIM 2.0 is up on port 3001."
