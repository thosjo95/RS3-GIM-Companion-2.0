-- You normally do NOT need this file: the plugin shows a link code in the game and you enter it on the website
-- (top bar -> Plugin -> Link with code). Use this file only if you prefer to paste a personal token:
-- website -> Plugin -> Advanced -> create a token, then copy this file to config.lua and paste it below.
-- Never share your token: anyone who has it can send data as you. If it leaks, create a new one.
return {
    token = "gimp_PASTE_YOUR_TOKEN_HERE",

    -- Optional, for testing only:
    -- debug = true,     -- print a line before each step (and remember the last step in the game's data store)
    -- dryRun = true,    -- read the game and print what WOULD be sent, without any network request
    -- features = { quests = true, kills = true, drops = true, achievements = true, killtracker = true, bosses = true },
}
