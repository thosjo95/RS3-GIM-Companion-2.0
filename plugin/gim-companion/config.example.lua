-- You normally do NOT need this file: the first time you log in, the plugin asks for your group's secret in a small
-- window in the game. Use this file only if you prefer to put the secret here: copy it to config.lua (same folder)
-- and fill in the secret below. It is the same secret that unlocks your group on the website.
-- The plugin sends it once to join, then keeps only a key for your own character.
return {
    -- groupSecret = "XXXX-XXXX-XXXX",

    -- Optional, for testing only:
    -- debug = true,     -- print a line before each step (and remember the last step in the game's data store)
    -- dryRun = true,    -- read the game and print what WOULD be sent, without any network request
    -- features = { quests = true, kills = true, drops = true, achievements = true, killtracker = true, bosses = true },
}
