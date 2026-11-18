# Hosting GIM 2.0 on its own server

2.0 gets a fresh server, so nothing about the running 1.x site can be affected. When 2.0 is approved and migrated,
`groupiron.com` is pointed at the new server and the old one is shut down.

| What | Address | Why |
|---|---|---|
| Plugin and API | `https://api.groupiron.com` | Written into the plugin manifest, so it must never change |
| Dashboard (review period) | `https://beta.groupiron.com` | Where testers and reviewers open the web app. After approval `groupiron.com` takes over and this can be dropped |

Both names point at the same backend (one process, one database). The dashboard talks to `/api` on its own host.

## 1. Create the server (Hetzner Cloud)

- Location **Falkenstein or Nuremberg (Germany)**, so the data stays in the EU (data protection "Case 2" for Jagex).
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

## The move from 1.x (after approval, not earlier)

1. Copy the 1.x database to the new server (`scp`) and rehearse on a copy: start the server against it with a separate
   `GIM_DATA_DIR`, check the migrations, clean names with non-breaking spaces and duplicate members.
2. At the cut-over: stop 1.x, take a final copy of its database, put it into `/var/lib/gim2`, start 2.0.
3. Point `groupiron.com` and `www` at the new server (add them to the nginx file and run certbot for them).
   Keep `api.groupiron.com` exactly as it is. Remove `beta.groupiron.com`.
4. Keep the old server for a few days, then shut it down.
