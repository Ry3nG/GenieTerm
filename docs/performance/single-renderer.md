# Single renderer implementation and validation

The default mode uses one application renderer per window. Set `GENIETERM_LEGACY_TABVIEWS=1` before launching Electron to retain the per-tab WebContentsView mode. This does not change the renderer processes used by embedded browser webviews.

## Design decisions

- `activeTabIdAtom` owns the current selection. The compatibility `staticTabId` atom and service `uiContext.activetabid` derive from it. Frontend selection updates synchronously before IPC; main-originated selection uses `wave-switch-tab`. The root App explicitly reads the shared Jotai store even though its own hook is above the Provider.
- Each pane supplies its own TabModel context. Terminal controller resync and VDOM block creation use that model's tab ID. Multi-input filters by the source tab and rejects broadcasts from an inactive source. Terminal counting for the multi-input shortcut also filters by tab.
- The pane LRU includes the active pane. Retention order is most-recent-first, while rendered panes use stable tab-ID order so activation does not physically move retained terminal/webview subtrees. This deliberately separates eviction order from DOM order; absolute positioning makes their visual order irrelevant. The setting `window:maxtabcachesize` is clamped to at least one and to the existing RAM ceiling: 4 panes on machines with at most 8 GB, 8 with at most 16 GB, and 16 otherwise. Invalid sizes use the default of 10 before clamping. The configured value can reduce that limit further.
- Hidden panes remain at the same dimensions, offset horizontally by 200 viewport widths behind an overflow-hidden parent. They are inert, aria-hidden, and visibility-hidden. Moving them outside the clipping ancestor lets xterm's IntersectionObserver pause rendering. Mounted pane switches retain React and terminal state; evicted panes rebuild through the existing terminal history/cache path.
- WebGL contexts are released after ten seconds hidden, or earlier when allocating another context would exceed a soft budget of 12 retained terminal contexts and hidden contexts are available. This leaves room below Chromium's usual limit of 16. Visible terminals are never deliberately evicted by this budget. The loss listener is removed, the actual WebGL context is captured before addon disposal, and `WEBGL_lose_context` releases it. The 2D link-layer canvas is skipped. Activation restores the preferred renderer and applies deferred resize work. The detection context is also released.
- Layout models subscribe independently and unsubscribe on tab deletion. Cold models initialize when their persisted layout arrives. Block lookup can traverse an unmounted layout, allowing background `wsh focusblock` to update its owning tab without switching the foreground tab. Drag identifiers are scoped to a layout so a drag cannot be applied to a different tab's tree.
- Sysinfo watches and process polling pause for an inactive pane as well as a hidden document. Block and terminal focus paths avoid focusing inactive panes. Badges and the Git panel follow the active layout; document titles track tab selection and rename.
- Electron tracks active tab identity separately from the shared view's original cache key. Closing the original tab does not destroy the shared view. Workspace switching destroys the old workspace renderer and initializes a fresh one. New windows also initialize a fresh view after the startup spare is consumed. Single-view mode does not refill that spare.
- Reload initialization uses the current active tab. Renderer crashes trigger reload. Fullscreen state is resynchronized after renderer readiness. Clear Tab Cache now discards inactive panes in shared mode, preserving the existing command's usefulness.
- A unique `fe:<windowId>:<random>` route remains registered for the renderer's websocket, RPC source, and WPS client. Workspace tab routes are added and removed independently. Block routes remain unchanged. Reconnect reannounces all routes.
- Shared workspace chrome, modal state, and panel sizing survive tab switches. The legacy switch keeps native per-tab selection and cache behavior; it does not optimistically change the identity of a legacy renderer.

## Files changed

Paths below are relative to the repository root.

| Area                          | Files                                                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron lifecycle and IPC    | `emain/emain-tabview.ts`, `emain/emain-window.ts`, `emain/emain-ipc.ts`, `emain/preload.ts`                                                                                                                                                                                         |
| Active state and ownership    | `frontend/app/store/activetab.ts` (new), `frontend/app/store/global-atoms.ts`, `frontend/app/store/global.ts`, `frontend/app/store/tab-model.ts`, `frontend/app/store/focusManager.ts`, `frontend/app/store/keymodel.ts`, `frontend/app/waveenv/waveenvimpl.ts`                     |
| Panes and window UI           | `frontend/app/tab/tabpanestack.tsx` (new), `frontend/app/tab/tabcontent.tsx`, `frontend/app/store/tabpaneutils.ts` (new), `frontend/app/workspace/workspace.tsx`, `frontend/app/workspace/gitpanel.tsx`, `frontend/app/app.tsx`, `frontend/app/block/block.tsx`, `frontend/wave.ts` |
| Layout lifecycle and dragging | `frontend/layout/lib/layoutModelHooks.ts`, `frontend/layout/lib/layoutModel.ts`, `frontend/layout/lib/TileLayout.tsx`                                                                                                                                                               |
| RPC routes                    | `frontend/app/store/tabrpcclient.ts`, `frontend/app/store/wshrpcutil.ts`                                                                                                                                                                                                            |
| Terminal and polling          | `frontend/app/view/term/term-model.ts`, `frontend/app/view/term/term-wsh.tsx`, `frontend/app/view/term/term.tsx`, `frontend/app/view/term/termwrap.ts`, `frontend/app/view/sysinfo/sysinfo.tsx`, `frontend/app/view/processviewer/processviewer.tsx`                                |
| API declarations and preview  | `frontend/types/custom.d.ts`, `frontend/preview/mock/preview-electron-api.ts`                                                                                                                                                                                                       |
| Tests                         | `frontend/app/store/activetab.test.ts` (new), `frontend/app/store/tabpaneutils.test.ts` (new), `frontend/app/view/term/term-model.test.ts`, `frontend/app/view/term/termwrap.test.ts`, `frontend/layout/tests/layoutModel.test.ts`                                                  |
| Notes                         | `docs/performance/single-renderer.md` (new)                                                                                                                                                                                                                                         |

## Automated validation

`npx tsc --noEmit`, `npm run lint`, `npm run format:check` and the full Vitest suite (436 tests in 73 files) pass.

New coverage includes optimistic versus legacy selection, LRU promotion/eviction and setting limits, backend-compatible neighbor selection, route membership differences, cross-tab multi-input isolation through the actual handler, hidden resize deferral, WebGL release ordering and timing, and loading/looking up an unmounted layout.

## Manual checklist for the packaged app

Run the core checks once with the default mode and once after a full quit/relaunch with `GENIETERM_LEGACY_TABVIEWS=1`. Use disposable workspaces for close and crash checks.

1. **Renderer count and memory:** open 1, 5, and 20 tabs with comparable terminal history; visit every tab. Check one application renderer per window in default mode, with no spare refilled after use. Record renderer/private memory and GPU memory after startup, after visiting tabs, and after 15 seconds idle. Compare with legacy mode on the same workload. Embedded browser processes are separate from this count.
2. **Switching and LRU:** switch repeatedly by mouse, Cmd+1–9, and next/previous shortcuts. Check that cached tabs appear immediately, preserve selection/scrollback/search and running TUI state, and accept the first keystroke in the selected tab. Repeat with cache sizes 1, 2, and above the RAM ceiling. Verify eviction and Clear Tab Cache preserve shell sessions and restore their output.
3. **WebGL and resize:** put multiple terminals in several tabs, switch rapidly enough to pressure the context budget, then leave tabs hidden for over ten seconds. Resize the window while they are hidden. On return, verify glyphs, cursor, selection, search, terminal dimensions, and WebGL restoration; look for permanent DOM fallback or context-loss errors. Repeat with WebGL disabled in settings.
4. **Multi-input isolation:** create two tabs with two terminals each. Enable multi-input in tab A, type a distinct marker, then switch to B and type another marker. Check every terminal's received input: only terminals in the source tab may receive its broadcast. Repeat with both tabs' multi-input enabled, a command-controller block present, fast switching, and LRU eviction/recreation.
5. **Identity and RPC:** create and split blocks immediately after switching tabs; confirm each belongs to the selected tab. Exercise VDOM block creation and terminal controller restart/resync from a background tab. Run `wsh focusblock` targeting a mounted background tab and a tab that has never been mounted in this renderer; confirm its own layout focus changes and the foreground tab stays selected. Reconnect the backend/websocket and repeat.
6. **Close and creation:** close an inactive tab, the active middle tab, the first tab that originally created the renderer, and the last tab. Verify the backend's previous-neighbor rule, surviving terminal input, window close behavior, and creation of a new tab after closing the original one. Repeat rapid create/switch/close sequences and close-confirmation cancellation.
7. **Workspace and window lifecycle:** switch between populated workspaces; create and delete a workspace; open a second window. Verify workspace data, context menus, cursor coordinates, shortcuts, and input stay in the correct window. Confirm the previous workspace's renderer is destroyed.
8. **Reload and recovery:** use Shift+Cmd+R with a tab other than the original selected, then after the original tab has closed. Confirm the active tab and layout restore. In a disposable session, crash the renderer through DevTools and confirm recovery without duplicate renderers/routes. Reload and switch workspaces while fullscreen.
9. **UI state:** exercise horizontal and vertical tab bars, F2 rename, tab context menus, application menu, modals, badges, the Git panel, widgets, and panel sizing. Switch while a modal is open and while a background tab gains a badge; check focus and badge clearing affect the selected tab. Drag/reorder/split blocks in a tab and verify that a tab switch during dragging cannot alter another tab's layout. Test file drops and embedded browser focus.
10. **Polling:** open sysinfo and process viewers in multiple tabs. Observe watcher/poll traffic stopping for hidden panes and resuming for the selected pane. Repeat with the whole window hidden, a disconnected connection, and user-paused process polling.

## Measured results (packaged app, Apple Silicon, 2026-10-11)

Memory is macOS `phys_footprint` summed over every GenieTerm process, from `scripts/perf-bench.mjs --tabs 5`. Both modes ran the same build; legacy mode used `GENIETERM_LEGACY_TABVIEWS=1`.

| Metric                                | Per-tab views | Single renderer |
| ------------------------------------- | ------------- | --------------- |
| Five tabs open                        | 1229 MB       | 704 MB          |
| Five tabs, settled                    | 1009 MB       | 678 MB          |
| Relaunch, idle                        | 461 MB        | 419 MB          |
| Cost of each additional tab           | ~147 MB       | ~26 MB          |
| Renderer processes added by four tabs | 4             | 0               |
| Keystroke echo                        | ~2.45 ms      | ~2.45 ms        |

Tab switch (click to focused terminal) has a median of 67–71 ms. Output throughput did not change.

Automated packaged-app checks (Playwright over CDP, default mode) all pass:

- One renderer per window across tab creation, 14 tabs visited, reload, crash and workspace switches; a new window gets its own renderer.
- Each tab's input reaches its own shell; multi-input reaches only the source tab's terminals.
- Hidden panes release WebGL; the visible terminal keeps it after visiting 14 tabs, with no context-loss warnings.
- Closing the active tab selects the backend's neighbor; closing the original tab and then creating a tab works.
- Shift+Cmd+R keeps the active tab; a crashed renderer reloads and its terminal accepts input.
- With `window:maxtabcachesize` set to 2, two panes stay mounted; an evicted tab rebuilds with its output and accepts input.
- `wsh focusblock` run from a background tab moves that tab's focus without changing the foreground tab.
- Switching to a new workspace and back keeps one renderer and restores the workspace.

A shared renderer means a renderer crash or manual reload affects every mounted pane in that window; both recover automatically. Fullscreen, vertical tab bar, drag during a switch, and embedded browser focus have been checked by hand only.
