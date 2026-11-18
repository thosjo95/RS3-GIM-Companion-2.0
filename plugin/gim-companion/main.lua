-- GIM Companion — sends YOUR OWN character's skills, backpack, worn items, bank, group storage, position,
-- quest progress, kill counts and notable drops to your group's dashboard (the "GIM 2.0" web app).
--
-- What it does NOT do: it never reads or sends anything about other players, never reads chat, and never
-- sends actions back into the game. It only reads. Data goes only to the address in plugin.json "urls".
--
-- Layout of this file (one idea per section):
--   1. Settings     - read the personal token from config.lua
--   2. Reading      - skills, inventories, position
--   3. Bank changes - what moved in/out of the bank and group storage
--   4. Quests       - quest progress from the game's quest definitions
--      Achievements  - completed achievements / area tasks from the game's achievement definitions
--   5. Kills        - NPC kills of the monster you are fighting
--   6. Drops        - valuable items that appear after one of your kills
--   7. Sending      - one JSON POST, retried until the server confirms (nothing is lost on a failed request)
--   8. Scheduling   - events mark data "dirty"; a slow tick sends it, a heartbeat keeps the dashboard live

local json = require("json")

-- The game's console prints with the standard `print`; this wrapper keeps every message recognisable.
local function log(...) print(...) end

-- IMPORTANT: HTTPRequest.new must be called from inside a Lua function, never handed straight to pcall
-- (the form pcall(HTTPRequest.new, base, path) crashed the client in the beta; the game probably looks at
-- the calling Lua code to find out which plugin is asking). This wrapper keeps the error protection.
local function newRequest(base, path)
    return pcall(function() return HTTPRequest.new(base, path) end)
end

-- ── 1. Settings ───────────────────────────────────────────────────────────────
-- NB: `config` is the game API's own global (config.Obj ...), so our settings use another name.
local okSettings, settings = pcall(require, "config")
if not okSettings or type(settings) ~= "table" or type(settings.token) ~= "string" or not settings.token:find("^gimp_") then
    log("[GIM] config.lua missing or invalid - copy config.example.lua to config.lua and paste your token. Plugin idle.")
    return
end

log("[GIM] httpAccess granted: " .. tostring(Plugin.HasPermission(PluginPermissions.httpAccess)))
if settings.dryRun ~= true and not Plugin.HasPermission(PluginPermissions.httpAccess) then
    log("[GIM] httpAccess permission not granted - the plugin cannot send data. Plugin idle.")
    log("[GIM] Fix: run   ppe gim-companion httpAccess   then   prl gim-companion")
    return
end

-- Optional switches in config.lua, useful while testing (all default to on):
--   debug = true/false         print a trace line before each risky step (the last line shows where a crash happened)
--   features = { quests = true, kills = true, drops = true }
--   dryRun = true              read the game and print what WOULD be sent, but make no network request at all
local DRY_RUN = settings.dryRun == true
local DEBUG = settings.debug ~= false
local FEATURES = { quests = true, kills = true, drops = true, achievements = true, killtracker = true }
if type(settings.features) == "table" then
    for name in pairs(FEATURES) do if settings.features[name] == false then FEATURES[name] = false end end
end
-- A breadcrumb is saved to the game's own data store, which survives a client crash: after a crash the
-- last step reached can be read back from PluginData.db (key "gim_last_step").
local function breadcrumb(msg)
    pcall(function() PersistentDB:SetString("gim_last_step", msg) end)
end
local function trace(msg)
    breadcrumb(msg)
    if DEBUG then log("[GIM] > " .. msg) end
end

local PAYLOAD_VERSION    = 1
local HEARTBEAT_TICKS    = 50    -- ServerLogic fires about every 0.6 s, so about 30 s
local SETTLE_TICKS       = 3     -- wait this long after an inventory event so one bank action = one message
local MIN_GAP_TICKS      = 5     -- never send more often than this (the server allows 60 per minute)
local MAX_BANK_ITEMS     = 6000  -- the server's limit; larger banks are cut rather than rejected
local QUEST_RECHECK      = 100   -- re-read all quests this often (about a minute)
local QUEST_SCAN_LIMIT   = 800   -- quest ids are scanned from 0; stop after this many ...
local QUEST_MISS_LIMIT   = 40    -- ... or after this many missing ids in a row
local KILL_CREDIT_TICKS  = 10    -- an NPC only counts as killed if your target's health moved this recently
local KILL_NEAR_TILES    = 25    -- ... and it was this close to you (so teleporting away is not a kill)
local DROP_WINDOW_TICKS  = 20    -- a drop belongs to a kill made this recently
local DROP_NEAR_TILES    = 12    -- ... and this close
local MAX_DROPS_PER_SEND = 20
local ACH_RECHECK        = 600   -- re-read achievements this often (about 6 minutes)
local ACH_SCAN_LIMIT     = 8000  -- achievement ids are scanned from 0 up to this, in small steps
local ACH_MISS_LIMIT     = 400   -- stop early after this many missing ids in a row
local ACH_IDS_PER_TICK   = 50
local KILLVAR_RECHECK     = 300    -- re-read the game's kill tracker variables this often (about 3 minutes)
local JOURNEY_CATEGORY    = 5483   -- the Group Ironman "Journey" achievements: unfinished ones are reported too, so progress has a total
local ACH_MAX_PER_SEND   = 1500  -- the server accepts at most this many per request; the rest follows next time

-- Shared state
local ticks = 0
local dirty = { skills = true, items = true }
local settle = 0
local inFlight, stopped = false, false
local lastSendTick = -MIN_GAP_TICKS
local function markItemsDirty() dirty.items = true; settle = 0 end

-- ── 2. Reading the game ───────────────────────────────────────────────────────
-- Dashboard skill name -> SkillType member.
local SKILLS = {
    Attack = SkillType.ATTACK,             Defence = SkillType.DEFENCE,         Strength = SkillType.STRENGTH,
    Constitution = SkillType.HITPOINTS,    Ranged = SkillType.RANGED,           Prayer = SkillType.PRAYER,
    Magic = SkillType.MAGIC,               Cooking = SkillType.COOKING,         Woodcutting = SkillType.WOODCUTTING,
    Fletching = SkillType.FLETCHING,       Fishing = SkillType.FISHING,         Firemaking = SkillType.FIREMAKING,
    Crafting = SkillType.CRAFTING,         Smithing = SkillType.SMITHING,       Mining = SkillType.MINING,
    Herblore = SkillType.HERBLORE,         Agility = SkillType.AGILITY,         Thieving = SkillType.THIEVING,
    Slayer = SkillType.SLAYER,             Farming = SkillType.FARMING,         Runecrafting = SkillType.RUNECRAFTING,
    Hunter = SkillType.HUNTER,             Construction = SkillType.CONSTRUCTION, Summoning = SkillType.SUMMONING,
    Dungeoneering = SkillType.DUNGEONEERING, Divination = SkillType.DIVINATION, Invention = SkillType.INVENTION,
    Archaeology = SkillType.ARCHAEOLOGY,   Necromancy = SkillType.NECROMANCY,
}

local function readSkills()
    local out, any = {}, false
    for name, skill in pairs(SKILLS) do
        local okX, xp = pcall(Player.GetXPUncapped, skill)
        local okL, level = pcall(Player.GetLevelGameplay, skill)
        if okX and okL and type(xp) == "number" and type(level) == "number" then
            out[name] = { xp = math.max(0, math.floor(xp)), level = math.max(1, math.floor(level)) }
            any = true
        end
    end
    return any and out or nil
end

-- Item names and values come from the game's item definitions, cached because they never change.
local objInfo = {}
local function describeObj(objId)
    local cached = objInfo[objId]
    if cached then return cached end
    local info = { name = "Item " .. tostring(objId), value = 0 }
    local okObj, proxy = pcall(function() return config.Obj.FromID(objId) end)
    if okObj and proxy ~= nil then
        local okName, name = pcall(function() return proxy.name end)
        local okCost, cost = pcall(function() return proxy.cost end)
        if okName and type(name) == "string" and name ~= "" then info.name = name end
        if okCost and type(cost) == "number" then info.value = math.max(0, math.floor(cost)) end
    end
    objInfo[objId] = info
    return info
end

-- Is a game window (bank, group storage ...) currently open? A closed window means its inventory is
-- not reliable, so we never treat "empty" as "everything was withdrawn".
local function isOpen(interfaceId)
    local ok, panel = pcall(function() return ui.Interfaces:GetInterface(interfaceId) end)
    return ok and panel ~= nil
end

-- One inventory as a list of { id, name, count, value }, merged per item id. nil = not available right now.
local function readInv(invId, maxItems)
    local okFind, inv = pcall(Inventory.Find, invId)
    if not okFind or inv == nil then return nil end
    local okValid, valid = pcall(function() return inv.isValid end)
    if not okValid or valid ~= true then return nil end
    local okSlots, slots = pcall(function() return inv:GetSlots() end)
    if not okSlots or slots == nil then return nil end

    local byId, list = {}, {}
    for _, slot in ipairs(slots) do
        local okObj, obj = pcall(function() return slot.obj end)
        local objId = okObj and obj ~= nil and obj.id or 0
        local count = slot.count
        if type(objId) == "number" and objId > 0 and type(count) == "number" and count > 0 then
            local entry = byId[objId]
            if entry == nil then
                local info = describeObj(objId)
                entry = { id = objId, name = info.name, count = 0, value = info.value }
                byId[objId] = entry
                list[#list + 1] = entry
            end
            entry.count = entry.count + math.floor(count)
        end
    end
    if maxItems and #list > maxItems then
        for i = #list, maxItems + 1, -1 do list[i] = nil end
    end
    return list
end

local function totals(list)
    local t = {}
    for _, it in ipairs(list) do t[it.id] = it end
    return t
end

-- A world position from a game CoordGrid: x/y on the map and the plane (floor) as level.
local function tileOf(grid)
    local ok, tile = pcall(function()
        return { x = grid.mapSquareX * 64 + grid.localX, y = grid.mapSquareZ * 64 + grid.localZ, level = grid.level }
    end)
    return ok and tile or nil
end

local function readPosition()
    local okE, entity = pcall(Player.GetEntity)
    if not okE or entity == nil then return nil end
    local okG, grid = pcall(function() return entity.coordGrid end)
    if not okG or grid == nil then return nil end
    local tile = tileOf(grid)
    if tile == nil then return nil end
    return { x = tile.x, y = tile.y, z = tile.level }   -- the dashboard calls the plane "z"
end

local function characterName()
    local okE, entity = pcall(Player.GetEntity)
    if not okE or entity == nil then return nil end
    local okN, name = pcall(function() return entity.displayName end)
    if okN and type(name) == "string" and name ~= "" then return name end
    return nil
end

local function near(a, b, tiles)
    return a ~= nil and b ~= nil and a.level == b.level and math.abs(a.x - b.x) <= tiles and math.abs(a.y - b.y) <= tiles
end

-- ── 3. Changes in the bank and group storage ──────────────────────────────────
-- The dashboard's Bank Journal records what is put into / taken out of the GROUP STORAGE only (a member's own
-- bank is sent as a snapshot for the Items view but its movements are not journalled). For each journalled
-- store we remember the totals the server has
-- ALREADY ACCEPTED ("held"); a change is only counted as delivered once a send succeeds, so a failed
-- request simply tries again with nothing lost.
local changeBatch = nil      -- { ref, changes, seen } formed and sent, waiting for the server's confirmation
local changeBatchCounter = 0
local STORES = {
    { key = "bank",  field = "bank", journal = false, window = id.Interface.BANK,   inv = id.Inv.BANK,                          held = nil },
    { key = "group", field = "group_storage", journal = true, window = id.Interface.GROUP_IRONMAN_STORAGE,   inv = id.Inv.GROUP_IRONMAN_STORAGE_CLAN_TEMP, held = nil },
}

-- The game's Lua has NO `os` library (no clock), so the plugin cannot stamp times itself: it sends no time and
-- the server stamps each change when it arrives. Duplicates are prevented with batch references instead.
local function nowIso()
    return nil
end

-- Changes between what the server holds and what we see now.
local function diff(store, now)
    local before, changes = store.held, {}
    if before == nil then return changes end   -- first look = baseline, not a deposit of everything
    local ts = nowIso()
    for itemId, it in pairs(now) do
        local was = before[itemId] and before[itemId].count or 0
        if it.count ~= was then
            changes[#changes + 1] = { store = store.key, id = itemId, name = it.name, delta = it.count - was, value = it.value, ts = ts }
        end
    end
    for itemId, old in pairs(before) do
        if now[itemId] == nil then
            changes[#changes + 1] = { store = store.key, id = itemId, name = old.name, delta = -old.count, value = old.value, ts = ts }
        end
    end
    return changes
end

-- ── 4. Quests ─────────────────────────────────────────────────────────────────
-- Every quest definition knows its own name and whether this character has started / finished it.
-- We scan the quest ids, send the whole list once per login (a baseline), and afterwards only what changed.
local questHeld = {}        -- quest id -> state the server has accepted
local questBaselineDone = false
local lastQuestCheck = -QUEST_RECHECK

local function readQuest(questId)
    local okQ, quest = pcall(function() return config.Quest.FromID(questId) end)
    if not okQ or quest == nil then return nil end
    local okR, entry = pcall(function()
        if quest.deprecated then return false end   -- old versions of quests that no longer exist in the game
        local state = "not_started"
        if quest.hasFinishedQuest then state = "finished" elseif quest.hasStartedQuest then state = "started" end
        return { id = questId, name = quest.name, state = state, members = quest.isMembers and true or false, points = quest.questPoints }
    end)
    if okR and entry == false then return false end   -- deprecated: skip it, but it is not a gap in the id range
    if not okR or type(entry.name) ~= "string" or entry.name == "" then return nil end
    if type(entry.points) ~= "number" then entry.points = nil end
    return entry
end

-- The scan runs a few ids per tick (never all ~800 at once) and leaves its result in `questChanges`:
-- the quests whose state differs from what the server holds (everything, for the first scan after login).
local QUEST_IDS_PER_TICK = 25
local questScan = nil       -- { next, seen, misses, changed } while a scan is running
local questChanges = nil    -- finished scan result waiting to be sent

local function questScanStep()
    local scan = questScan
    if scan == nil then return end
    local last = math.min(scan.next + QUEST_IDS_PER_TICK - 1, QUEST_SCAN_LIMIT - 1)
    for questId = scan.next, last do
        local entry = readQuest(questId)
        if entry == nil then
            scan.misses = scan.misses + 1
            if scan.misses >= QUEST_MISS_LIMIT and scan.seen > 0 then last = QUEST_SCAN_LIMIT; break end
        elseif entry == false then
            scan.misses = 0   -- deprecated quest: skipped, not sent
        else
            scan.misses = 0
            scan.seen = scan.seen + 1
            if questHeld[questId] ~= entry.state then scan.changed[#scan.changed + 1] = entry end
        end
    end
    scan.next = last + 1
    if scan.next >= QUEST_SCAN_LIMIT then
        questScan = nil
        trace("quest scan finished: " .. scan.seen .. " quests, " .. #scan.changed .. " to send")
        if scan.seen > 0 and #scan.changed > 0 then questChanges = scan.changed; markItemsDirty() end
    end
end

local function questScanStart()
    lastQuestCheck = ticks
    questScan = { next = 0, seen = 0, misses = 0, changed = {} }
    trace("quest scan started")
end

-- ── 4b. Achievements and area tasks ───────────────────────────────────────────────
-- RuneScape's "achievements" (which include the area tasks) are config entries that know their own name, category
-- and the character's progress; progress == -2 means complete. Like the quests they are scanned a few ids per tick;
-- only COMPLETED ones are sent (a baseline once per login, then whatever is newly completed).
local achHeld = {}              -- achievement id -> true once the server has accepted it as completed
local achSeenOpen = {}          -- journey achievement id -> true once the server knows it exists (not yet completed)
local achBaselineDone = false
local lastAchCheck = -ACH_RECHECK
local achScan, achChanges = nil, nil
local achTable = nil            -- config.Achievement (looked up once)
local achPrinted = false

local function achComplete()
    local ok, value = pcall(function() return AchievementProgressType.COMPLETE end)
    if ok and type(value) == "number" then return value end
    return -2
end

-- Journey steps carry more detail worth showing: what they ask for, what they give, and a progress counter
-- (for example "Total level 2497 / 2600"). Read only for the journey category.
local function journeyExtras(ach)
    local out = {}
    local okR, reward = pcall(function() return ach.reward end)
    if okR and type(reward) == "string" and reward ~= "" then out.reward = reward end
    local okT, target = pcall(function() return ach.tallyTarget end)
    local okP, progress = pcall(function() return ach.tallyProgress end)
    if okT and okP and type(target) == "number" and target > 0 and type(progress) == "number" then
        out.tally_target, out.tally_progress = math.floor(target), math.max(0, math.floor(progress))
    end
    local okD, text = pcall(function()
        local ds = ach.descriptions
        if type(ds) ~= "table" then return nil end
        for _, v in pairs(ds) do
            if type(v) == "string" and v ~= "" then return v end
            if type(v) == "table" then
                local t = v.text or v.description
                if type(t) == "string" and t ~= "" then return t end
            end
        end
        return nil
    end)
    if okD and type(text) == "string" then out.description = text:sub(1, 280) end
    return out
end

local function readAchievement(achId)
    if achTable == nil then
        local okT, tbl = pcall(function() return config.Achievement end)
        if okT and tbl ~= nil then achTable = tbl end
        if achTable == nil then return nil end
    end
    local okA, ach = pcall(function() return achTable.FromID(achId) end)
    if not okA or ach == nil then return nil end
    local okR, entry = pcall(function()
        return { id = achId, name = ach.name, category = ach.category, sub_category = ach.subCategory,
                 members = ach.isMembers and true or false, rune_score = ach.runeScore, progress = ach.progress }
    end)
    if not okR or type(entry.name) ~= "string" or entry.name == "" then return nil end
    if entry.category == JOURNEY_CATEGORY then
        local x = journeyExtras(ach)
        entry.reward, entry.tally_target, entry.tally_progress, entry.description = x.reward, x.tally_target, x.tally_progress, x.description
    end
    return entry
end

local function achScanStep()
    local scan = achScan
    if scan == nil then return end
    local done = achComplete()
    local last = math.min(scan.next + ACH_IDS_PER_TICK - 1, ACH_SCAN_LIMIT - 1)
    for achId = scan.next, last do
        local e = readAchievement(achId)
        if e == nil then
            scan.misses = scan.misses + 1
            if scan.misses >= ACH_MISS_LIMIT and scan.seen > 0 then last = ACH_SCAN_LIMIT; break end
        else
            scan.misses = 0
            scan.seen = scan.seen + 1
            local completed = e.progress == done
            if completed then scan.completed = scan.completed + 1 end
            scan.categories[e.category or -1] = (scan.categories[e.category or -1] or 0) + (completed and 1 or 0)
            -- A few samples are printed once so the real names / categories can be inspected in the beta.
            if #scan.samples < 14 and (completed or e.name:find("Easy") or e.name:find("Elite") or e.name:find("Beginner")) then
                scan.samples[#scan.samples + 1] = e.name .. " [cat " .. tostring(e.category) .. "/" .. tostring(e.sub_category) .. ", progress " .. tostring(e.progress) .. "]"
            end
            if completed and not achHeld[achId] then
                scan.changed[#scan.changed + 1] = { id = e.id, name = e.name, category = e.category, sub_category = e.sub_category,
                                                    members = e.members, rune_score = e.rune_score,
                                                    reward = e.reward, description = e.description, tally_target = e.tally_target, tally_progress = e.tally_progress }
            elseif not completed and e.category == JOURNEY_CATEGORY and achSeenOpen[achId] ~= (e.tally_progress or -1) then
                -- A journey step that is not done yet: sent (completed = false) so the dashboard knows the total, and
                -- again whenever its progress counter moves.
                scan.changed[#scan.changed + 1] = { id = e.id, name = e.name, category = e.category, sub_category = e.sub_category,
                                                    members = e.members, rune_score = e.rune_score, completed = false,
                                                    reward = e.reward, description = e.description, tally_target = e.tally_target, tally_progress = e.tally_progress }
            end
        end
    end
    scan.next = last + 1
    if scan.next >= ACH_SCAN_LIMIT then
        achScan = nil
        trace("achievement scan finished: " .. scan.seen .. " achievements, " .. scan.completed .. " completed, " .. #scan.changed .. " to send")
        if not achPrinted and scan.seen > 0 then
            achPrinted = true
            local cats = {}
            for c, n in pairs(scan.categories) do cats[#cats + 1] = "cat " .. tostring(c) .. "=" .. n end
            table.sort(cats)
            log("[GIM] achievements: " .. scan.seen .. " found, " .. scan.completed .. " completed. Completed per category: " .. table.concat(cats, ", "))
            for _, line in ipairs(scan.samples) do log("[GIM] achievements sample: " .. line) end
        elseif scan.seen == 0 then
            log("[GIM] achievements: none readable (config.Achievement may be named differently)")
        end
        if scan.seen > 0 and #scan.changed > 0 then achChanges = scan.changed; markItemsDirty() end
    end
end

local function achScanStart()
    lastAchCheck = ticks
    if achTable == nil then
        local okT, tbl = pcall(function() return config.Achievement end)
        if okT and tbl ~= nil then achTable = tbl end
    end
    if not achPrinted then
        if achTable == nil then
            log("[GIM] achievements: config.Achievement was not found in this game version - nothing to scan")
        else
            local e0 = readAchievement(0)
            log("[GIM] achievements: scan started (this takes a few minutes). Achievement #0 = " .. (e0 and (e0.name .. " [progress " .. tostring(e0.progress) .. "]") or "not readable"))
        end
    end
    achScan = { next = 0, seen = 0, misses = 0, completed = 0, changed = {}, categories = {}, samples = {} }
    trace("achievement scan started")
end

-- ── 4c. The game's own kill tracker ────────────────────────────────────────────────
-- The game keeps LIFETIME kill counts for slayer monsters and bosses on the character, in player variables named
-- bslay_monster_killsN and bslay_boss_killsN (plus *_prestigeN). Which monster each N is has to be worked out
-- from real values, so the raw numbers are reported as they are. Nothing is derived from chat or the screen.
local KILLVAR_NAMES = {}
for n = 1, 20 do KILLVAR_NAMES[#KILLVAR_NAMES + 1] = "bslay_monster_kills" .. n end
for n = 1, 19 do KILLVAR_NAMES[#KILLVAR_NAMES + 1] = "bslay_boss_kills" .. n end
for n = 1, 10 do KILLVAR_NAMES[#KILLVAR_NAMES + 1] = "bslay_monster_prestige" .. n end
for n = 1, 10 do KILLVAR_NAMES[#KILLVAR_NAMES + 1] = "bslay_boss_prestige" .. n end
local killVarsHeld = {}         -- name -> value the server has accepted
local killVarsChanged = nil     -- { name = value } waiting to be sent
local lastKillVarCheck = -KILLVAR_RECHECK
local killVarsPrinted = false

local function readVarByName(name)
    local okId, varId = pcall(function() return id.VarPlayer[string.upper(name)] end)
    if not okId or type(varId) ~= "number" then return nil end
    local okV, proxy = pcall(function() return var.VarPlayer.FromID(varId) end)
    if not okV or proxy == nil then return nil end
    local okVal, value = pcall(function() return proxy.value end)
    if okVal and type(value) == "number" then return math.max(0, math.floor(value)) end
    return nil
end

local function scanKillVars()
    lastKillVarCheck = ticks
    local changed, readable, nonzero, shown = nil, 0, 0, {}
    for _, name in ipairs(KILLVAR_NAMES) do
        local value = readVarByName(name)
        if value ~= nil then
            readable = readable + 1
            if value > 0 then nonzero = nonzero + 1; if #shown < 40 then shown[#shown + 1] = name .. "=" .. value end end
            if killVarsHeld[name] ~= value and (value > 0 or killVarsHeld[name] ~= nil) then
                changed = changed or {}
                changed[name] = value
            end
        end
    end
    if not killVarsPrinted then
        killVarsPrinted = true
        log("[GIM] kill tracker: " .. readable .. " of " .. #KILLVAR_NAMES .. " variables readable, " .. nonzero .. " not zero")
        if #shown > 0 then log("[GIM] kill tracker values: " .. table.concat(shown, ", ")) end
    end
    if changed then killVarsChanged = changed; markItemsDirty() end
end

-- ── 4d. Kill tracker table probe (beta debugging, off unless config.lua sets trackerProbe = true) ──────────────
-- The game's kill tracker (Adventures > Beasts) is drawn from data tables: one row per boss / slayer creature. This
-- one-off probe finds the tables whose names look related and prints their layout and a few rows, so the mapping from
-- creature name to the variable holding its count can be written down. It only reads; it prints at most ~70 lines.
local probe = nil
local probeLines = 0
local probeSaved = {}
local function probeLog(msg)
    if probeLines >= 140 then return end
    probeLines = probeLines + 1
    log("[GIM] tracker probe: " .. msg)
    -- also keep the lines in the game's own saved-data store, so they can be read without screenshots
    probeSaved[#probeSaved + 1] = msg
    pcall(function() PersistentDB:SetString("gim_probe", table.concat(probeSaved, "\n"):sub(1, 14000)) end)
end
-- Names that sound like the kill tracker (slayer creatures / bosses / beasts / kill counts).
local function looksRelevant(name)
    local n = name:lower()
    return n:find("slay") or n:find("boss") or n:find("beast") or n:find("kill") or n:find("monster") or n:find("track") or n:find("creature") or n:find("npc_log")
end
local function probeDescribeValues(row, col)
    local okV, vals = pcall(function() return row:GetColumnValues(col) end)
    if not okV or type(vals) ~= "table" then return "?" end
    local parts = {}
    for i = 1, math.min(#vals, 4) do
        local v = vals[i]
        parts[#parts + 1] = type(v) == "string" and ('"' .. v:sub(1, 40) .. '"') or tostring(v)
    end
    if #vals == 0 then return "(none)" end
    return table.concat(parts, ", ")
end

local function probeStart()
    probe = { stage = "tables", next = 0, tableLast = 20000, rowLast = 90000, tables = {}, seenRows = {}, rowsPrinted = 0, misses = 0, seen = 0, shown = 0, sample = {}, matches = 0 }
    probeLog("started - looking for kill tracker tables, then their rows (about 5-6 minutes)")
end

local function probeStep()
    if probe == nil or probe.stage == "done" then return end
    if probe.stage == "tables" then
        local last = math.min(probe.next + 80 - 1, probe.tableLast)
        for tid = probe.next, last do
            local okT, tbl = pcall(function() return config.DBTable.FromID(tid) end)
            if not okT or tbl == nil then
                probe.misses = probe.misses + 1
                if probe.misses >= 700 and probe.seen > 0 then last = probe.tableLast; break end
            else
                probe.misses = 0
                local okN, name = pcall(function() return tbl.configName end)
                if okN and type(name) == "string" then
                    probe.seen = probe.seen + 1
                    if #probe.sample < 25 and probe.seen % 40 == 1 then probe.sample[#probe.sample + 1] = tid .. "=" .. name end
                end
                if okN and type(name) == "string" and looksRelevant(name) and probe.matches < 30 then
                    probe.matches = probe.matches + 1
                    local okC, cols = pcall(function() return tbl.columnCount end)
                    probe.tables[tid] = name
                    probeLog("table " .. name .. " (id " .. tid .. ", " .. tostring(okC and cols or "?") .. " columns)")
                    if okC and type(cols) == "number" then
                        for c = 1, math.min(cols, 12) do
                            local okTy, types = pcall(function() return tbl:GetColumnValueTypes(c) end)
                            local desc = {}
                            if okTy and type(types) == "table" then for _, ty in ipairs(types) do desc[#desc + 1] = tostring(ty) end end
                            probeLog("  column " .. c .. " types: " .. (#desc > 0 and table.concat(desc, ", ") or "(server only)"))
                        end
                    end
                end
            end
        end
        probe.next = last + 1
        if probe.next > probe.tableLast then
            local n = 0
            for _ in pairs(probe.tables) do n = n + 1 end
            probeLog("table scan finished: " .. probe.seen .. " tables found, " .. n .. " with a relevant-sounding name. Sample of names: " .. table.concat(probe.sample, ", "))
            if n == 0 then probe.stage = "done"; probeLog("nothing relevant by name; nothing more to scan") else probe.stage = "rows"; probe.next = 0 end
        end
        return
    end
    -- rows: ids are scanned in steps; only rows that belong to a matching table are looked at
    local last = math.min(probe.next + 400 - 1, probe.rowLast)
    for rid = probe.next, last do
        local okR, row = pcall(function() return config.DBRow.FromID(rid) end)
        if okR and row ~= nil then
            local okO, owner = pcall(function() return row.ownerDBTable.id end)
            if okO and probe.tables[owner] and (probe.seenRows[owner] or 0) < 3 then
                probe.seenRows[owner] = (probe.seenRows[owner] or 0) + 1
                local okN, rname = pcall(function() return row.configName end)
                local okC, cols = pcall(function() return row.columnCount end)
                local bits = {}
                if okC and type(cols) == "number" then
                    for c = 1, math.min(cols, 12) do bits[#bits + 1] = c .. "=" .. probeDescribeValues(row, c) end
                end
                probeLog("row " .. tostring(okN and rname or rid) .. " [" .. probe.tables[owner] .. "] " .. table.concat(bits, " | "))
            end
        end
    end
    probe.next = last + 1
    if probe.next > probe.rowLast then probe.stage = "done"; probeLog("finished") end
end

-- ── 4e. Kill tracker struct / enum probe (beta debugging; config.lua: trackerProbe = "structs") ─────────────────
-- The tracker's creatures are game "structs" with named parameters (one of them is a creature name). This probe scans the
-- enums and structs for anything named like "bslay", then prints the parameter names and values of a few structs, so the
-- creature -> counter mapping can be read straight from the game. Read-only; output is also saved (key gim_probe).
local probe2 = nil
local function p2Show(v)
    if type(v) == "string" then return '"' .. v:sub(1, 40) .. '"' end
    return tostring(v)
end

local function probe2Start()
    probe2 = { stage = "enums", next = 0, enumLast = 25000, structLast = 80000, misses = 0, enumsFound = 0, structsFound = 0,
               structsShown = 0, paramNames = {}, enumsShown = 0 }
    probeLog("struct/enum probe started (about 5-6 minutes)")
end

local function probe2Step()
    local p = probe2
    if p == nil or p.stage == "done" then return end

    if p.stage == "enums" then
        local last = math.min(p.next + 200 - 1, p.enumLast)
        for eid = p.next, last do
            local okE, en = pcall(function() return config.Enum.FromID(eid) end)
            if not okE or en == nil then
                p.misses = p.misses + 1
                if p.misses >= 1500 and p.enumsFound > 0 then last = p.enumLast; break end
            else
                p.misses = 0
                local okN, name = pcall(function() return en.configName end)
                if okN and type(name) == "string" then
                    p.enumsFound = p.enumsFound + 1
                    if name:lower():find("bslay") and p.enumsShown < 14 then
                        p.enumsShown = p.enumsShown + 1
                        local okC, count = pcall(function() return en.valueCount end)
                        local okV, vals = pcall(function() return en.values end)
                        local bits = {}
                        if okV and type(vals) == "table" then
                            for i = 1, math.min(#vals, 5) do bits[#bits + 1] = p2Show(vals[i][1]) .. "->" .. p2Show(vals[i][2]) end
                        end
                        probeLog("enum " .. name .. " (id " .. eid .. ", " .. tostring(okC and count or "?") .. " values): " .. table.concat(bits, "  "))
                    end
                end
            end
        end
        p.next = last + 1
        if p.next > p.enumLast then
            probeLog("enum scan finished: " .. p.enumsFound .. " enums, " .. p.enumsShown .. " with 'bslay' in the name")
            p.stage = "structs"; p.next = 0; p.misses = 0
        end
        return
    end

    -- structs
    local last = math.min(p.next + 150 - 1, p.structLast)
    for sid = p.next, last do
        local okS, st = pcall(function() return config.Struct.FromID(sid) end)
        if not okS or st == nil then
            p.misses = p.misses + 1
            if p.misses >= 4000 and p.structsFound > 0 then last = p.structLast; break end
        else
            p.misses = 0
            local okP, params = pcall(function() return st.params end)
            if okP and type(params) == "table" then
                local matched = false
                for _, prm in ipairs(params) do
                    local okN, pname = pcall(function() return prm.configName end)
                    if okN and type(pname) == "string" and pname:lower():find("bslay") then matched = true; p.paramNames[pname] = true end
                end
                if matched then
                    p.structsFound = p.structsFound + 1
                    if p.structsShown < 5 then
                        p.structsShown = p.structsShown + 1
                        local okC, sname = pcall(function() return st.configName end)
                        local bits = {}
                        for _, prm in ipairs(params) do
                            local okN, pname = pcall(function() return prm.configName end)
                            local okV, val = pcall(function() return st:GetParamValue(prm) end)
                            bits[#bits + 1] = tostring(okN and pname or "?") .. "=" .. (okV and p2Show(val) or "?")
                        end
                        probeLog("struct " .. tostring(okC and sname or sid) .. " (id " .. sid .. "): " .. table.concat(bits, " | "))
                    end
                end
            end
        end
    end
    p.next = last + 1
    if p.next > p.structLast then
        local names = {}
        for n in pairs(p.paramNames) do names[#names + 1] = n end
        table.sort(names)
        probeLog("struct scan finished: " .. p.structsFound .. " structs use a 'bslay' parameter. Parameter names: " .. table.concat(names, ", "))
        p.stage = "done"
        probeLog("finished")
    end
end

-- ── 4f. Kill tracker record dump (beta debugging; config.lua: trackerProbe = "bosses") ────────────────────────
-- Every boss / slayer creature of the game's tracker is a struct with a BSLAY_NAME parameter. This reads just those
-- records (name, id, a few flags) and saves one compact line each, so the creature -> counter mapping can be derived.
local probe3 = nil
local p3NameParam, p3Params = nil, {}

local function p3Value(st, paramName)
    local prm = p3Params[paramName]
    if prm == nil then
        local okP, got = pcall(function() return config.Param[paramName] end)
        prm = (okP and got ~= nil) and got or false
        p3Params[paramName] = prm
    end
    if not prm then return nil end
    local okH, has = pcall(function() return st:HasParam(prm) end)
    if not okH or not has then return nil end
    local okV, v = pcall(function() return st:GetParamValue(prm) end)
    if okV and v ~= nil then return v end
    return nil
end
local function p3Text(v)
    if v == nil then return "" end
    if type(v) == "boolean" then return v and "1" or "0" end
    return tostring(v)
end

local function p3Save(p)
    local chunk, n, size = {}, 1, 0
    local function flush()
        if #chunk > 0 then pcall(function() PersistentDB:SetString("gim_probe_" .. n, table.concat(chunk, "\n")) end); n = n + 1; chunk = {}; size = 0 end
    end
    for _, line in ipairs(p.lines) do
        if size + #line > 5500 then flush() end
        chunk[#chunk + 1] = line; size = size + #line + 1
    end
    flush()
    pcall(function() PersistentDB:SetString("gim_probe_n", tostring(n - 1)) end)
end

local function probe3Start()
    probe3 = { next = 0, last = 80000, misses = 0, found = 0, lines = {}, done = false, savedAt = 0 }
    probeLog("record dump started (about 5 minutes)")
end

local function probe3Step()
    local p = probe3
    if p == nil or p.done then return end
    local last = math.min(p.next + 200 - 1, p.last)
    for sid = p.next, last do
        local okS, st = pcall(function() return config.Struct.FromID(sid) end)
        if not okS or st == nil then
            p.misses = p.misses + 1
            if p.misses >= 4000 and p.found > 0 then last = p.last; break end
        else
            p.misses = 0
            local name = p3Value(st, "BSLAY_NAME")
            if type(name) == "string" then
                p.found = p.found + 1
                local okC, cname = pcall(function() return st.configName end)
                local line = table.concat({
                    sid, name,
                    "id=" .. p3Text(p3Value(st, "BSLAY_ID")),
                    "npc=" .. p3Text(p3Value(st, "BSLAY_NPC")):gsub("config%.NPC%.", ""),
                    "slay=" .. p3Text(p3Value(st, "BSLAY_ASSIGNABLE")),
                    "grp=" .. p3Text(p3Value(st, "BSLAY_GROUP_BOSS")),
                    "hm=" .. p3Text(p3Value(st, "BSLAY_HAS_HARDMODE")),
                    "skl=" .. p3Text(p3Value(st, "BSLAY_SKILLING_BOSS")),
                    "nt=" .. p3Text(p3Value(st, "BSLAY_NORMALMODE_TERM_ID")),
                    "ht=" .. p3Text(p3Value(st, "BSLAY_HARDMODE_TERM_ID")),
                    (okC and cname or "")
                }, "|")
                p.lines[#p.lines + 1] = line
                if p.found <= 6 then probeLog("record " .. line) end
                if p.found - p.savedAt >= 25 then p.savedAt = p.found; p3Save(p) end
            end
        end
    end
    p.next = last + 1
    if p.next > p.last then
        p.done = true
        p3Save(p)
        probeLog("record dump finished: " .. p.found .. " records saved")
    end
end

-- ── 4g. Boss record parameter dump (beta debugging; config.lua: trackerProbe = "params") ─────────────────────────
-- The boss records are structs. This prints EVERY parameter (name and value) of a few of them, and the combined list of
-- parameter names used by all of them, to find the parameter that points at the kill counter.
local P4_ALL = { "BSLAY_DUNGEON_ULTHVEN1", "BSLAY_DUNGEON_ULTHVEN2", "BSLAY_DUNGEON_ULTHVEN3", "BSLAY_ARAXXI", "BSLAY_BARROWS", "BSLAY_ROTS", "BSLAY_CHAOS_ELEMENTAL", "BSLAY_ZILYANA", "BSLAY_CORP_BEAST", "BSLAY_DAG_KINGS", "BSLAY_GRAARDOR", "BSLAY_MOLE", "BSLAY_HARAKEN", "BSLAY_KALPHITE_KING", "BSLAY_KALPHITE_QUEEN", "BSLAY_KBD", "BSLAY_KREEARRA", "BSLAY_KRIL", "BSLAY_LEGIONES", "BSLAY_NEX", "BSLAY_QBD", "BSLAY_JAD", "BSLAY_VORAGO", "BSLAY_BEASTMASTER", "BSLAY_YAKAMARU", "BSLAY_VINDICTA", "BSLAY_HELWYR", "BSLAY_TWINDEMONS", "BSLAY_SLISKE", "BSLAY_GWD2_SOLO_BOSS", "BSLAY_NEX2", "BSLAY_MENAPHOS_SLAYER_BOSS", "BSLAY_SOLAK", "BSLAY_DUNGEON_AMINISHI1", "BSLAY_DUNGEON_AMINISHI2", "BSLAY_DUNGEON_AMINISHI3", "BSLAY_DUNGEON_DRAGONFORT1", "BSLAY_DUNGEON_DRAGONFORT2", "BSLAY_DUNGEON_DRAGONFORT3", "BSLAY_DINO_BOSS", "BSLAY_REXKINGS", "BSLAY_EGWD_JAS_BOSS", "BSLAY_EGWD_WEN_BOSS", "BSLAY_EGWD_BIK_BOSS", "BSLAY_EGWD_FUL_BOSS", "BSLAY_EGWD_ZAMORAK_BOSS", "BSLAY_HERMOD_BOSS", "BSLAY_RASIAL_BOSS", "BSLAY_FORT_BOSS_ZEMO_VORKATH", "BSLAY_REXKINGS_OSSEOUS", "BSLAY_RAID_REBIRTH1_WYRM_BOSS", "BSLAY_RAID_REBIRTH1_BEAST_BOSS", "BSLAY_RAID_REBIRTH1_SLAYER_MASTER_BOSS", "BSLAY_ELIDINIS_BOSS", "BSLAY_AMASCUT_BOSS", "BSLAY_STALKER_BOSS", "BSLAY_WENDLE_GIANT_BOSS", "BSLAY_WENDLE_HEDGEHOG_BOSS", "BSLAY_BLOOD_KNIGHT_BOSS" }
local P4_SHOW = { "BSLAY_BARROWS", "BSLAY_KBD", "BSLAY_KRIL", "BSLAY_HERMOD_BOSS", "BSLAY_STALKER_BOSS" }
local probe4 = nil

local function p4Describe(st)
    local okP, params = pcall(function() return st.params end)
    if not okP or type(params) ~= "table" then return "(no params)" end
    local bits = {}
    for _, prm in ipairs(params) do
        local okN, pname = pcall(function() return prm.configName end)
        local okT, ptype = pcall(function() return prm.valueType end)
        local okV, val = pcall(function() return st:GetParamValue(prm) end)
        local shown = okV and (type(val) == "string" and ('"' .. val:sub(1, 30) .. '"') or tostring(val)) or "<unreadable>"
        bits[#bits + 1] = tostring(okN and pname or "?") .. "[" .. tostring(okT and ptype or "?") .. "]=" .. shown
    end
    return table.concat(bits, " | ")
end

local function probe4Run()
    probe4 = true
    probeLog("parameter dump started")
    for _, name in ipairs(P4_SHOW) do
        local okS, st = pcall(function() return config.Struct[name] end)
        if okS and st ~= nil then probeLog(name .. ": " .. p4Describe(st)) else probeLog(name .. ": not found") end
    end
    -- union of parameter names (with their value type) across every boss record
    local union, order = {}, {}
    for _, name in ipairs(P4_ALL) do
        local okS, st = pcall(function() return config.Struct[name] end)
        if okS and st ~= nil then
            local okP, params = pcall(function() return st.params end)
            if okP and type(params) == "table" then
                for _, prm in ipairs(params) do
                    local okN, pname = pcall(function() return prm.configName end)
                    if okN and type(pname) == "string" and not union[pname] then
                        local okT, ptype = pcall(function() return prm.valueType end)
                        union[pname] = tostring(okT and ptype or "?")
                        order[#order + 1] = pname
                    end
                end
            end
        end
    end
    table.sort(order)
    local parts = {}
    for _, n in ipairs(order) do parts[#parts + 1] = n .. "[" .. union[n] .. "]" end
    probeLog("parameter names across all boss records: " .. table.concat(parts, ", "))
    probeLog("finished")
end

-- ── 4h. Boss kill counters via the boss achievements (beta debugging; config.lua: trackerProbe = "tallies") ───────
-- Each boss record links to an achievement (BSLAY_ACHIEVEMENT) whose progress counter may be the kill count. Prints, for
-- every boss, its name and that counter so the numbers can be compared with the game's kill tracker.
local probe5 = nil
local function probe5Run()
    probe5 = true
    probeLog("tally probe started")
    for _, name in ipairs(P4_ALL) do
        local okS, st = pcall(function() return config.Struct[name] end)
        if okS and st ~= nil then
            local title = p3Value(st, "BSLAY_NAME")
            local ach = p3Value(st, "BSLAY_ACHIEVEMENT")
            local tp, tt, an
            if ach ~= nil then pcall(function() tp = ach.tallyProgress; tt = ach.tallyTarget; an = ach.name end) end
            probeLog(tostring(title) .. " => " .. tostring(tp) .. " / " .. tostring(tt) .. "  (" .. tostring(an) .. ")")
        end
    end
    probeLog("finished")
end

-- ── 5. Kills ──────────────────────────────────────────────────────────────────
-- The game announces "an NPC was removed" for deaths but also for NPCs that merely leave your view. So a
-- removal only counts as YOUR kill when it is the monster named on your target display, its health moved
-- a moment ago, and it was right next to you.
local engagedName, engagedAt, lastHp = nil, -1000, nil
local killTally = {}        -- npc name -> kills counted since the last batch was formed
local killBatch = nil       -- { ref, entries } formed and sent, waiting for the server's confirmation
local killBatchCounter = 0
local recentKills = {}      -- for drops: { name, tile, at }
local pendingGround = {}    -- loot seen BEFORE its kill was registered: { objId, count, tile, at }
local claimPendingGround    -- assigned in the drops section; called when a kill is registered

local function stripTags(s) return (s:gsub("<[^>]*>", ""):gsub("^%s+", ""):gsub("%s+$", "")) end

local function componentText(componentId)
    local ok, comp = pcall(function() return ui.Interfaces:GetComponent(componentId) end)
    if not ok or comp == nil then return nil end
    local okT, text = pcall(function() return comp.text end)
    if okT and type(text) == "string" then return text end
    local okC, content = pcall(function() return comp.content end)
    if okC and type(content) == "string" then return content end
    return nil
end

local NO_TARGET = { ["no target"] = true, ["tap to find target"] = true, ["click to find target"] = true, ["select a target"] = true }

-- Called every couple of ticks: remember who we are fighting and when its health last changed.
local lastLoggedTarget, warnedNoTarget = nil, false
local function readTarget()
    local raw = componentText(id.Component.TOPLEVEL_V2_TARGET_INFO__NAME)
    if raw == nil and not warnedNoTarget then
        warnedNoTarget = true
        log("[GIM] kills: the target name display cannot be read (component has no text/content)")
    end
    local name = raw and stripTags(raw) or ""
    if name == "" or NO_TARGET[name:lower()] then lastHp = nil; return end
    local hp = componentText(id.Component.TOPLEVEL_V2_TARGET_INFO__ENTITY_HEALTH_LEFT)
    if name ~= lastLoggedTarget then
        lastLoggedTarget = name
        trace('kills: target is now "' .. name .. '" health text = ' .. tostring(hp))
    end
    if name ~= engagedName or hp ~= lastHp then
        engagedName, engagedAt, lastHp = name, ticks, hp
    end
end

local npcLogBudget = 40   -- how many removal decisions to print (they can be frequent in busy places)
local function onNpcRemoved(event)
    local ok, name, grid = pcall(function() return event.npcEntity.displayName, event.npcEntity.coordGrid end)
    if not ok or type(name) ~= "string" or name == "" or grid == nil then
        if npcLogBudget > 0 then npcLogBudget = npcLogBudget - 1; log("[GIM] kills: NPC removed but name/position unreadable: " .. tostring(name)) end
        return
    end
    local age = ticks - engagedAt
    local where = tileOf(grid)
    local okP, me = pcall(Player.GetEntity)
    local mine = okP and me ~= nil and tileOf(me.coordGrid) or nil
    local isNear = near(where, mine, KILL_NEAR_TILES)
    local counted = name == engagedName and age <= KILL_CREDIT_TICKS and isNear
    if npcLogBudget > 0 and (engagedName ~= nil and (name == engagedName or age <= 40)) then
        npcLogBudget = npcLogBudget - 1
        log('[GIM] kills: NPC removed "' .. name .. '" target="' .. tostring(engagedName) .. '" health-moved ' .. age
            .. ' ticks ago, near=' .. tostring(isNear) .. ' -> ' .. (counted and "COUNTED" or "not counted"))
    end
    if not counted then return end

    killTally[name] = (killTally[name] or 0) + 1
    recentKills[#recentKills + 1] = { name = name, tile = where, at = ticks }
    if claimPendingGround then claimPendingGround(recentKills[#recentKills]) end
    markItemsDirty()
end

local function recentKillNear(tile)
    local best
    for _, k in ipairs(recentKills) do
        if ticks - k.at <= DROP_WINDOW_TICKS and (tile == nil or near(k.tile, tile, DROP_NEAR_TILES)) then
            if best == nil or k.at > best.at then best = k end
        end
    end
    return best
end

-- ── 6. Drops ──────────────────────────────────────────────────────────────────
-- An item is a drop when it shows up on the ground for you (or lands in your backpack) right after one of
-- your kills. It is only reported when it is valuable or named in the group's boss drop tables; the rules
-- come from the server (GET /api/plugin/config) so the group can change them without a new plugin.
local rules = nil           -- { threshold = number, rare = { [lowercase item name] = true } }
local rulesAskedAt = -1000
local dropQueue = {}        -- drops waiting for the server to confirm
local fromGround = {}       -- obj id -> tick it appeared on the ground (so picking it up is not counted twice)
local packBefore = nil
local packDirtyAt = nil
local session = tostring(math.random(100000, 999999))
local dropCounter = 0

local function worthReporting(objId, quantity)
    if rules == nil then return false end
    local info = describeObj(objId)
    if rules.rare[info.name:lower()] then return true end
    return rules.threshold > 0 and info.value * quantity >= rules.threshold
end

local function queueDrop(objId, quantity, kill)
    if #dropQueue >= 60 or kill == nil or not worthReporting(objId, quantity) then return end
    dropCounter = dropCounter + 1
    local info = describeObj(objId)
    dropQueue[#dropQueue + 1] = {
        ref = session .. "-" .. dropCounter,    -- the server uses this to drop duplicates when a send is retried
        id = objId, name = info.name, quantity = math.floor(quantity), value = info.value,
        npc = kill.name, ts = nowIso(),
    }
    markItemsDirty()
end

local groundLogBudget = 40
local function groundTile(event)
    local ok, grid = pcall(function() return event.coordGrid end)
    if ok and grid ~= nil then return tileOf(grid) end
    local ok2, grid2 = pcall(function() return event.objStackEntity.coordGrid end)
    if ok2 and grid2 ~= nil then return tileOf(grid2) end
    return nil
end

-- Loot can appear on the ground slightly BEFORE the game announces the monster's removal, so an item that
-- has no kill yet waits in pendingGround and is matched when the kill arrives.
claimPendingGround = function(kill)
    local keep = {}
    for _, p in ipairs(pendingGround) do
        local fresh = ticks - p.at <= DROP_WINDOW_TICKS
        if fresh and (p.tile == nil or near(kill.tile, p.tile, DROP_NEAR_TILES)) then
            fromGround[p.objId] = ticks
            queueDrop(p.objId, p.count, kill)
        elseif fresh then
            keep[#keep + 1] = p
        end
    end
    pendingGround = keep
end

local function onGroundItem(event)
    local okI, objId = pcall(function() return event.objType.id end)
    if not okI or type(objId) ~= "number" then return end
    local okO, owner = pcall(function() return event.isOwner end)
    local okC, count = pcall(function() return event.count end)
    count = okC and type(count) == "number" and count or 1
    local tile = groundTile(event)
    local kill = recentKillNear(tile)
    if groundLogBudget > 0 and (kill ~= nil or #recentKills > 0 or #pendingGround >= 0) then
        groundLogBudget = groundLogBudget - 1
        log('[GIM] drops: ground item "' .. describeObj(objId).name .. '" x' .. tostring(count) .. " isOwner=" .. tostring(owner)
            .. " position=" .. tostring(tile ~= nil) .. " matching kill=" .. tostring(kill ~= nil and kill.name or "none yet"))
    end
    if not okO or owner ~= true then return end                 -- only items dropped FOR us
    if kill == nil then
        if #pendingGround < 30 then pendingGround[#pendingGround + 1] = { objId = objId, count = count, tile = tile, at = ticks } end
        return
    end
    fromGround[objId] = ticks
    queueDrop(objId, count, kill)
end

local HAND_WINDOWS = { id.Interface.BANK, id.Interface.GROUP_IRONMAN_STORAGE, id.Interface.STOCKMARKET,
                       id.Interface.STOCKCOLLECT, id.Interface.SHOP_MAIN, id.Interface.TRADEMAIN, id.Interface.TRADECONFIRM }
local function movingItemsByHand()
    for _, window in ipairs(HAND_WINDOWS) do if isOpen(window) then return true end end
    return false
end

-- Loot that goes straight into the backpack (auto-loot) never appears on the ground: compare backpack totals.
local function scanBackpack()
    local list = readInv(id.Inv.INV, 100)
    if list == nil then packBefore = nil; return end
    local now = totals(list)
    local before = packBefore
    packBefore = now
    if before == nil or movingItemsByHand() then return end
    local kill = recentKillNear(nil)
    if kill == nil then return end
    for objId, it in pairs(now) do
        local had = before[objId] and before[objId].count or 0
        local fromFloor = fromGround[objId] ~= nil and ticks - fromGround[objId] <= 100
        if it.count > had and not fromFloor then queueDrop(objId, it.count - had, kill) end
    end
end

local function fetchRules()
    rulesAskedAt = ticks
    local okReq, request = newRequest(Plugin.urls.gim, "/api/plugin/config")
    if not okReq or request == nil then return end
    request:AddHeader("Authorization", "Bearer " .. settings.token)
    local function done()
        if request.successful and request.responseCode == 200 then
            local okJ, doc = pcall(json.decode, request.data or "")
            if okJ and type(doc) == "table" and type(doc.rare_names) == "table" then
                local rare = {}
                for _, name in ipairs(doc.rare_names) do rare[tostring(name):lower()] = true end
                rules = { threshold = tonumber(doc.drop_threshold) or 0, rare = rare }
            end
        end
    end
    request:Get(done)
end

-- ── 7. Sending ────────────────────────────────────────────────────────────────
local function send()
    if inFlight or stopped then return end
    local rsn = characterName()
    if rsn == nil or not Player.IsAvailable() then return end   -- not in a world yet

    trace("send: reading skills")
    local payload = { v = PAYLOAD_VERSION, rsn = rsn }
    if dirty.skills then payload.skills = readSkills() end

    trace("send: reading backpack and worn items")
    local backpack = readInv(id.Inv.INV, 100)
    if backpack then payload.inventory = backpack end
    local worn = readInv(id.Inv.WORN, 30)
    if worn then payload.equipment = worn end

    trace("send: reading position")
    local pos = readPosition()
    if pos then payload.position = pos end

    -- Bank and group storage: only look while their window is open (see isOpen).
    -- Deposits/withdrawals are frozen into one batch with its own reference and re-sent unchanged until the
    -- server confirms it (the server ignores a reference it already applied), so a lost response can never
    -- log a deposit twice. While a batch is waiting, new bank changes are picked up after it is confirmed.
    local seen, changes = {}, {}
    for _, store in ipairs(STORES) do
        if isOpen(store.window) then
            local list = readInv(store.inv, MAX_BANK_ITEMS)
            if list then
                local now = totals(list)
                seen[store] = now
                if changeBatch == nil and store.journal then
                    for _, c in ipairs(diff(store, now)) do changes[#changes + 1] = c end
                end
                if store.field then payload[store.field] = list end
            end
        end
    end
    if changeBatch == nil and #changes > 0 then
        changeBatchCounter = changeBatchCounter + 1
        changeBatch = { ref = session .. "-c" .. changeBatchCounter, changes = changes, seen = seen }
    end
    local sentBatch = changeBatch
    if sentBatch then payload.storage_changes = sentBatch.changes; payload.changes_ref = sentBatch.ref end

    -- Quests: whatever the last finished scan found that the server does not know yet.
    local sentQuests = questChanges
    if sentQuests then
        payload.quests = sentQuests
        if not questBaselineDone then payload.quests_full = true end
    end

    -- Achievements: the newly completed ones found by the last finished scan (at most ACH_MAX_PER_SEND at once).
    local sentAch
    if achChanges then
        sentAch = {}
        for i = 1, math.min(#achChanges, ACH_MAX_PER_SEND) do sentAch[i] = achChanges[i] end
        payload.achievements = sentAch
        if not achBaselineDone then payload.achievements_full = true end
    end

    -- The game's own kill tracker variables (raw): whatever changed since the server last accepted them.
    local sentKillVars = killVarsChanged
    if sentKillVars then payload.kill_vars = sentKillVars end

    -- Kills: pending kills are frozen into one batch with its own reference. The batch is re-sent unchanged
    -- until the server confirms it, and the server ignores a reference it has already applied - so a lost
    -- response can never make one kill count twice.
    if killBatch == nil and next(killTally) ~= nil then
        local entries = {}
        for npc, count in pairs(killTally) do entries[#entries + 1] = { npc = npc, kills = count } end
        killTally = {}
        killBatchCounter = killBatchCounter + 1
        killBatch = { ref = session .. "-k" .. killBatchCounter, entries = entries }
    end
    if killBatch then payload.kills = killBatch.entries; payload.kills_ref = killBatch.ref end
    local sentKills = killBatch

    -- Drops: the oldest few are sent; confirmed ones are removed after a successful send.
    local sentDrops
    if #dropQueue > 0 then
        sentDrops = {}
        for i = 1, math.min(#dropQueue, MAX_DROPS_PER_SEND) do sentDrops[i] = dropQueue[i] end
        payload.drops = sentDrops
    end

    trace("send: encoding payload")
    local okEnc, body = pcall(json.encode, payload)
    if not okEnc then log("[GIM] could not encode payload: " .. tostring(body)); return end

    if DRY_RUN then
        log("[GIM] dry run - would send " .. #body .. " bytes: " .. body:sub(1, 160) .. (#body > 160 and "..." or ""))
        lastSendTick = ticks
        dirty.items = false
        return
    end
    trace("send: creating request")

    local okReq, request = newRequest(Plugin.urls.gim, "/api/plugin/ingest")
    if not okReq or request == nil then log("[GIM] could not create request: " .. tostring(request)); return end
    request:AddHeader("Authorization", "Bearer " .. settings.token)
    request:AddHeader("Content-Type", "application/json")

    local sentSkills = payload.skills ~= nil
    inFlight = true
    lastSendTick = ticks

    local function done()
        inFlight = false
        if request.successful and request.responseCode == 200 then
            -- Delivered: the server now holds these, so they become the new baseline.
            if sentBatch then
                for store, now in pairs(sentBatch.seen) do store.held = now end
                if changeBatch == sentBatch then changeBatch = nil end
            else
                for store, now in pairs(seen) do store.held = now end
            end
            if sentSkills then dirty.skills = false end
            dirty.items = false
            if sentQuests then
                for _, q in ipairs(sentQuests) do questHeld[q.id] = q.state end
                questBaselineDone = true
                if questChanges == sentQuests then questChanges = nil end
            end
            if sentKillVars then
                for name, value in pairs(sentKillVars) do killVarsHeld[name] = value end
                if killVarsChanged == sentKillVars then killVarsChanged = nil end
            end
            if sentAch then
                for _, a in ipairs(sentAch) do
                    if a.completed == false then achSeenOpen[a.id] = a.tally_progress or -1 else achHeld[a.id] = true end
                end
                local rest = {}
                for i = #sentAch + 1, #achChanges do rest[#rest + 1] = achChanges[i] end
                achChanges = #rest > 0 and rest or nil
                if achChanges == nil then achBaselineDone = true end
                if achChanges then markItemsDirty() end
            end
            if sentKills and killBatch == sentKills then killBatch = nil end
            if sentDrops then
                local confirmed = {}
                for _, d in ipairs(sentDrops) do confirmed[d.ref] = true end
                local rest = {}
                for _, d in ipairs(dropQueue) do if not confirmed[d.ref] then rest[#rest + 1] = d end end
                dropQueue = rest
            end
            return
        end
        local status = request.responseCode
        if status == 401 or status == 409 then
            -- Revoked token, or the token belongs to a different character. Retrying cannot help.
            stopped = true
            log("[GIM] the server rejected this token (HTTP " .. tostring(status) .. "). Check config.lua and that you are logged in as the right character. Sending stopped.")
        else
            log("[GIM] send failed (HTTP " .. tostring(status) .. ") " .. tostring(request.errorInfo or "") .. " - will retry")
        end
    end

    request:Post(body, done)
    trace("send: request handed to the game")   -- the second callback of Post/Get is for download PROGRESS, so only completion is given
end

-- ── Network probe (beta debugging only) ──────────────────────────────────────────
-- config.lua: probe = "local"  -> one GET to <urls.gim>/api/health   (plain http to localhost)
--             probe = "https"  -> one GET to <urls.probe>/zen        (a public https address)
-- Runs once, about 12 seconds after you are in the game, and prints every step so a crash shows where.
local probeDone = false
local function runProbe()
    probeDone = true
    local kind = settings.probe
    local base, path = nil, nil
    if kind == "local" then base, path = Plugin.urls.gim, "/api/health"
    elseif kind == "https" then base, path = Plugin.urls.probe, "/zen" end
    if base == nil then log("[GIM] probe: unknown kind or missing url for " .. tostring(kind)); return end
    trace("probe 1/4: about to check httpAccess")
    log("[GIM] probe 1/4: has httpAccess = " .. tostring(Plugin.HasPermission(PluginPermissions.httpAccess)))
    trace("probe 2/4: about to create request " .. tostring(kind) .. " " .. path)
    local okReq, request = newRequest(base, path)
    if not okReq or request == nil then log("[GIM] probe: could not create request: " .. tostring(request)); return end
    trace("probe 3/4: request created, about to call Get")
    request:Get(function()
        breadcrumb("probe 4/4: callback reached")
        log("[GIM] probe 4/4: finished. successful=" .. tostring(request.successful) .. " code=" .. tostring(request.responseCode)
            .. " error=" .. tostring(request.errorInfo) .. " data=" .. tostring(request.data):sub(1, 80))
    end)
    trace("probe: Get returned")
end

-- ── 8. Scheduling ─────────────────────────────────────────────────────────────
local function onInventoryEvent() markItemsDirty(); if FEATURES.drops then packDirtyAt = ticks end end

Event.SkillTransmit.Subscribe("gim_skill", function() dirty.skills = true end)
Event.InventoryUpdated.Subscribe("gim_inv_updated", onInventoryEvent)
Event.InventoryAdded.Subscribe("gim_inv_added", onInventoryEvent)
Event.InventoryRemoved.Subscribe("gim_inv_removed", onInventoryEvent)
if FEATURES.kills then Event.NPCEntityRemoved.Subscribe("gim_npc_removed", onNpcRemoved) end
if FEATURES.drops then Event.ObjStackEntityAdded.Subscribe("gim_ground_item", onGroundItem) end

-- A new login (or world hop) means the old baselines may be stale: forget them so the first bank view
-- after logging in is a fresh baseline, quests are re-sent in full, and pending fight state is dropped.
Event.GameStateChanged.Subscribe("gim_state", function(event)
    if event.newState ~= GameState.GAME then
        for _, store in ipairs(STORES) do store.held = nil end
        questHeld, questBaselineDone, lastQuestCheck, questScan, questChanges = {}, false, -QUEST_RECHECK, nil, nil
        achHeld, achSeenOpen, achBaselineDone, lastAchCheck, achScan, achChanges = {}, {}, false, -ACH_RECHECK, nil, nil
        killVarsHeld, killVarsChanged, lastKillVarCheck = {}, nil, -KILLVAR_RECHECK
        engagedName, lastHp, recentKills, fromGround, packBefore = nil, nil, {}, {}, nil
        rules = nil
        dirty.skills, dirty.items = true, true
    end
end)

Event.ServerLogic.Subscribe("gim_tick", function()
    ticks = ticks + 1
    if FEATURES.kills and ticks % 2 == 0 then readTarget() end

    if FEATURES.quests and Player.IsAvailable() then
        if questScan ~= nil then questScanStep()
        elseif ticks - lastQuestCheck >= QUEST_RECHECK then questScanStart() end
    end

    -- Drop rules: fetch when logged in and missing; retry about every 3 minutes if the server did not answer.
    if FEATURES.killtracker and Player.IsAvailable() and ticks - lastKillVarCheck >= KILLVAR_RECHECK then scanKillVars() end

    if settings.trackerProbe == true and Player.IsAvailable() then
        if probe == nil then probeStart() else probeStep() end
    end
    if settings.trackerProbe == "tallies" and Player.IsAvailable() and probe5 == nil and ticks > 40 then probe5Run() end
    if settings.trackerProbe == "params" and Player.IsAvailable() and probe4 == nil and ticks > 40 then probe4Run() end
    if settings.trackerProbe == "bosses" and Player.IsAvailable() then
        if probe3 == nil then probe3Start() else probe3Step() end
    end
    if settings.trackerProbe == "structs" and Player.IsAvailable() then
        if probe2 == nil then probe2Start() else probe2Step() end
    end

    if FEATURES.achievements and Player.IsAvailable() then
        if achScan ~= nil then achScanStep()
        elseif ticks - lastAchCheck >= ACH_RECHECK then achScanStart() end
    end

    if FEATURES.drops and not DRY_RUN and rules == nil and ticks - rulesAskedAt >= 300 and Player.IsAvailable() then trace("fetching drop rules"); fetchRules() end

    if settings.probe and not probeDone and ticks >= 20 and Player.IsAvailable() then runProbe() end

    -- A backpack change is examined once it has settled (so several items from one kill arrive together).
    if packDirtyAt ~= nil and ticks - packDirtyAt >= 2 then packDirtyAt = nil; scanBackpack() end

    if ticks % 10 == 0 then
        local freshGround = {}
        for _, p in ipairs(pendingGround) do if ticks - p.at <= DROP_WINDOW_TICKS then freshGround[#freshGround + 1] = p end end
        pendingGround = freshGround
        local keep = {}
        for _, k in ipairs(recentKills) do if ticks - k.at <= 200 then keep[#keep + 1] = k end end
        recentKills = keep
    end

    if dirty.items then settle = settle + 1 end
    local sinceLast = ticks - lastSendTick
    local itemsReady = dirty.items and settle >= SETTLE_TICKS
    if (itemsReady and sinceLast >= MIN_GAP_TICKS) or sinceLast >= HEARTBEAT_TICKS then
        send()
    end
end)

log("[GIM] GIM Companion started. Sending to " .. tostring(Plugin.urls.gim) .. " - your own character only.")
