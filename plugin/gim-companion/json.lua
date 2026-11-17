-- Minimal JSON encoder. The RuneScape API documents no JSON library, so we write our own.
-- Handles nil/boolean/number/string/table (arrays and objects). Output is deterministic enough for the server.
local json = {}

local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function encodeString(s)
    return '"' .. s:gsub('[%c"\\]', function(c)
        return escapes[c] or string.format('\\u%04x', c:byte())
    end) .. '"'
end

local function isArray(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n == #t
end

function json.encode(v)
    local t = type(v)
    if v == nil then return 'null' end
    if t == 'boolean' then return tostring(v) end
    if t == 'number' then
        if v ~= v or v == math.huge or v == -math.huge then return 'null' end
        if math.type(v) == 'integer' then return string.format('%d', v) end
        return string.format('%.14g', v)
    end
    if t == 'string' then return encodeString(v) end
    if t == 'table' then
        local parts = {}
        if isArray(v) then
            for i = 1, #v do parts[i] = json.encode(v[i]) end
            return '[' .. table.concat(parts, ',') .. ']'
        end
        for k, val in pairs(v) do parts[#parts + 1] = encodeString(tostring(k)) .. ':' .. json.encode(val) end
        return '{' .. table.concat(parts, ',') .. '}'
    end
    error('cannot encode value of type ' .. t)
end

return json
