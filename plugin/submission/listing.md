# mod.io listing for GIM Companion (copy into the form)

Everything below follows Jagex's "Submission process" and "Example description" pages. Name and summary are ASCII only.

## Step 1: Basics

**Plugin name** (1-50 characters, ASCII)

```
GIM Companion
```

**Summary** (10-150 characters, ASCII, must not repeat the name or start with "This plugin")

```
Sends your own character's bank, quests, kills and drops to your Group Ironman's web dashboard.
```

**Listing image:** `plugin/submission/listing-image.png` (16:9, 1280x720)

**Homepage:** https://github.com/thosjo95/RS3-GIM-Companion-2.0

**Tags:** group ironman, tracker, quests, bank, drops, kills, dashboard, httpAccess (a tag for every requested permission is required)

## Description (paste as the description)

```
GIM Companion connects the RuneScape client to a web dashboard for Group Ironman teams. It reads what the public web APIs cannot give and sends it, for YOUR OWN character only, to your group's page: your bank and the shared group storage, backpack and worn items, quest and achievement progress, area tasks, the Group Ironman Journey, lifetime boss and slayer kills, and valuable drops. The dashboard then shows the whole team's progress, goals, leaderboards and competitions.

The plugin only reads the game. It never presses anything, never sends input to the game and never changes anything. It does not read or send anything about other players.

GETTING STARTED
1. On the website (https://groupiron.com) one member claims your group and gets the group secret, and shares it with the group.
2. Install and enable GIM Companion, and allow network access (httpAccess) when the game asks.
3. Log in. A GIM Companion window asks for the group secret: type it and press Connect. Your numbers appear on the dashboard within a minute.

EMAIL
rs3groupiron@pm.me (also for data deletion requests)

FEEDBACK AND COLLABORATION
Bug reports and suggestions are welcome in the GIM Companion community Discord (https://discord.gg/uZT4JDdtn2), in the plugin's channel in the RuneScape Plugin Portal Discord, or by email. Code contributions are welcome as pull requests on GitHub (https://github.com/thosjo95/RS3-GIM-Companion-2.0); please discuss larger changes first.

EULA
This plugin uses software licensed by Jagex under the Jagex End User Licence Agreement (https://legal.jagex.com). The development and any use of the Plugin is at all times subject to the Jagex EULA. GIM Companion is an independent project and is not affiliated with or endorsed by Jagex.

PERMISSIONS
httpAccess: sends your own character's game data to the website https://api.groupiron.com, which is the only address the plugin can contact. The information sent is listed under Data Protection below. The website uses it to show your Group Ironman team its progress (items, quests, kills, drops, goals and leaderboards) and who is playing right now. Without this permission the plugin does nothing. No other permission is requested, and httpAccess is not combined with any other permission.

DATA PROTECTION (data is sent to a destination in the EU: server in Helsinki, Finland)
Information used and sent, for your own character only: character name; skill levels; backpack, worn items, bank and group storage contents and what you put in or take out of the group storage; quest, achievement and area task progress including the Group Ironman Journey; boss and slayer kill counts; notable drops; world and position. To connect, the group secret you type is sent once; the plugin then uses a key for your character only (stored on the server only as a one-way hash). The plugin does not send chat, friends or clan lists, login or payment details, or anything about other players.
Endpoint: https://api.groupiron.com (hosted by Hetzner Online GmbH in Helsinki, Finland).
Privacy notice: https://thosjo95.github.io/RS3-GIM-Companion-2.0/privacy.html
Security: all traffic uses HTTPS; the plugin keeps a key, not the group secret; a key can only send data for its one character while that character is a member of the group, and only its hash is stored; group secrets are stored as salted hashes; requests are rate limited and strictly validated; the server runs under an unprivileged account with a firewall and automatic security updates; only the developer has administrative access. Group pages show public hiscores data to anyone; everything that comes from the plugin is visible only to people who unlocked the group.
Retention: a member's data is deleted when they are removed from the group, a group unused for 30 days is deleted, and progress snapshots are kept for at most 120 days. Full details are in the privacy notice.
Requests about your data (access, correction, deletion, withdrawal of consent) go to rs3groupiron@pm.me.
The plugin does not store game information on your computer between sessions; it only stores the key for your character as a setting.
```

## Step 4: Upload

* File: `plugin/dist/gim-companion-100.zip` (build with `powershell -File plugin\build-release.ps1`)
* Platforms: **Windows, Linux and Mac** (all three, and not "Source")
* Version: `1.0.0` (the same as `plugin.json`)
* Changelog: optional for a first version.

## Before pressing submit

- [ ] `https://api.groupiron.com/api/health` answers and the dashboard at `https://beta.groupiron.com` works (reviewers will try it).
- [ ] The privacy page is online: https://thosjo95.github.io/RS3-GIM-Companion-2.0/privacy.html
- [ ] A Discord channel exists for the plugin in the RuneScape Plugin Portal Discord, or remove that sentence.
- [ ] You have read through `main.lua` yourself (AI-assisted code is only accepted if the submitter reviewed and understands it).
- [ ] The contribution policy sentence above matches what you want.
- [ ] Do not edit the listing or the files once Jagex asks for a freeze; keep working in the repository instead.
