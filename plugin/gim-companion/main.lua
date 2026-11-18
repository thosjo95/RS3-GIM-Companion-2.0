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
--   5. Kills        - NPC kills of the monster you are fighting
--   6. Drops        - valuable items that appear after one of your kills
--   7. Sending      - one JSON POST, retried until the server confirms (nothing is lost on a failed request)
--   8. Scheduling   - events mark data "dirty"; a slow tick sends it, a heartbeat keeps the dashboard live

local json = require("json")

-- The game's console prints with the standard `print`; this wrapper keeps every message recognisable.
local function log(...) print(...) end

-- ── 1. Settings ───────────────────────────────────────────────────────────────
-- NB: `config` is the game API's own global (config.Obj ...), so our settings use another name.
local okSettings, settings = pcall(require, "config")
if not okSettings or type(settings) ~= "table" or type(settings.token) ~= "string" or not settings.token:find("^gimp_") then
    log("[GIM] config.lua missing or invalid - copy config.example.lua to config.lua and paste your token. Plugin idle.")
    return
end

if not Plugin.HasPermission(PluginPermissions.httpAccess) then
    log("[GIM] httpAccess permission not granted - the plugin cannot send data. Plugin idle.")
    log("[GIM] Fix: run   ppe gim-companion httpAccess   then   prl gim-companion")
    return
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
-- The dashboard ledger records deposits/withdrawals. For each store we remember the totals the server has
-- ALREADY ACCEPTED ("held"); a change is only counted as delivered once a send succeeds, so a failed
-- request simply tries again with nothing lost.
local STORES = {
    { key = "bank",  field = "bank", window = id.Interface.BANK,                    inv = id.Inv.BANK,                          held = nil },
    { key = "group", field = nil,    window = id.Interface.GROUP_IRONMAN_STORAGE,   inv = id.Inv.GROUP_IRONMAN_STORAGE_CLAN_TEMP, held = nil },
}

local function nowIso()
    -- Only a well-formed UTC stamp is used; otherwise nil and the server stamps the change on arrival.
    local ok, stamp = pcall(os.date, "!%Y-%m-%dT%H:%M:%SZ")
    if ok and type(stamp) == "string" and stamp:find("^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%dZ$") then return stamp end
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
        local state = "not_started"
        if quest.hasFinishedQuest then state = "finished" elseif quest.hasStartedQuest then state = "started" end
        return { id = questId, name = quest.name, state = state, members = quest.isMembers and true or false, points = quest.questPoints }
    end)
    if not okR or type(entry.name) ~= "string" or entry.name == "" then return nil end
    if type(entry.points) ~= "number" then entry.points = nil end
    return entry
end

-- Returns the quests whose state differs from what the server holds (all of them for the first call).
local function sweepQuests()
    local changed, seen, misses = {}, 0, 0
    for questId = 0, QUEST_SCAN_LIMIT - 1 do
        local entry = readQuest(questId)
        if entry == nil then
            misses = misses + 1
            if misses >= QUEST_MISS_LIMIT and seen > 0 then break end
        else
            misses = 0
            seen = seen + 1
            if questHeld[questId] ~= entry.state then changed[#changed + 1] = entry end
        end
    end
    return seen > 0 and changed or nil
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

local function stripTags(s) return (s:gsub("<[^>]*>", ""):gsub("^%s+", ""):gsub("%s+$", "")) end

local function componentText(componentId)
    local ok, comp = pcall(function() return ui.Interfaces:GetComponent(componentId) end)
    if not ok or comp == nil then return nil end
    local okT, text = pcall(function() return comp.text end)
    if okT and type(text) == "string" then return text end
    return nil
end

local NO_TARGET = { ["no target"] = true, ["tap to find target"] = true, ["click to find target"] = true, ["select a target"] = true }

-- Called every couple of ticks: remember who we are fighting and when its health last changed.
local function readTarget()
    local raw = componentText(id.Component.TOPLEVEL_V2_TARGET_INFO__NAME)
    local name = raw and stripTags(raw) or ""
    if name == "" or NO_TARGET[name:lower()] then lastHp = nil; return end
    local hp = componentText(id.Component.TOPLEVEL_V2_TARGET_INFO__ENTITY_HEALTH_LEFT)
    if name ~= engagedName or hp ~= lastHp then
        engagedName, engagedAt, lastHp = name, ticks, hp
    end
end

local function onNpcRemoved(event)
    local ok, name, grid = pcall(function() return event.npcEntity.displayName, event.npcEntity.coordGrid end)
    if not ok or type(name) ~= "string" or name == "" or grid == nil then return end
    if name ~= engagedName or ticks - engagedAt > KILL_CREDIT_TICKS then return end
    local where = tileOf(grid)
    local okP, me = pcall(Player.GetEntity)
    local mine = okP and me ~= nil and tileOf(me.coordGrid) or nil
    if not near(where, mine, KILL_NEAR_TILES) then return end

    killTally[name] = (killTally[name] or 0) + 1
    recentKills[#recentKills + 1] = { name = name, tile = where, at = ticks }
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

local function onGroundItem(event)
    local okI, objId = pcall(function() return event.objType.id end)
    if not okI or type(objId) ~= "number" then return end
    local okO, owner = pcall(function() return event.isOwner end)
    if not okO or owner ~= true then return end                 -- only items dropped FOR us
    local okG, grid = pcall(function() return event.coordGrid end)
    local kill = okG and grid ~= nil and recentKillNear(tileOf(grid)) or nil
    if kill == nil then return end
    fromGround[objId] = ticks
    local okC, count = pcall(function() return event.count end)
    queueDrop(objId, okC and type(count) == "number" and count or 1, kill)
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
    local okReq, request = pcall(HTTPRequest.new, Plugin.urls.gim, "/api/plugin/config")
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

    local payload = { v = PAYLOAD_VERSION, rsn = rsn }
    if dirty.skills then payload.skills = readSkills() end

    local backpack = readInv(id.Inv.INV, 100)
    if backpack then payload.inventory = backpack end
    local worn = readInv(id.Inv.WORN, 30)
    if worn then payload.equipment = worn end

    local pos = readPosition()
    if pos then payload.position = pos end

    -- Bank and group storage: only look while their window is open (see isOpen).
    local seen, changes = {}, {}
    for _, store in ipairs(STORES) do
        if isOpen(store.window) then
            local list = readInv(store.inv, MAX_BANK_ITEMS)
            if list then
                local now = totals(list)
                seen[store] = now
                for _, c in ipairs(diff(store, now)) do changes[#changes + 1] = c end
                if store.field then payload[store.field] = list end
            end
        end
    end
    if #changes > 0 then payload.storage_changes = changes end

    -- Quests: re-read about once a minute; send only what the server does not know yet.
    local sentQuests
    if ticks - lastQuestCheck >= QUEST_RECHECK then
        lastQuestCheck = ticks
        sentQuests = sweepQuests()
        if sentQuests and #sentQuests > 0 then
            payload.quests = sentQuests
            if not questBaselineDone then payload.quests_full = true end
        else
            sentQuests = nil
        end
    end

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

    local okEnc, body = pcall(json.encode, payload)
    if not okEnc then log("[GIM] could not encode payload: " .. tostring(body)); return end

    local okReq, request = pcall(HTTPRequest.new, Plugin.urls.gim, "/api/plugin/ingest")
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
            for store, now in pairs(seen) do store.held = now end
            if sentSkills then dirty.skills = false end
            dirty.items = false
            if sentQuests then
                for _, q in ipairs(sentQuests) do questHeld[q.id] = q.state end
                questBaselineDone = true
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
            if sentQuests then lastQuestCheck = -QUEST_RECHECK end   -- re-read the quests on the next send
        end
    end

    request:Post(body, done)   -- the second callback of Post/Get is for download PROGRESS, so only completion is given
end

-- ── 8. Scheduling ─────────────────────────────────────────────────────────────
local function onInventoryEvent() markItemsDirty(); packDirtyAt = ticks end

Event.SkillTransmit.Subscribe("gim_skill", function() dirty.skills = true end)
Event.InventoryUpdated.Subscribe("gim_inv_updated", onInventoryEvent)
Event.InventoryAdded.Subscribe("gim_inv_added", onInventoryEvent)
Event.InventoryRemoved.Subscribe("gim_inv_removed", onInventoryEvent)
Event.NPCEntityRemoved.Subscribe("gim_npc_removed", onNpcRemoved)
Event.ObjStackEntityAdded.Subscribe("gim_ground_item", onGroundItem)

-- A new login (or world hop) means the old baselines may be stale: forget them so the first bank view
-- after logging in is a fresh baseline, quests are re-sent in full, and pending fight state is dropped.
Event.GameStateChanged.Subscribe("gim_state", function(event)
    if event.newState ~= GameState.GAME then
        for _, store in ipairs(STORES) do store.held = nil end
        questHeld, questBaselineDone, lastQuestCheck = {}, false, -QUEST_RECHECK
        engagedName, lastHp, recentKills, fromGround, packBefore = nil, nil, {}, {}, nil
        rules = nil
        dirty.skills, dirty.items = true, true
    end
end)

Event.ServerLogic.Subscribe("gim_tick", function()
    ticks = ticks + 1
    if ticks % 2 == 0 then readTarget() end

    -- Drop rules: fetch when logged in and missing; retry about every 3 minutes if the server did not answer.
    if rules == nil and ticks - rulesAskedAt >= 300 and Player.IsAvailable() then fetchRules() end

    -- A backpack change is examined once it has settled (so several items from one kill arrive together).
    if packDirtyAt ~= nil and ticks - packDirtyAt >= 2 then packDirtyAt = nil; scanBackpack() end

    if ticks % 10 == 0 then
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
