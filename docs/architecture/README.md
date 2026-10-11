<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Architecture

GenieTerm is an Electron application with a React 19, Jotai, and Tailwind v4 frontend and a Go backend. A workspace contains tabs; each tab has a tiling layout of blocks. Terminal blocks own a terminal view and refer to a backend controller. A controller's lifetime is independent of whether its React view is mounted.

## Processes

| Process              | Responsibility                                                                                        | Entry points                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Electron main        | App lifecycle, windows, native menus, preload IPC, updates, and launching `wavesrv`                   | `emain/emain.ts`, `emain/emain-wavesrv.ts`                                      |
| Application renderer | One renderer per window by default; renders the workspace and a cache of tab panes                    | `frontend/wave.ts`, `frontend/app/app.tsx`, `frontend/app/tab/tabpanestack.tsx` |
| `wavesrv`            | Local object and file storage, configuration, connection and controller management, RPC routing, HTTP | `cmd/server/main-server.go`                                                     |
| `genie` / `wsh`      | CLI and remote helper; `connserver` exposes remote RPC services and routes traffic                    | `cmd/wsh/main-wsh.go`, `cmd/wsh/cmd/wshcmd-connserver.go`                       |
| Remote job manager   | A separate helper process per durable job; owns the shell PTY and buffers output across disconnects   | `cmd/wsh/cmd/wshcmd-jobmanager.go`, `pkg/jobmanager/`                           |

Embedded browser webviews may use additional renderer processes. The legacy per-tab application renderer mode is described in [Performance](performance.md).

## Communication

Renderer-to-main operations use Electron IPC through `emain/preload.ts` and `emain/emain-ipc.ts`; the frontend contract is `ElectronApi` in `frontend/types/custom.d.ts`.

Both Electron main and the application renderer connect to `wavesrv` using `wshrpc` over the local `/ws` WebSocket endpoint. The server also accepts helper RPC connections through a Unix domain socket, `wave.sock`. SSH connections forward a remote domain socket to the server; WSL bridges its helper router over standard input/output. See [Connections](connections.md).

RPC addresses routes, not physical transports. `pkg/wshutil/wshrouter.go` defines routes such as `wavesrv`, `electron`, `conn:<name>`, `tab:<id>`, `feblock:<id>`, and `job:<id>`. The shared renderer has its own `fe:<windowId>:<random>` identity plus independently registered tab routes. Command contracts live in `pkg/wshrpc/wshrpctypes.go` and related type files; implementations live in `pkg/wshrpc/wshserver/` and `pkg/wshrpc/wshremote/`. `task generate` regenerates clients in `pkg/wshrpc/wshclient/` and `frontend/app/store/wshclientapi.ts`.

WPS (`pkg/wps/`) carries scoped pub/sub events through the RPC system. Examples include `waveobj:update`, `connchange`, `controllerstatus`, `blockfile`, and `config`. `frontend/app/store/wps.ts` manages frontend subscriptions; `frontend/app/store/wos.ts` maintains reactive object state.

HTTP has a separate local listener in `pkg/web/web.go`:

| Endpoint                  | Use                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `/wave/file`              | Read a filestore file by `zoneid`, `name`, and optional byte `offset`, including terminal history |
| `/wave/stream-file`       | Stream connection-aware files, including HTTP byte ranges                                         |
| `/wave/stream-local-file` | Serve local filesystem content                                                                    |
| `/wave/service`           | Invoke the service layer in `pkg/service/`                                                        |

## Storage and naming

`pkg/wstore/` stores objects in `<data dir>/db/waveterm.db`: clients, windows, workspaces, tabs, layouts, blocks, and jobs. Object definitions live in `pkg/waveobj/`. References use an object type and ID, such as `block:<id>`.

`pkg/filestore/` stores named files in zones in `<data dir>/db/filestore.db`. Terminal output uses the `term` file; terminal snapshots use `cache:term:full`. Blocks and durable jobs have their own zones. SQLite migrations live in `db/migrations-wstore/` and `db/migrations-filestore/`.

Configuration is JSON under the config directory, normally `~/.config/genieterm`; see [Configuration](config.md). `emain/emain-platform.ts` resolves config and data paths, including environment overrides and the older combined-home layout. `genie version --json` reports the running app's resolved paths.

GenieTerm is a soft fork of Wave Terminal. Internal `Wave*`, `wshrpc`, `WAVETERM_*`, and compatibility `.waveterm` names are deliberate: changing them indiscriminately breaks saved data, shell environments, or remote protocols. New remote installs use `~/.genieterm/bin/genie`, with legacy helper paths recognized during connection setup. The helper carries a protocol stamp: `genie version --protocol` prints `genie v<version>+p<N>`, where `N` comes from `wavebase.HelperProtocol` in `pkg/wavebase/wavebase.go`. A running job manager keeps its existing executable after a helper update, so protocol changes must account for older managers.

## Directory map

| Path                                                          | Contents                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `emain/`                                                      | Electron main, preload, updater, and transfer queue              |
| `frontend/app/`                                               | Blocks, tabs, workspace UI, stores, modals, and views            |
| `frontend/app/view/term/`                                     | xterm.js integration, command blocks, completion, and Command AI |
| `frontend/app/view/host/`                                     | Host overview, processes, and ports UI                           |
| `frontend/app/view/preview/`, `frontend/app/view/codeeditor/` | File browsing, previews, and editor components                   |
| `frontend/layout/`                                            | Tiling tree, layout model, rendering, and tests                  |
| `frontend/preview/`                                           | Standalone preview environment for UI development and QA         |
| `cmd/`                                                        | Server, CLI/helper, and Go/TypeScript/schema generators          |
| `pkg/`                                                        | Go services, controllers, transports, storage, and utilities     |
| `db/`, `schema/`                                              | Database migrations and generated config schemas                 |
| `scripts/`, `tests/`                                          | Build/release checks, benchmarks, and integration tests          |
| `build/`, `assets/`, `public/`                                | Packaging resources and static assets                            |

## Where to start reading

- Startup and transport wiring: `emain/emain.ts`, `cmd/server/main-server.go`, `frontend/wave.ts`.
- SSH, helper installation, and health: [Connections](connections.md).
- Object ownership, controllers, tiling, and focus: [Blocks and layout](blocks-and-layout.md).
- Settings and adding a config key: [Configuration](config.md).
- Shell markers and semantic command history: [Shell integration](shell-integration.md).
- Renderer caching and durable output invariants: [Performance](performance.md).
- Engines, privacy and the risk classifier behind Command AI: [Command AI](command-ai.md).
- Welcome, Quick Start and one-time tips: [Onboarding](onboarding.md).
