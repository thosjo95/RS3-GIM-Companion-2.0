-- A fake RuneScape plugin API, just enough to run plugin/gim-companion/main.lua outside the game.
-- The names mirror the REAL API as used by working plugins (id.Inv.*, id.Interface.*, SkillType.HITPOINTS,
-- coordGrid.mapSquareX ...). Anything the real game does differently will only show in the beta client.
package.path = PLUGIN_DIR .. "/?.lua;" .. package.path   -- PLUGIN_DIR is injected by the harness
package.preload["config"] = function() return { token = TOKEN } end   -- TOKEN is injected by the harness

function log(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end
  print(table.concat(t, " "))
end

PluginPermissions = { httpAccess = 1 }
Plugin = { urls = { gim = "http://localhost:0" }, HasPermission = function() return true end }
GameState = { GAME = 3, LOBBY = 2 }

local names = { "ATTACK","DEFENCE","STRENGTH","HITPOINTS","RANGED","PRAYER","MAGIC","COOKING","WOODCUTTING","FLETCHING","FISHING",
  "FIREMAKING","CRAFTING","SMITHING","MINING","HERBLORE","AGILITY","THIEVING","SLAYER","FARMING","RUNECRAFTING","HUNTER",
  "CONSTRUCTION","SUMMONING","DUNGEONEERING","DIVINATION","INVENTION","ARCHAEOLOGY","NECROMANCY" }
SkillType = {}
for i, n in ipairs(names) do SkillType[n] = i - 1 end

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
}
config = { Obj = { FromID = function(i) return DEFS[i] end } }

id = {
  Inv = { INV = 93, WORN = 94, BANK = 95, GROUP_IRONMAN_STORAGE_CLAN_TEMP = 96 },
  Interface = { BANK = 762, GROUP_IRONMAN_STORAGE = 1500 },
}

-- Controlled from JS between ticks
BANK_OPEN, GROUP_OPEN = false, false
BANK_STATE  = { { id = 4151, count = 1 }, { id = 995, count = 5000 } }
GROUP_STATE = { { id = 560, count = 100 } }

local function makeInv(list)
  return { isValid = true, GetSlots = function(self)
    local slots = {}
    for i, it in ipairs(list) do slots[i] = { obj = { id = it.id }, count = it.count } end
    return slots
  end }
end

Inventory = { Find = function(t)
  if t == id.Inv.INV then
    return makeInv({ { id = 995, count = 100 }, { id = 995, count = 50 },   -- same item twice: must merge
                     { id = 385, count = 1 }, { id = 385, count = 1 } })
  end
  if t == id.Inv.WORN then return makeInv({ { id = 4151, count = 1 } }) end
  if t == id.Inv.BANK then return BANK_OPEN and makeInv(BANK_STATE) or nil end
  if t == id.Inv.GROUP_IRONMAN_STORAGE_CLAN_TEMP then return GROUP_OPEN and makeInv(GROUP_STATE) or nil end
  return nil
end }

ui = { Interfaces = { GetInterface = function(self, which)
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
  function r:Post(body, onOk, onFail)
    CAPTURE(self.path, self.headers["Authorization"], self.headers["Content-Type"], body)
    self.responseCode = HTTP_STATUS
    self.successful = HTTP_STATUS == 200
    ;(self.successful and onOk or onFail)(self)
  end
  return r
end }

function TICK(n) for _ = 1, n do for _, fn in pairs(Event.ServerLogic.subs) do fn() end end end
function FIRE(eventName, payload) for _, fn in pairs(Event[eventName].subs) do fn(payload) end end
