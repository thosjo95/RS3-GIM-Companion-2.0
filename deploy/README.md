# Hosting GIM 2.0 on its own server

2.0 gets a fresh server, so nothing about the running 1.x site can be affected. When 2.0 is approved and migrated,
`groupiron.com` is pointed at the new server and the old one is shut down.

| What | Address | Why |
|---|---|---|
| Plugin and API | `https://api.groupiron.com` | Written into the plugin manifest, so it must never change |
| Dashboard (review period) | `https://beta.groupiron.com` | Where testers and reviewers open the web app. After approval `groupiron.com` takes over and this can be dropped |

Both names point at the same backend (one process, one database). The dashboard talks to `/api` on its own host.

## 1. Create the server (Hetzner Cloud)

- Location in the EU (**Helsinki, Finland** or Germany), so the data stays in the EU (data protection "Case 2" for Jagex). The privacy notice and listing name Helsinki, Finland.
- **Ubuntu 24.04**, type **CX22** (2 vCPU, 4 GB, 40 GB) is plenty for about 150 groups. Pick the next size up if you want headroom.
- Add your **SSH key** and switch on Hetzner's **automatic backups** (about 20% extra) as the second safety net on top of the nightly database backup below.
- Optional but sensible: a Hetzner Cloud Firewall allowing only ports 22, 80 and 443.

## 2. DNS (at your domain provider)

Two `A` records, `api` and `beta`, both pointing at the **new server's IP address**.

## 3. Set up the server (once)

```bash
ssh root@<new-server-ip>
curl -fsSL https://raw.githubusercontent.com/thosjo95/RS3-GIM-Companion-2.0/main/deploy/bootstrap-server.sh | bash
```

This installs nginx, certbot, Node 22 and PM2, creates the `gim` user that runs the app, opens only SSH/HTTP/HTTPS
and turns on automatic security updates.

## 4. Deploy the app

```bash
git clone --branch main https://github.com/thosjo95/RS3-GIM-Companion-2.0.git /opt/gim2
chown -R gim:gim /opt/gim2
sudo -u gim bash /opt/gim2/deploy/deploy-gim2.sh
```

## 5. nginx and HTTPS

```bash
cp /opt/gim2/deploy/nginx-gim2.conf /etc/nginx/sites-available/gim2
ln -s /etc/nginx/sites-available/gim2 /etc/nginx/sites-enabled/gim2
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d api.groupiron.com -d beta.groupiron.com
```

Check: `curl https://api.groupiron.com/api/health` answers, and `https://beta.groupiron.com` shows the dashboard.

## 6. Nightly backup

As root, `crontab -e` and add:

```
15 3 * * * sudo -u gim env GIM_DATA_DIR=/var/lib/gim2 /usr/bin/node /opt/gim2/server/scripts/backup.js /var/lib/gim2/backups
```

Copy the backups off the server now and then (for example `scp`), so a lost server does not take them along.

## Updating

`sudo -u gim bash /opt/gim2/deploy/deploy-gim2.sh` (pulls `main`, backs up the database, rebuilds the dashboard, reloads the process).

## Server switches (beta and launch)

Per-server switches live in `/var/lib/gim2/extra-env.json` (read by `ecosystem.gim2.config.js`, so a deploy never overwrites them):

```json
{"GIM_PREVIEW":"1","GIM_PREVIEW_COPIED":"18 November 2026","GIM_DEMO":"1"}
```

| Key | Effect |
|---|---|
| `GIM_PREVIEW` / `GIM_PREVIEW_COPIED` | Beta only: shows the "Preview" banner and a trial note in the claim window. |
| `GIM_DEMO` | Builds and feeds the demo group "Misthalin Five (Demo)" (read-only, made up). Remove at launch to take it away. |
| `GIM_PLUGIN_LIVE` | Launch day: removes the "waiting for Jagex's approval" note. |

After editing the file restart with the new environment: `sudo -u gim pm2 delete gim2 && sudo -u gim pm2 start /opt/gim2/deploy/ecosystem.gim2.config.js && sudo -u gim pm2 save`.

## Putting a copy of the 1.x database on beta (preview)

On your PC (full paths, any folder): copy the 1.x database to a scratch folder as `gim.db`, then
`GIM_DATA_DIR=<folder> node server/scripts/migrate1x.js --assume-1x --drop-loadouts --apply` (it removes orphan rows, cleans names, flags every group
that has a 1.x secret; run it without `--apply` first for a report). `scp` the file to the server, stop the app, take a backup
(`backup.js`), put the file at `/var/lib/gim2/gim.db` (owner `gim`, mode 600), start the deploy script and restart as above. Delete every loose copy afterwards
(it is player data): `shred -u` on the server, delete the scratch folder on your PC.

## The move from 1.x (after approval, not earlier)

1. Rehearsed on 2026-11-18 (see the section above and `server/scripts/migrate1x.js`). For the real thing repeat it on a fresh copy.
2. At the cut-over: stop 1.x, take a final copy of its database, put it into `/var/lib/gim2`, start 2.0.
3. Point `groupiron.com` and `www` at the new server (add them to the nginx file and run certbot for them).
   Keep `api.groupiron.com` exactly as it is. Remove `beta.groupiron.com`.
4. Keep the old server for a few days, then shut it down.
