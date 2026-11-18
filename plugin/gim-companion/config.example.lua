-- Copy this file to config.lua (same folder) and paste YOUR token.
-- Get a token in the GIM dashboard: Items tab -> Plugin setup -> Connect.
-- config.lua is git-ignored; never share your token (it lets anyone write data as you).
return {
    token = "gimp_PASTE_YOUR_TOKEN_HERE",

    -- Optional, for testing. Turn a feature off if it causes trouble:
    -- features = { quests = true, kills = true, drops = true },
    -- dryRun = true,   -- read the game and print what would be sent, without any network request
    -- probe = "local",   -- beta debugging: one test GET ("local" = this dev server, "https" = a public site)
    -- debug = false,   -- true (default) prints a "[GIM] >" line before each step
}
