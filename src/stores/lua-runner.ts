import fengari from 'fengari';
import type { CommandResult } from './mini-redis.js';

const { lua, lauxlib, lualib, to_luastring: luastring } = fengari;

type LuaState = Parameters<typeof lua.lua_gettop>[0];
type Call = (name: string, args: readonly string[]) => CommandResult;

// Runs Redis-style Lua with fengari, a Lua 5.3 VM written in JavaScript. redis.call goes to
// the store's commands, so the script text is the same one Upstash runs.
export function createLuaRunner() {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  let current: Call | null = null;

  lua.lua_pushjsfunction(state, (L: LuaState) => {
    const count = lua.lua_gettop(L);
    const name = lua.lua_tojsstring(L, 1) ?? '';
    const args: string[] = [];
    for (let index = 2; index <= count; index += 1) args.push(lua.lua_tojsstring(L, index) ?? '');
    if (!current) throw new Error('lua called redis without a store');
    pushResult(L, current(name, args));
    return 1;
  });
  lua.lua_setglobal(state, luastring('__planny_call'));

  return {
    run(source: string, keys: readonly string[], argv: readonly string[], call: Call): string {
      current = call;
      try {
        const script = `redis = { call = __planny_call }\nKEYS = ${luaTable(keys)}\nARGV = ${luaTable(argv)}\n${source}`;
        if (lauxlib.luaL_loadstring(state, luastring(script)) !== lua.LUA_OK) {
          throw new Error(`lua compile failed: ${lua.lua_tojsstring(state, -1) ?? ''}`);
        }
        if (lua.lua_pcall(state, 0, 1, 0) !== lua.LUA_OK) {
          throw new Error(`lua run failed: ${lua.lua_tojsstring(state, -1) ?? ''}`);
        }
        const result = lua.lua_tojsstring(state, -1);
        if (result === null) throw new Error('lua script returned nothing');
        return result;
      } finally {
        current = null;
        lua.lua_settop(state, 0);
      }
    },
  };
}

function pushResult(L: LuaState, value: CommandResult): void {
  if (value === null) lua.lua_pushboolean(L, false);
  else if (typeof value === 'number') lua.lua_pushinteger(L, value);
  else lua.lua_pushstring(L, luastring(typeof value === 'string' ? value : JSON.stringify(value)));
}

function luaTable(values: readonly string[]): string {
  return `{${values.map(luaString).join(',')}}`;
}

function luaString(value: string): string {
  let out = '"';
  for (const byte of Buffer.from(value, 'utf8')) {
    const plain = (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
      || byte === 32 || byte === 45 || byte === 46 || byte === 58 || byte === 95;
    out += plain ? String.fromCharCode(byte) : `\\${String(byte).padStart(3, '0')}`;
  }
  return `${out}"`;
}
