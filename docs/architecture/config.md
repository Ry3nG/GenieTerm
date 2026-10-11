<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Configuration

`pkg/wconfig/settingsconfig.go` defines `SettingsType`, `ConnKeywords`, and `FullConfigType`. Embedded defaults live in `pkg/wconfig/defaultconfig/`; user configuration lives under the resolved config directory.

`emain/emain-platform.ts` selects that directory. It first checks the combined home at `WAVETERM_HOME` (or `~/.genieterm` when unset). If that directory contains `wave.lock`, its `config` subdirectory takes precedence. Otherwise it uses `WAVETERM_CONFIG_HOME`, then `XDG_CONFIG_HOME/genieterm`, then `~/.config/genieterm`. Development uses the `genieterm-dev` name. Electron passes the resolved directory to `wavesrv`; backend callers use `wavebase.GetWaveConfigDir()`.

## Files and resolution

`settings.json` contains global settings. `connections.json` maps connection names to `ConnKeywords`, including SSH options, helper settings, and supported terminal overrides. Other config parts include themes, backgrounds, presets, widgets, bookmarks, and MIME types. `ReadFullConfig()` loads embedded defaults and user files into `FullConfigType`, including any reported config errors.

The loader supports `<part>.json` and `<part>/*.json`. Within each source, it merges directory entries in descending filename order, then the top-level file. User values are merged over embedded defaults. Config files are JSON; the reader reports syntax errors rather than accepting JSON comments.

For a setting that supports overrides, `getOverrideConfigAtom(blockId, key)` in `frontend/app/store/global.ts` returns the first non-null value from:

1. Block metadata.
2. The block's connection entry.
3. Global settings, already merged with defaults.

This is an accessor's behavior, not an automatic cascade for every consumer. Global-only readers use `getSettingsKeyAtom()` or `useSettingsKeyAtom()`. Backend consumers must implement any applicable override resolution; reading `wconfig.GetWatcher().GetFullConfig().Settings` alone reads only global settings.

## From disk to UI

`pkg/wconfig/filewatcher.go` uses fsnotify to watch the config directory and existing config subdirectories. A relevant change reloads the full configuration and publishes the WPS `config` event with `WatcherUpdate.fullconfig`.

`frontend/wave.ts` loads initial configuration through `GetFullConfigCommand`. The subscription in `frontend/app/store/global.ts` replaces `atoms.fullConfigAtom` on later events. Derived settings atoms then update subscribed components. A consumer may still need to restart a shell or recreate a resource for a particular setting to take effect.

Use hooks in components and `globalStore.get()` in model methods or event handlers. For example, a component can read `useAtomValue(getOverrideConfigAtom(blockId, "term:fontsize"))`; a global reader can use `useSettingsKeyAtom("web:defaulturl")`. The accessors and `globalStore` are exported from `@/app/store/global`; `useAtomValue` comes from `jotai`.

Writes go through `RpcApi.SetConfigCommand(TabRpcClient, { "web:defaulturl": url })`, which calls `SetBaseConfigValue()` and writes `settings.json`. It checks keys and value types against `SettingsType`; a null value removes the user override. `SetConnectionsConfigCommand` writes a host's entry in `connections.json`. `SetMetaCommand` writes block overrides to object storage instead of the config files.

## Adding a setting

1. Add the global field to `SettingsType` in `pkg/wconfig/settingsconfig.go`, with a lowercase colon-separated JSON key and an appropriate type. Use optional pointers where unset must differ from zero or false.
2. Add an embedded default in `pkg/wconfig/defaultconfig/settings.json` when needed. Provide a consumer fallback where the value can remain absent.
3. If connection overrides make sense, add the corresponding field to `ConnKeywords`. If block overrides make sense, add it to `MetaTSType` in `pkg/waveobj/wtypemeta.go`. Keep the key and value semantics consistent across these declarations.
4. Run `task generate`. It regenerates JSON schemas, TypeScript definitions in `frontend/types/gotypes.d.ts`, RPC clients, and metadata constants. Edit the Go source declarations, not generated files.
5. Use the accessor matching the intended scope, and check defaults, explicit false/zero values, connection and block overrides, reset behavior, and live reload. Schema completion in the config editor does not replace validation in the setting's consumer.

The project procedure is also recorded in `.kilocode/skills/add-config/SKILL.md`.
