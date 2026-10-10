# GenieTerm - High Level Architecture Overview

## Project Description

GenieTerm is an open-source, local-first semantic terminal for people who live in SSH. It is a soft fork of Wave Terminal: an Electron app with a React frontend and a Go backend server (`wavesrv`). The product is three things together: command blocks over a single xterm.js runtime, durable local and remote sessions, and remote files in the same workspace. The only AI feature is natural language → a proposed command. Internal names (`Wave*`, `wshrpc`, `WAVETERM_*`, `.waveterm`) are kept on purpose.

See `docs/GENIETERM-ROADMAP.md` for product scope and `docs/leftovers.md` for what was removed from Wave.

## Top-Level Directory Structure

```
GenieTerm/
├── emain/              # Electron main process
├── frontend/           # React application (renderer process)
├── cmd/                # Go binaries (wavesrv, the genie/wsh CLI, code generators)
├── pkg/                # Go packages
├── db/                 # SQLite migrations (wstore, filestore)
├── schema/             # Generated JSON schemas for config files
├── docs/               # Product docs, release gates, release notes, performance notes
├── aiprompts/          # Inherited architecture notes for contributors and agents
├── scripts/            # Release gate, packaging verifiers, preview QA, perf benchmark
├── build/, assets/, public/  # Packaging resources and static assets
└── Taskfile.yml, package.json, electron-builder.config.cjs
```

## Architecture Components

### 1. Electron Main Process (`emain/`)

- `emain.ts` - entry point and app lifecycle (starts wavesrv, restores windows, updater)
- `emain-window.ts` - `WaveBrowserWindow`: tabs, tab switching, close confirmations
- `emain-tabview.ts` - `WaveTabView`: one WebContentsView (renderer) per tab, plus a pre-warmed spare
- `emain-wavesrv.ts` - launches and supervises the Go backend
- `emain-ipc.ts`, `preload.ts` - IPC between renderer and main
- `transfer/` - folder downloads (rsync/scp) and the persisted transfer queue
- `updater.ts`, `mac-update-installer.ts` - auto-update (the macOS installer swaps the app bundle and relaunches)

### 2. Frontend (`frontend/`)

```
frontend/
├── app/
│   ├── block/          # Block frame, header, connection button, block registry
│   ├── element/        # Reusable UI elements
│   ├── modals/         # Modals (command palette, connections, settings) - loaded on demand
│   ├── onboarding/     # First-run onboarding and feature tour
│   ├── store/          # Jotai state, RPC client, keybindings (keymodel.ts), global atoms
│   ├── tab/            # Tab bar
│   ├── view/
│   │   ├── term/          # Terminal: TermWrap (xterm.js), command blocks, completion, composer
│   │   ├── preview/       # Files: directory browser, previews, transfers
│   │   ├── codeeditor/    # Monaco editor (lazy)
│   │   ├── processviewer/ # Process viewer
│   │   ├── sysinfo/       # System info charts
│   │   ├── waveconfig/    # Config editor
│   │   ├── webview/       # Web view
│   │   └── vdom/          # VDom widget protocol view
│   └── workspace/      # Workspace layout, widget rail, git panel
├── layout/             # Tiling layout system
├── preview/            # Standalone preview server used by visual/interaction QA
├── types/              # TypeScript types (gotypes.d.ts is generated)
└── util/               # Utilities
```

Startup only loads what the first terminal needs; non-terminal views, modals and heavy libraries (Monaco, Mermaid, Shiki, Plot) are loaded with dynamic `import()` when first used. Keep it that way.

Technologies: Electron, React 19 + TypeScript, Jotai, xterm.js (WebGL renderer), Monaco, Tailwind CSS v4 (SCSS only in older components), electron-vite, Task.

### 3. Go Backend (`cmd/server/`, `pkg/`)

Key packages:

- `wshrpc/`, `wshutil/` - RPC types, server implementation, router
- `blockcontroller/` - shell controllers, PTY I/O (output is coalesced before it is published)
- `jobcontroller/`, `jobmanager/`, `streamclient/` - durable sessions: a job manager on the remote host streams PTY output with flow control
- `remote/` - SSH connections, reconnect, helper install; `remote/fileshare/` - remote file system (wsh, with an SFTP fallback for hosts without the helper)
- `wslconn/` - WSL connections
- `filestore/`, `wstore/` - block files (terminal output) and object storage
- `wconfig/` - configuration; `waveobj/` - core objects and metadata keys
- `wps/` - pub/sub events; `web/` - HTTP and WebSocket server
- `aiusechat/` - the natural-language command composer only
- `telemetry/` - no-op stubs; GenieTerm records and sends no telemetry

### 4. Command Line Tools (`cmd/`)

- `wsh/` - the CLI, shipped as both `genie` and `wsh`
- `server/` - wavesrv
- `generatego/`, `generatets/`, `generateschema/` - code generation (`task generate`)

## Communication Architecture

All inter-process communication goes through WSH RPC (`pkg/wshrpc/`): frontend ↔ wavesrv over WebSocket, Electron main ↔ wavesrv, and wavesrv ↔ remote hosts (SSH, WSL) through the remote helper.

- `pkg/wshrpc/wshrpctypes.go` - source of truth for RPC commands and types
- `pkg/wshrpc/wshserver/` - server implementations; `pkg/wshrpc/wshremote/` - remote-side implementations
- `pkg/wshrpc/wshclient/` - generated Go client; `frontend/app/store/wshclientapi.ts` - generated TypeScript client

Callers address RPCs by route (a block id, a connection, the main server); the router picks the transport.

## Development Notes

- Use `task` for build, generate and packaging commands; `task v1:gate` is the merge gate
- Run `task generate` after changing Go types in `pkg/wshrpc/wshrpctypes.go`, `pkg/wconfig/settingsconfig.go` or `pkg/waveobj/wtypemeta.go`
- Tests: Vitest for TypeScript, `go test` for Go; `scripts/perf-bench.mjs` benchmarks a packaged app
- Database migrations live in `db/migrations-wstore/` and `db/migrations-filestore/`
