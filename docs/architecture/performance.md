<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Performance

Two mechanisms keep terminal work independent of visible UI: tab panes share a window renderer, and durable SSH jobs stream from a separate remote process. Changes to either must preserve tab ownership, output ordering, and restoration behavior.

## One application renderer per window

`emain/emain-tabview.ts` enables shared-view mode unless `GENIETERM_LEGACY_TABVIEWS=1`. `WaveBrowserWindow` in `emain/emain-window.ts` tracks the active tab separately from the shared view's original tab identity. Closing that original tab does not destroy the shared renderer. Workspace switches replace it; renderer crashes trigger reload.

`activeTabIdAtom` in `frontend/app/store/activetab.ts` owns selection. In shared mode, frontend selection changes synchronously before IPC; main-originated changes arrive through `wave-switch-tab`. Each pane supplies its own `TabModelContext`. Controller resync, focus, and multi-input must use that ownership rather than assuming the renderer represents only the selected tab.

`TabPaneStack` in `frontend/app/tab/tabpanestack.tsx` retains a least-recently-used cache including the active pane. `window:maxtabcachesize` is bounded to at least one and a RAM-based ceiling: 4 panes at up to 8 GiB, 8 at up to 16 GiB, and 16 above that. Retention order and DOM order differ: retained panes render in stable tab-ID order so a switch does not move terminal or webview subtrees.

Hidden panes retain their dimensions but move outside an overflow-clipped parent; they are inert, aria-hidden, and visibility-hidden. This lets xterm's intersection tracking pause drawing. `TermWrap` releases hidden WebGL contexts after ten seconds, or earlier when allocating a context would exceed its soft budget of 12 and hidden contexts are available. Activation restores the preferred renderer and deferred resize work. Evicted panes rebuild from terminal history and cache; their backend shells keep running.

A renderer crash or reload affects all mounted panes in the window. Tests for these rules live in `frontend/app/store/activetab.test.ts`, `frontend/app/store/tabpaneutils.test.ts`, `frontend/app/view/term/termwrap.test.ts`, and `frontend/layout/tests/layoutModel.test.ts`. `scripts/perf-bench.mjs` measures the packaged app. Check both shared and legacy modes when changing Electron lifecycle behavior.

## Durable output path

```text
Remote shell PTY
  -> jobmanager.StreamManager (ring buffer, sequence numbers, flow control)
  -> wshrpc stream packets through the connection router
  -> streamclient.Reader in wavesrv
  -> jobcontroller: append job and attached-block files, publish blockfile
  -> TermWrap: reconcile offsets, batch appends, write to xterm
```

The remote job manager owns the PTY independently of connserver. On Unix it creates a new session and ignores SIGHUP (`pkg/jobmanager/jobmanager_unix.go`). The local `pkg/jobcontroller/` persists job identity, manages attachment, and resumes streams after the connection returns. Surviving a disconnect does not imply unlimited output retention or survival of a host reboot.

`pkg/jobmanager/streammanager.go` uses a 2 MiB sender window and a 2 MiB circular buffer. The local receiver advertises 2 MiB through `DefaultStreamRwnd` in `pkg/jobcontroller/jobcontroller.go`. The sender obeys the smaller of its window and the receiver's advertised window, including zero-window pauses. Disconnected output is bounded by the ring, so reconnect can report a gap.

Payloads and PTY reads are at most 64 KiB. The first send after idle is immediate; subsequent short packets can coalesce for up to 4 ms. Full packets, the last available window bytes, and terminal EOF/error tails bypass that wait. `pkg/streamclient/streamreader.go` acknowledges received data immediately and advertises freed space as its consumer reads.

`jobcontroller.runOutputLoop()` appends each read under `jobStream.runIfCurrent()` in `pkg/jobcontroller/jobreconnect.go`. The same stream lock protects replacement and resume-position calculation. A superseded stream therefore cannot append after the replacement's starting offset was captured. Preserve this boundary when modifying output batching.

ACKs confirm receipt, not persistence to filestore. A disconnect between receipt and append can lose already-acknowledged bytes; adding another local batching delay would enlarge that interval. `TermWrap` reconciles file offsets, fetches missing data, discards overlap, and checks file epochs so truncation does not mix old and new output.

## Compatibility and validation

A helper update leaves existing job managers running their previous binary. Larger packets and windows use the existing stream fields; a new sender must still honor an older receiver's 64 KiB advertised window. An older sender remains limited by its own window. The legacy-window test verifies current code with the old window size, not a deployed historical executable.

`pkg/jobmanager/throughput_test.go` joins production sender and reader implementations through delayed FIFO data/ACK links. It checks exact bytes and EOF for line and bulk workloads, idle echo, and recovery from a full legacy receive window. Wall-clock tests measure this in-process harness; virtual-time tests check protocol timing, not CPU throughput or end-to-end SSH/rendering performance.

Run from the repository root:

```sh
go test ./pkg/jobmanager -run 'TestDurable(Throughput|EchoLatency)$' -count=1 -v
go test ./pkg/jobmanager -run 'TestDurable(VirtualThroughput|DeterministicLink|LegacyReceiveWindow)$' -count=1 -v
```

The larger window increases queued data per session, including base64 and transport overhead. Many-session memory use and interactive latency under a saturated shared SSH transport need end-to-end measurement; the stream harness alone cannot establish those limits.
