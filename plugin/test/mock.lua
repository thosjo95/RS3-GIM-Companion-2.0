-- A fake RuneScape plugin API, just enough to run plugin/gim-companion/main.lua outside the game.
-- The names mirror the REAL API as used by working plugins (id.Inv.*, id.Interface.*, SkillType.HITPOINTS,
-- coordGrid.mapSquareX ...). Anything the real game does differently will only show in the beta client.
package.path = PLUGIN_DIR .. "/?.lua;" .. package.path   -- PLUGIN_DIR is injected by the harness
package.preload["config"] = function() return { token = TOKEN } end   -- TOKEN is injected by the harness

function _unused_log(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end
  print(table.concat(t, " "))
end

PluginPermissions = { httpAccess = 1 }
Plugin = { urls = { gim = "http://localhost:0" }, HasPermission = function() return true end }
GameState = { GAME = 3, LOBBY = 2 }
CONFIG_BODY = "{}"   -- the harness sets this to the real server's /api/plugin/config response

local names = { "ATTACK","DEFENCE","STRENGTH","HITPOINTS","RANGED","PRAYER","MAGIC","COOKING","WOODCUTTING","FLETCHING","FISHING",
  "FIREMAKING","CRAFTING","SMITHING","MINING","HERBLORE","AGILITY","THIEVING","SLAYER","FARMING","RUNECRAFTING","HUNTER",
  "CONSTRUCTION","SUMMONING","DUNGEONEERING","DIVINATION","INVENTION","ARCHAEOLOGY","NECROMANCY" }
SkillType = {}
for i, n in ipairs(names) do SkillType[n] = i - 1 end

os = nil   -- the game's Lua has no os library; the plugin must not depend on it
CHARACTER = "LuaPlayer"   -- changed by the harness to test the wrong-character case
Player = {
  IsAvailable       = function() return true end,
  GetXPUncapped     = function(st) return 1000 * (st + 1) end,
  GetLevelGameplay  = function(st) return 10 + st end,
  GetEntity         = function() return { displayName = CHARACTER, coordGrid = { mapSquareX = 50, localX = 0, mapSquareZ = 50, localZ = 1, level = 0 } } end,
}

-- Item definitions (names/values come from config.Obj.FromID in the real game)
local DEFS = {
  [995]  = { name = "Coins",        cost = 1 },
  [385]  = { name = "Shark",        cost = 800 },
  [4151] = { name = "Abyssal whip", cost = 120000 },
  [560]  = { name = "Death rune",   cost = 200 },
  [11702] = { name = "Armadyl hilt", cost = 10 },   -- cheap, but named in a boss drop table (rare list)
}
config = { Obj = { FromID = function(i) return DEFS[i] end } }

id = {
  Inv = { INV = 93, WORN = 94, BANK = 95, GROUP_IRONMAN_STORAGE_CLAN_TEMP = 96 },
  Interface = { BANK = 762, GROUP_IRONMAN_STORAGE = 1500, STOCKMARKET = 1,  STOCKCOLLECT = 2, SHOP_MAIN = 3, TRADEMAIN = 4, TRADECONFIRM = 5 },
  Component = { TOPLEVEL_V2_TARGET_INFO__NAME = 9001, TOPLEVEL_V2_TARGET_INFO__ENTITY_HEALTH_LEFT = 9002, TOPLEVEL_V2__PLUGIN_BUILD_LAYER_TOP = 9100 },
  StyleSheet = { DEFAULT = 1, BUTTON_DEFAULT = 2 },
  Font = { MUSEO_SANS_15PT_REGULAR = 3 },
}

-- Quests (QUESTS is replaced by the harness to simulate progress)
QUESTS = {
  [0] = { name = "Cook's Assistant", hasStartedQuest = true,  hasFinishedQuest = true,  isMembers = false, questPoints = 1 },
  [1] = { name = "Demon Slayer",     hasStartedQuest = true,  hasFinishedQuest = false, isMembers = false, questPoints = 3 },
  [2] = { name = "Dragon Slayer",    hasStartedQuest = false, hasFinishedQuest = false, isMembers = true,  questPoints = 2, canStartQuest = true },
  [3] = { name = "Old Cooking Quest", hasStartedQuest = false, hasFinishedQuest = false, isMembers = false, questPoints = 0, deprecated = true },
}
-- Achievements / area tasks (ACHS is changed by the harness to simulate completing one). progress -2 = complete.
ACHS = {
  [10] = { name = "Varrock Set Tasks - Easy",  category = 4766, subCategory = 1, isMembers = false, runeScore = 1, progress = -2 },
  [11] = { name = "Varrock Set Tasks - Medium", category = 4766, subCategory = 2, isMembers = false, runeScore = 2, progress = 0 },
  [12] = { name = "Falador Set Tasks - Easy",  category = 4766, subCategory = 1, isMembers = false, runeScore = 1, progress = -2 },
}
-- Group Ironman journey: tier 0 done, tier 1 half done (one step still open)
ACHS[20] = { name = "Journey Tier 0",                  category = 5483, subCategory = -1,   isMembers = false, runeScore = 0, progress = -2 }
ACHS[21] = { name = "Journey Tier 1: Total level",     category = 5483, subCategory = 5485, isMembers = false, runeScore = 0, progress = 0,
              reward = "Ironman armour trim", tallyTarget = 1000, tallyProgress = 500, descriptions = { "Reach a total level of 1000" } }
ACHS[22] = { name = "Journey Tier 1: Restless ghost",  category = 5483, subCategory = 5485, isMembers = false, runeScore = 0, progress = -2 }
-- The game's kill tracker variables (VARS is changed by the harness)
id.VarPlayer = { BSLAY_BOSS_KILLS1 = 9001, BSLAY_MONSTER_KILLS1 = 9002, BSLAY_BOSS_KILLS2 = 9003 }
VARS = { [9001] = 19, [9002] = 250, [9003] = 0 }
var = { VarPlayer = { FromID = function(i) if VARS[i] == nil then return nil end return { value = VARS[i] } end } }
-- Boss records (the game's tracker): a struct with BSLAY_NAME and a link to an achievement whose progress counter is the kill count
BOSS_ACH = { BARROWS = { tallyProgress = 142, tallyTarget = 1 }, KBD = { tallyProgress = 3, tallyTarget = 1 } }
local function bossStruct(name, ach, req) return { params = { BSLAY_NAME = name, BSLAY_ACHIEVEMENT = ach, BSLAY_COMBAT_REQ = req, BSLAY_GROUP_BOSS = false },
    HasParam = function(self, prm) return self.params[prm.name] ~= nil end, GetParamValue = function(self, prm) return self.params[prm.name] end } end
config.Struct = { BSLAY_BARROWS = bossStruct("The Barrows Brothers", BOSS_ACH.BARROWS, 85), BSLAY_KBD = bossStruct("King Black Dragon", BOSS_ACH.KBD, 65), BSLAY_ARAXXI = bossStruct("Araxxi", { tallyProgress = 0, tallyTarget = 1 }, 90) }
config.Param = setmetatable({}, { __index = function(t, k) return { name = k } end })
config.Achievement = { FromID = function(i) return ACHS[i] end }
config.Quest = { FromID = function(i) return QUESTS[i] end }

-- Target overlay (controlled by the harness)
TARGET_NAME, TARGET_HP = "No Target", ""

-- Controlled from JS between ticks
BANK_OPEN, GROUP_OPEN = false, false
BANK_STATE  = { { id = 4151, count = 1 }, { id = 995, count = 5000 } }
GROUP_STATE = { { id = 560, count = 100 } }

INV_EXTRA = {}   -- items that "arrive" in the backpack (auto-loot)
local function makeInv(list)
  return { isValid = true, GetSlots = function(self)
    local slots = {}
    for i, it in ipairs(list) do slots[i] = { obj = { id = it.id }, count = it.count } end
    return slots
  end }
end

Inventory = { Find = function(t)
  if t == id.Inv.INV then
    local list = { { id = 995, count = 100 }, { id = 995, count = 50 },   -- same item twice: must merge
                   { id = 385, count = 1 }, { id = 385, count = 1 } }
    for _, it in ipairs(INV_EXTRA) do list[#list + 1] = it end
    return makeInv(list)
  end
  if t == id.Inv.WORN then return makeInv({ { id = 4151, count = 1 } }) end
  if t == id.Inv.BANK then return BANK_OPEN and makeInv(BANK_STATE) or nil end
  if t == id.Inv.GROUP_IRONMAN_STORAGE_CLAN_TEMP then return GROUP_OPEN and makeInv(GROUP_STATE) or nil end
  return nil
end }

-- a UI component that remembers what it was given (the link window is built from these)
UI_LOG = { created = {}, destroyed = 0 }
local function component(kind)
  local c = { kind = kind, children = {} }
  function c:SetSize() end function c:SetPos() end function c:SetHeaderLayout() end function c:AlignTo() end
  function c:Subscribe(hook, fn) self.pressed = fn end
  function c:Destroy() UI_LOG.destroyed = UI_LOG.destroyed + 1 end
  UI_LOG.created[#UI_LOG.created + 1] = c
  return c
end
-- a store like the game's PersistentDB (kept between logins)
STORE = {}
PersistentDB = {
  SetString = function(self, k, v) STORE[k] = v; return true end,
  GetString = function(self, k) return STORE[k] end,
  Delete = function(self, k) local had = STORE[k] ~= nil; STORE[k] = nil; return had end,
}
HTTP_RESPONSES = {}   -- path -> canned response body, set by the harness

ui = { GroupBox = { new = function() return component("group") end }, Text = { new = function() return component("text") end },
Button = { new = function() return component("button") end }, AlignMode = { CENTRE = 1 }, Hook = { ONBUTTONPRESSED = 1 },
Interfaces = { GetComponent = function(self, which)
  if which == id.Component.TOPLEVEL_V2__PLUGIN_BUILD_LAYER_TOP then return {} end
  if which == id.Component.TOPLEVEL_V2_TARGET_INFO__NAME then return { text = "<col=ffffff>" .. TARGET_NAME .. "</col>" } end
  if which == id.Component.TOPLEVEL_V2_TARGET_INFO__ENTITY_HEALTH_LEFT then return { text = TARGET_HP } end
  return nil
end,
GetInterface = function(self, which)
  if which == id.Interface.BANK and BANK_OPEN then return {} end
  if which == id.Interface.GROUP_IRONMAN_STORAGE and GROUP_OPEN then return {} end
  return nil
end } }

Event = setmetatable({}, { __index = function(t, k)
  local e = { subs = {} }
  e.Subscribe = function(name, fn) e.subs[name] = fn end
  rawset(t, k, e); return e
end })

HTTP_STATUS = 200   -- changed by the harness to test failures
HTTPRequest = { new = function(base, path)
  local r = { base = base, path = path, headers = {} }
  function r:AddHeader(k, v) self.headers[k] = v end
  function r:Get(onOk, onFail)
    CAPTURE_GET(self.path, self.headers["Authorization"])
    self.responseCode = 200; self.successful = true; self.data = CONFIG_BODY
    onOk(self)
  end
  function r:Post(body, onOk, onFail)
    CAPTURE(self.path, self.headers["Authorization"], self.headers["Content-Type"], body)
    self.responseCode = HTTP_STATUS
    self.successful = HTTP_STATUS == 200
    self.data = HTTP_RESPONSES[self.path]
    onOk(self)   -- completion callback (fires on success AND failure, like the real API)
  end
  return r
end }

function TICK(n) for _ = 1, n do for _, fn in pairs(Event.ServerLogic.subs) do fn() end end end
function FIRE(eventName, payload) for _, fn in pairs(Event[eventName].subs) do fn(payload) end end
