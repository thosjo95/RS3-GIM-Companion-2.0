-- A fake RuneScape plugin API, just enough to run plugin/gim-companion/main.lua outside the game.
-- Member names deliberately follow the "uncertain" spellings (HITPOINTS, RUNECRAFT) to exercise the fallbacks.
package.path = PLUGIN_DIR .. "/?.lua;" .. package.path   -- PLUGIN_DIR is injected by the harness
package.preload["config"] = function() return { token = TOKEN } end   -- TOKEN is injected by the harness

function log(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end
  print(table.concat(t, " "))
end

PluginPermissions = { httpAccess = 1 }
Plugin = { urls = { gim = "http://localhost:0" }, HasPermission = function() return true end }

local names = { "ATTACK","DEFENCE","STRENGTH","HITPOINTS","RANGED","PRAYER","MAGIC","COOKING","WOODCUTTING","FLETCHING","FISHING",
  "FIREMAKING","CRAFTING","SMITHING","MINING","HERBLORE","AGILITY","THIEVING","SLAYER","FARMING","RUNECRAFT","HUNTER",
  "CONSTRUCTION","SUMMONING","DUNGEONEERING","DIVINATION","INVENTION","ARCHAEOLOGY","NECROMANCY" }
SkillType = {}
for i, n in ipairs(names) do SkillType[n] = i - 1 end

Player = {
  IsAvailable      = function() return true end,
  GetXPUncapped    = function(st) return 1000 * (st + 1) end,
  GetLevelUncapped = function(st) return 10 + st end,
  GetEntity        = function() return { isValid = true, coordGrid = { x = 3200, y = 3201, z = 0 } } end,
}

-- bank content is controlled from JS between ticks
BANK_STATE = { { id = 4151, name = "Abyssal whip", cost = 120000, count = 1 }, { id = 995, name = "Coins", cost = 1, count = 5000 } }
local function makeInv(list)
  return { isValid = true, GetSlots = function(self)
    local slots = {}
    for i, it in ipairs(list) do slots[i] = { obj = { id = it.id, name = it.name, cost = it.cost }, count = it.count } end
    return slots
  end }
end
config = { Inv = { INV = "INV", BANK = "BANK" } }
Inventory = { Find = function(t)
  if t == "INV" then
    return makeInv({ { id = 995, name = "Coins", cost = 1, count = 100 }, { id = 995, name = "Coins", cost = 1, count = 50 },   -- same item twice: must merge
                     { id = 385, name = "Shark", cost = 800, count = 1 }, { id = 385, name = "Shark", cost = 800, count = 1 } })
  end
  if t == "BANK" then return BANK_OPEN and makeInv(BANK_STATE) or nil end
  return nil
end }

Event = setmetatable({}, { __index = function(t, k)
  local e = { subs = {} }
  e.Subscribe = function(name, fn) e.subs[name] = fn end
  rawset(t, k, e); return e
end })

HTTPRequest = { new = function(base, path)
  local r = { base = base, path = path, headers = {} }
  function r:AddHeader(k, v) self.headers[k] = v end
  function r:Post(body, cb)
    CAPTURE(self.path, self.headers["Authorization"], self.headers["Content-Type"], body)
    cb({ successful = true, responseCode = 200 })
  end
  return r
end }

function TICK(n) for _ = 1, n do for _, fn in pairs(Event.ServerLogic.subs) do fn() end end end
