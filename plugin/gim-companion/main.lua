-- GIM Companion — sends YOUR OWN character's skills, backpack, bank and position to your group's
-- dashboard (the "GIM 2.0" web app). It never sends anything about other players and never sends
-- actions back into the game.
--
-- STATUS: first draft written from the public API docs, NOT yet run in the game. Everything that the
-- documentation does not spell out is wrapped in pcall and reported with log() so the first test in the
-- beta client tells us exactly what to fix. Search for "TODO(beta)" for those spots.

local json = require("json")

-- NB: `config` is the game API's global (config.Inv, config.Obj...), so our own settings use another name.
local okSettings, settings = pcall(require, "config")
if not okSettings or type(settings) ~= "table" or type(settings.token) ~= "string" or not settings.token:find("^gimp_") then
    log("[GIM] config.lua missing or invalid — copy config.example.lua to config.lua and paste your token. Plugin idle.")
    return
end

if not Plugin.HasPermission(PluginPermissions.httpAccess) then
    log("[GIM] httpAccess permission not granted — the plugin cannot send data. Plugin idle.")
    return
end

local PAYLOAD_VERSION     = 1
local TICKS_PER_CHECK     = 50      -- ServerLogic fires about every 0.6 s, so ~30 s
local dirty               = { skills = true, inventory = true }
local ticks               = 0
local inFlight            = false
local bankCounts          = nil     -- last known bank contents (id -> count), used to detect deposits/withdrawals
local pendingChanges      = {}      -- storage_changes waiting to be sent

-- ── Skills ────────────────────────────────────────────────────────────────────
-- Server skill name -> possible SkillType member names. The docs say SkillType runs ATTACK(0)..NECROMANCY(28)
-- but do not list the member names, so a few spellings are tried. Missing ones are logged once.
local SKILL_NAMES = {
    Attack        = { "ATTACK" },        Defence       = { "DEFENCE" },       Strength      = { "STRENGTH" },
    Constitution  = { "CONSTITUTION", "HITPOINTS" },                            Ranged        = { "RANGED" },
    Prayer        = { "PRAYER" },        Magic         = { "MAGIC" },         Cooking       = { "COOKING" },
    Woodcutting   = { "WOODCUTTING" },   Fletching     = { "FLETCHING" },     Fishing       = { "FISHING" },
    Firemaking    = { "FIREMAKING" },    Crafting      = { "CRAFTING" },      Smithing      = { "SMITHING" },
    Mining        = { "MINING" },        Herblore      = { "HERBLORE" },      Agility       = { "AGILITY" },
    Thieving      = { "THIEVING" },      Slayer        = { "SLAYER" },        Farming       = { "FARMING" },
    Runecrafting  = { "RUNECRAFTING", "RUNECRAFT" },                            Hunter        = { "HUNTER" },
    Construction  = { "CONSTRUCTION" },  Summoning     = { "SUMMONING" },     Dungeoneering = { "DUNGEONEERING" },
    Divination    = { "DIVINATION" },    Invention     = { "INVENTION" },     Archaeology   = { "ARCHAEOLOGY" },
    Necromancy    = { "NECROMANCY" },
}
local skillTypes, warnedSkills = {}, {}
for name, candidates in pairs(SKILL_NAMES) do
    for _, c in ipairs(candidates) do
        local okT, member = pcall(function() return SkillType[c] end)
        if okT and member ~= nil then skillTypes[name] = member; break end
    end
    if skillTypes[name] == nil then log("[GIM] TODO(beta): no SkillType member found for", name, "— tried", table.concat(candidates, ", ")) end
end

local function readSkills()
    local out, any = {}, false
    for name, st in pairs(skillTypes) do
        local okX, xp = pcall(Player.GetXPUncapped, st)
        local okL, level = pcall(Player.GetLevelUncapped, st)
        if okX and okL and xp and level then
            out[name] = { xp = math.floor(xp), level = math.floor(level) }
            any = true
        elseif not warnedSkills[name] then
            warnedSkills[name] = true
            log("[GIM] TODO(beta): could not read", name, "-", tostring(xp), tostring(level))
        end
    end
    return any and out or nil
end

-- ── Inventories ───────────────────────────────────────────────────────────────
-- Returns a list of { id, name, count, value } merged per item id, or nil if the inventory isn't available
-- (e.g. the bank while its interface is closed — the docs say inventories can disappear).
local function readInv(invType)
    if invType == nil then return nil end
    local okFind, inv = pcall(Inventory.Find, invType)
    if not okFind or inv == nil or not inv.isValid then return nil end
    local okSlots, slots = pcall(inv.GetSlots, inv)
    if not okSlots or slots == nil then return nil end

    local byId, order = {}, {}
    for _, slot in pairs(slots) do
        local obj = slot.obj
        if obj ~= nil and slot.count ~= nil and slot.count > 0 then
            local entry = byId[obj.id]
            if entry == nil then
                entry = { id = obj.id, name = obj.name, count = 0, value = obj.cost }
                byId[obj.id] = entry
                order[#order + 1] = entry
            end
            entry.count = entry.count + slot.count
        end
    end
    return order
end

-- InvType names are only partly documented (BANK is, via config.Inv["BANK"]). Equipment and group storage
-- names are not, so we probe candidates once and log which exist.
local function probeInvType(label, candidates)
    for _, name in ipairs(candidates) do
        local okC, t = pcall(function() return config.Inv[name] end)
        if okC and t ~= nil then
            log("[GIM] found InvType for", label, "=", name)
            return t
        end
    end
    log("[GIM] TODO(beta):", label, "InvType not found — tried", table.concat(candidates, ", "))
    return nil
end

local INV_BACKPACK  = probeInvType("backpack",  { "INV" })
local INV_BANK      = probeInvType("bank",      { "BANK" })
local INV_EQUIPMENT = probeInvType("equipment", { "WORN", "WORN_ITEMS", "EQUIPMENT" })
-- TODO(beta): group ironman storage — name unknown. Once found, treat it like the bank below with store = "group".

-- ── Position ──────────────────────────────────────────────────────────────────
local function readPosition()
    local okE, entity = pcall(Player.GetEntity)
    if not okE or entity == nil or not entity.isValid then return nil end
    local cg = entity.coordGrid
    -- TODO(beta): CoordGrid fields are undocumented on the pages I read; try the likely ones.
    local x, y, z
    pcall(function() x, y, z = cg.x, cg.y, cg.z end)
    if x == nil then pcall(function() x, y, z = cg.x, cg.level or 0, cg.z end) end
    if x == nil then return nil end
    return { x = math.floor(x), y = math.floor(y or 0), z = math.floor(z or 0) }
end

-- ── Deposits / withdrawals (own bank) ─────────────────────────────────────────
local function diffBank(items)
    local counts = {}
    for _, it in ipairs(items) do counts[it.id] = it end
    if bankCounts ~= nil then
        for id, it in pairs(counts) do
            local before = bankCounts[id] and bankCounts[id].count or 0
            if it.count ~= before then
                pendingChanges[#pendingChanges + 1] = { store = "bank", id = id, name = it.name, delta = it.count - before, value = it.value }
            end
        end
        for id, old in pairs(bankCounts) do
            if counts[id] == nil then
                pendingChanges[#pendingChanges + 1] = { store = "bank", id = id, name = old.name, delta = -old.count, value = old.value }
            end
        end
    end
    bankCounts = counts
end

-- ── Sending ───────────────────────────────────────────────────────────────────
local function onResponse(request)
    inFlight = false
    if request.successful and request.responseCode == 200 then
        return
    end
    log("[GIM] send failed — HTTP", tostring(request.responseCode), request.data or request.errorInfo or "")
    -- Changes are re-queued by the next snapshot only if they were not delivered.
end

local function sendSnapshot()
    if inFlight then return end
    local payload = { v = PAYLOAD_VERSION }

    if dirty.skills then payload.skills = readSkills() end
    local backpack = readInv(INV_BACKPACK)
    if backpack then payload.inventory = backpack end
    local equipment = readInv(INV_EQUIPMENT)
    if equipment then payload.equipment = equipment end
    local bank = readInv(INV_BANK)
    if bank then payload.bank = bank; diffBank(bank) end
    local pos = readPosition()
    if pos then payload.position = pos end
    if #pendingChanges > 0 then payload.storage_changes = pendingChanges end

    local okEnc, body = pcall(json.encode, payload)
    if not okEnc then log("[GIM] could not encode payload:", tostring(body)); return end

    local request = HTTPRequest.new(Plugin.urls.gim, "/api/plugin/ingest")
    request:AddHeader("Authorization", "Bearer " .. settings.token)
    request:AddHeader("Content-Type", "application/json")
    inFlight = true
    pendingChanges = {}   -- optimistic; a failed send loses at most one batch of ledger lines
    dirty.skills, dirty.inventory = false, false
    request:Post(body, onResponse)
end

-- ── Wiring ────────────────────────────────────────────────────────────────────
Event.SkillTransmit.Subscribe("gim_skill", function() dirty.skills = true end)
Event.InventoryUpdated.Subscribe("gim_inv", function() dirty.inventory = true end)

Event.ServerLogic.Subscribe("gim_tick", function()
    ticks = ticks + 1
    if ticks % TICKS_PER_CHECK ~= 0 then return end
    if not Player.IsAvailable() then return end   -- not logged in to a world yet
    sendSnapshot()
end)

log("[GIM] GIM Companion started. Sending to", Plugin.urls.gim, "about every 30 seconds.")
