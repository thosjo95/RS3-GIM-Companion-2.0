#!/usr/bin/env bash
# One-time setup of a FRESH Ubuntu 24.04 (or 22.04) server for GIM Companion 2.0. Run as root, once:
#   curl -fsSL https://raw.githubusercontent.com/thosjo95/RS3-GIM-Companion-2.0/main/deploy/bootstrap-server.sh | bash
# Safe to run again. It installs nginx, certbot, Node 22 and PM2, creates the unprivileged user `gim` that runs the
# app, opens only SSH, HTTP and HTTPS, and turns on automatic security updates.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx git curl ufw unattended-upgrades sqlite3 ca-certificates gnupg

# Node.js 22 (the app uses its built-in SQLite module)
if ! command -v node >/dev/null || [ "$(node -p 'parseInt(process.versions.node)')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2 --silent

# the user that runs the app (no password, no shell login), and its folders
id gim >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash gim
mkdir -p /opt/gim2 /var/lib/gim2
chown -R gim:gim /opt/gim2 /var/lib/gim2

# start the app automatically after a reboot
env PATH="$PATH:/usr/bin" pm2 startup systemd -u gim --hp /home/gim >/dev/null || true

# firewall: only SSH, HTTP, HTTPS
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

# automatic security updates
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "Server ready. Next: deploy the app (see deploy/README.md, step 3)."
