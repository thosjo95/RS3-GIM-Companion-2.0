-- GIM Companion — sends YOUR OWN character's skills, backpack, worn items, bank, group storage and position
-- to your group's dashboard (the "GIM 2.0" web app).
--
-- What it does NOT do: it never reads or sends anything about other players, and it never sends actions
-- back into the game. It only reads. Data goes only to the address in plugin.json "urls".
--
-- How it works (one idea per section below):
--   1. Settings   - read the personal token from config.lua
--   2. Reading    - skills, inventories, position (API names taken from working plugins + the public docs)
--   3. Changes    - work out what moved in/out of the bank and group storage
--   4. Sending    - one JSON POST, retried until the server confirms (nothing is lost on a failed request)
--   5. Scheduling - events mark data "dirty"; a slow tick sends it, a heartbeat keeps the dashboard live

local json = require("json")

-- ── 1. Settings ───────────────────────────────────────────────────────────────
-- NB: `config` is the game API's own global (config.Obj ...), so our settings use another name.
local okSettings, settings = pcall(require, "config")
if not okSettings or type(settings) ~= "table" or type(settings.token) ~= "string" or not settings.token:find("^gimp_") then
    log("[GIM] config.lua missing or invalid - copy config.example.lua to config.lua and paste your token. Plugin idle.")
    return
end

if not Plugin.HasPermission(PluginPermissions.httpAccess) then
    log("[GIM] httpAccess permission not granted - the plugin cannot send data. Plugin idle.")
    return
end

local PAYLOAD_VERSION  = 1
local HEARTBEAT_TICKS  = 50   -- ServerLogic fires about every 0.6 s, so about 30 s
local SETTLE_TICKS     = 3    -- wait this long after an inventory event so one bank action = one message
local MIN_GAP_TICKS    = 5    -- never send more often than this (the server allows 60 per minute)
local MAX_BANK_ITEMS   = 6000 -- the server's limit; larger banks are cut rather than rejected

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

-- Where the character stands: world coordinates x/y plus the plane (floor) as z.
local function readPosition()
    local okE, entity = pcall(Player.GetEntity)
    if not okE or entity == nil then return nil end
    local okG, grid = pcall(function() return entity.coordGrid end)
    if not okG or grid == nil then return nil end
    local ok, pos = pcall(function()
        return {
            x = grid.mapSquareX * 64 + grid.localX,
            y = grid.mapSquareZ * 64 + grid.localZ,
            z = grid.level,
        }
    end)
    return ok and pos or nil
end

local function characterName()
    local okE, entity = pcall(Player.GetEntity)
    if not okE or entity == nil then return nil end
    local okN, name = pcall(function() return entity.displayName end)
    if okN and type(name) == "string" and name ~= "" then return name end
    return nil
end

-- ── 3. Changes in the bank and group storage ──────────────────────────────────
-- The dashboard ledger records deposits/withdrawals. For each store we remember the totals the server has
-- ALREADY ACCEPTED ("held"); a change is only counted as delivered once a send succeeds, so a failed
-- request simply tries again with nothing lost.
local STORES = {
    { key = "bank",  field = "bank", window = id.Interface.BANK,                    inv = id.Inv.BANK,                          held = nil },
    { key = "group", field = nil,    window = id.Interface.GROUP_IRONMAN_STORAGE,   inv = id.Inv.GROUP_IRONMAN_STORAGE_CLAN_TEMP, held = nil },
}

local function totals(list)
    local t = {}
    for _, it in ipairs(list) do t[it.id] = it end
    return t
end

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

-- ── 4. Sending ────────────────────────────────────────────────────────────────
local inFlight, stopped = false, false
local lastSendTick = -MIN_GAP_TICKS
local ticks = 0
local dirty = { skills = true, items = true }
local settle = 0

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
            -- Delivered: the server now holds these totals, so they become the new baseline.
            for store, now in pairs(seen) do store.held = now end
            if sentSkills then dirty.skills = false end
            dirty.items = false
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

    request:Post(body, done, done)
end

-- ── 5. Scheduling ─────────────────────────────────────────────────────────────
local function markItemsDirty() dirty.items = true; settle = 0 end

Event.SkillTransmit.Subscribe("gim_skill", function() dirty.skills = true end)
Event.InventoryUpdated.Subscribe("gim_inv_updated", markItemsDirty)
Event.InventoryAdded.Subscribe("gim_inv_added", markItemsDirty)
Event.InventoryRemoved.Subscribe("gim_inv_removed", markItemsDirty)

-- A new login (or world hop) means the old baselines may be stale: forget them so the first bank view
-- after logging in is treated as a fresh baseline and not as thousands of deposits.
Event.GameStateChanged.Subscribe("gim_state", function(event)
    if event.newState ~= GameState.GAME then
        for _, store in ipairs(STORES) do store.held = nil end
        dirty.skills, dirty.items = true, true
    end
end)

Event.ServerLogic.Subscribe("gim_tick", function()
    ticks = ticks + 1
    if dirty.items then settle = settle + 1 end
    local sinceLast = ticks - lastSendTick
    local itemsReady = dirty.items and settle >= SETTLE_TICKS
    if (itemsReady and sinceLast >= MIN_GAP_TICKS) or sinceLast >= HEARTBEAT_TICKS then
        send()
    end
end)

log("[GIM] GIM Companion started. Sending to " .. tostring(Plugin.urls.gim) .. " - your own character only.")
