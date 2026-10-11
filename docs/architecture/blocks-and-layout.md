<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Blocks and layout

The persistent model in `pkg/waveobj/` separates workspace, tab, layout, and block objects. A tab refers to its blocks and a `LayoutState`. Block metadata selects a `view`, an optional `controller`, and a `connection`. A terminal's semantic command blocks are records inside that terminal, not separate workspace blocks.

## Views and controllers

`frontend/app/block/blockregistry.ts` maps view names to view models. The terminal model loads eagerly; preview, web, Host, VDom, and config models load on demand. `frontend/app/block/block.tsx` creates the view model with its block, node, owning `TabModel`, and `WaveEnv`. The frame, content component, and backend process have separate lifecycles.

`pkg/blockcontroller/blockcontroller.go` owns the controller registry and `Controller` interface: `Start`, `Stop`, `GetRuntimeStatus`, `GetConnName`, and `SendInput`. `ShellController` runs `shell` and `cmd` controllers through `pkg/shellexec/`. `DurableShellController` delegates SSH shells to `pkg/jobcontroller/` and a remote job manager.

`jobcontroller.IsBlockTermDurable()` first requires view `term` and controller `shell`. An existing `JobId` preserves durable treatment. For a new job, local and WSL connections are excluded; SSH resolves `term:durable` from block metadata, connection config, then global settings, defaulting to true. The frontend counterpart is `getBlockTermDurableAtom()` in `frontend/app/store/global.ts`.

The usual lifecycle is:

1. The terminal calls `ControllerResyncCommand` with its owning tab ID, block ID, and terminal size. `TermResyncHandler` in `frontend/app/view/term/term.tsx` reacts to connection changes; manual restart uses `TermViewModel.forceRestartController()`.
2. `ResyncController()` serializes work per block and reads current metadata. It destroys a controller when the connection or implementation changes, when forced, or when restarting a finished controller. An empty controller key removes it.
3. A new controller starts in `init`. Starting requires the connection to be ready; a durable controller also requires WSH. A matching running controller is retained.
4. Controllers publish `controllerstatus` with runtime status and a version. `TermViewModel.updateShellProcStatus()` accepts newer versions into Jotai state. Direct shell states are `init`, `running`, and `done`; durable state also depends on the job manager.

Input, signals, and resize requests use `ControllerInputCommand`. Direct output is appended to the block's filestore `term` file and published as `blockfile` events. Durable output follows the job stream path in [Performance](performance.md).

`DurableShellController.Start()` reuses a running job referenced by `Block.JobId`. If that manager is no longer running, a replacement requires `force`. Shutdown calls `Stop` with `destroy: false`, preserving durable jobs. Destroying a controller calls `TerminateAndDetachJob`; block closure also drives backend cleanup through `blockclose`. Renderer eviction does not itself destroy the controller.

## Tiling and persistence

`frontend/layout/lib/types.ts` defines `LayoutNode`: leaves contain block data; containers contain children, a row/column direction, and relative sizes. `layoutNode.ts` and `layoutTree.ts` implement traversal and tree operations. `TileLayout.tsx` renders the layout; `LayoutModel.updateTreeHelper()` computes rectangles and CSS transforms from the tree.

`LayoutModel` in `frontend/layout/lib/layoutModel.ts` owns runtime tree state in `localTreeStateAtom`. Reducer actions update it synchronously. `persistToBackend()` writes the root, focused and magnified node IDs, leaf order, and pending actions through WOS after a 100 ms debounce.

Backend layout changes arrive as `pendingbackendactions` on the persisted `LayoutState`. `processPendingBackendActions()` deduplicates by `actionid`, applies them locally, and persists the result. `layoutModelHooks.ts` subscribes each tab's model independently and removes the subscription on tab deletion. Cold models initialize when their saved state becomes available.

Use the owning `TabModel.tabId` for work belonging to a pane. The compatibility `staticTabId` atom now tracks the active tab and can refer to a different pane. Tab-scoped RPC routes allow `genie focusblock` to update a background tab's layout without selecting that tab. Drag identifiers are scoped to the layout to prevent cross-tab tree edits.

## Focus

Layout focus and DOM focus are distinct. A node's `isFocused` atom drives its visual state. `frontend/app/store/focusManager.ts` finds the active layout's focused block; view models implement `giveFocus()` for their input surface.

In `block.tsx`, focus capture updates the layout when a child receives focus. The click/effect path grants DOM focus only when `focusedBlockId()` in `frontend/util/focusutil.ts` does not already find focus or a selection in the block. It tries `viewModel.giveFocus()`, then the frame's fallback input. Inactive panes are guarded against taking DOM focus. Preserve these checks when changing focus behavior: unconditional refocusing can erase selections or redirect typing to a hidden terminal.

## Styling

Prefer Tailwind v4 container queries keyed to the block's own width. Mark the relevant parent with `@container`, then use variants such as `@w600:` and `@max-w600:`. `frontend/tailwindsetup.css` defines container widths `w600`, `w450`, `w350`, `xs`, `xxs`, and `tiny`; viewport variants such as `sm:` respond to the window instead.

Never use the bare Tailwind `block` utility. Every block frame already has the global `.block` class, styled in `frontend/app/block/block.scss`; generating a display utility with that name affects the frames too. Use an appropriate flex/grid layout or `[display:block]` when a block display declaration is needed.
