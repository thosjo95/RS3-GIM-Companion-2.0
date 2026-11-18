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

-- ── Decoder ───────────────────────────────────────────────────────────────────
-- Only used for the small rules document the server sends (objects, arrays, strings, numbers, booleans).
-- Raises an error on anything malformed; callers wrap it in pcall.
local unescapes = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' }

local function skip(s, i) return s:find('[^ \t\r\n]', i) or #s + 1 end

local decodeValue

local function decodeString(s, i)
    local out, pos = {}, i + 1
    while true do
        local c = s:sub(pos, pos)
        if c == '' then error('unterminated string') end
        if c == '"' then return table.concat(out), pos + 1 end
        if c == '\\' then
            local n = s:sub(pos + 1, pos + 1)
            if n == 'u' then
                local code = tonumber(s:sub(pos + 2, pos + 5), 16)
                if not code then error('bad \\u escape') end
                out[#out + 1] = utf8.char(code)
                pos = pos + 6
            elseif unescapes[n] then
                out[#out + 1] = unescapes[n]
                pos = pos + 2
            else
                error('bad escape')
            end
        else
            out[#out + 1] = c
            pos = pos + 1
        end
    end
end

decodeValue = function(s, i)
    i = skip(s, i)
    local c = s:sub(i, i)
    if c == '{' then
        local obj = {}
        i = skip(s, i + 1)
        if s:sub(i, i) == '}' then return obj, i + 1 end
        while true do
            i = skip(s, i)
            if s:sub(i, i) ~= '"' then error('expected key') end
            local key; key, i = decodeString(s, i)
            i = skip(s, i)
            if s:sub(i, i) ~= ':' then error('expected :') end
            obj[key], i = decodeValue(s, i + 1)
            i = skip(s, i)
            local d = s:sub(i, i)
            if d == '}' then return obj, i + 1 end
            if d ~= ',' then error('expected , or }') end
            i = i + 1
        end
    elseif c == '[' then
        local arr = {}
        i = skip(s, i + 1)
        if s:sub(i, i) == ']' then return arr, i + 1 end
        while true do
            arr[#arr + 1], i = decodeValue(s, i)
            i = skip(s, i)
            local d = s:sub(i, i)
            if d == ']' then return arr, i + 1 end
            if d ~= ',' then error('expected , or ]') end
            i = i + 1
        end
    elseif c == '"' then
        return decodeString(s, i)
    elseif s:sub(i, i + 3) == 'true' then return true, i + 4
    elseif s:sub(i, i + 4) == 'false' then return false, i + 5
    elseif s:sub(i, i + 3) == 'null' then return nil, i + 4
    end
    local num = s:match('^-?%d+%.?%d*[eE]?[+-]?%d*', i)
    if not num or num == '' then error('unexpected character at ' .. i) end
    return tonumber(num), i + #num
end

function json.decode(s)
    local value, i = decodeValue(s, 1)
    if skip(s, i) <= #s then error('trailing characters') end
    return value
end

return json
