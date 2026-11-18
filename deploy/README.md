# Hosting GIM 2.0 during the Jagex review

2.0 runs on the existing Hetzner server, next to 1.x, under its own subdomains. 1.x is not changed.

| What | Address | Why |
|---|---|---|
| Plugin and API | `https://api.groupiron.com` | Written into the plugin manifest, so it must never change |
| Dashboard (review period) | `https://beta.groupiron.com` | Where testers and reviewers open the web app. After approval `groupiron.com` switches to 2.0 and this can be dropped |

Both names point at the same backend (one process, one database). The dashboard talks to `/api` on its own host.

## One-time setup (on the server, as root)

1. **DNS** (at your domain provider): two `A` records, `api` and `beta`, both pointing at the server's IP address.
2. **Node 22 or newer** and PM2 must be installed (1.x already needs them). Check with `node -v`.
3. **Get the code and deploy** (the script clones the repository the first time):
   ```bash
   git clone --branch main https://github.com/thosjo95/RS3-GIM-Companion-2.0.git /opt/gim2
   bash /opt/gim2/deploy/deploy-gim2.sh
   ```
4. **nginx**: copy `deploy/nginx-gim2.conf` to `/etc/nginx/sites-available/gim2`, link it into `sites-enabled`, test and reload (the commands are at the top of the file), then add HTTPS:
   ```bash
   certbot --nginx -d api.groupiron.com -d beta.groupiron.com
   ```
5. **Check**: `curl https://api.groupiron.com/api/health` answers, and `https://beta.groupiron.com` shows the dashboard.
6. **Nightly backup** (`crontab -e`):
   ```
   15 3 * * * GIM_DATA_DIR=/var/lib/gim2 /usr/bin/node /opt/gim2/server/scripts/backup.js /var/lib/gim2/backups
   ```

## Updating

`bash /opt/gim2/deploy/deploy-gim2.sh` (pulls `main`, backs up the database, rebuilds the dashboard, reloads the process).

## What stays separate from 1.x

- Folder `/opt/gim2`, data `/var/lib/gim2/gim.db`, port 3002, PM2 name `gim2`.
- Nothing in `/root/deploy.sh` or the 1.x nginx configuration is touched. If a name or port clashes, change it in the three files here before step 3.

## After approval (do not do this earlier)

1. Back up the 1.x database and rehearse the migration on a copy (see the migration notes in the project memory).
2. Point `groupiron.com` at the 2.0 dashboard and keep `api.groupiron.com` exactly as it is.
3. Remove `beta.groupiron.com`.
