declare module 'fengari' {
  interface LuaState {
    readonly __luaState?: unique symbol;
  }

  interface Fengari {
    lua: {
      readonly LUA_OK: number;
      lua_gettop(L: LuaState): number;
      lua_tojsstring(L: LuaState, index: number): string | null;
      lua_pushstring(L: LuaState, value: Uint8Array): void;
      lua_pushinteger(L: LuaState, value: number): void;
      lua_pushboolean(L: LuaState, value: boolean): void;
      lua_pushjsfunction(L: LuaState, fn: (L: LuaState) => number): void;
      lua_setglobal(L: LuaState, name: Uint8Array): void;
      lua_pcall(L: LuaState, nargs: number, nresults: number, errfunc: number): number;
      lua_settop(L: LuaState, index: number): void;
    };
    lauxlib: {
      luaL_newstate(): LuaState;
      luaL_loadstring(L: LuaState, source: Uint8Array): number;
    };
    lualib: {
      luaL_openlibs(L: LuaState): void;
    };
    to_luastring(value: string): Uint8Array;
  }

  const fengari: Fengari;
  export default fengari;
}
