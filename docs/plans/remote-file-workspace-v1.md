# GenieTerm Remote File Workspace V1

This document is the source of truth for GenieTerm's remote-file-workspace-v1 work. It replaces the narrower "Practical Transfer Pack" framing with a milestone plan that covers transfer reliability, file-sidebar ergonomics, preview/open-path follow-ups, and release gates.

Last updated: 2026-06-17

## Operating Rules

- Ubuntu is the primary implementation and CI environment.
- Do not claim macOS release readiness from Ubuntu-only evidence.
- The final macOS gate is separate and must run on a real Mac unless Zerui explicitly defers it.
- Keep Wave compatibility risks visible. GenieTerm is a fork, but upstream issue context still informs user expectations.
- Do not delete user data.
- Do not introduce Rust unless the resource baseline and profiling identify a specific hot path that TypeScript, Go, or existing native tools cannot handle well enough.
- Pause only when a product decision is genuinely required. Engineering sequencing and validation decisions should be made here.

## Issue Map

GenieTerm tracking issues:

- [#14 Remote folder download](https://github.com/Ry3nG/GenieTerm/issues/14): stop routing directories through the file stream path and provide folder-aware download.
- [#15 Drag-and-drop upload to remote folders](https://github.com/Ry3nG/GenieTerm/issues/15): local file/folder drop into a remote Files widget directory starts upload.
- [#16 Transfer queue with progress, cancel, and retry](https://github.com/Ry3nG/GenieTerm/issues/16): shared transfer state, user-visible lifecycle, retry/cancel.
- [#17 Multi-select remote file transfers](https://github.com/Ry3nG/GenieTerm/issues/17): grouped transfers with per-item status and partial-failure behavior.
- [#18 SFTP fallback when WSH is unavailable](https://github.com/Ry3nG/GenieTerm/issues/18): future fallback transport after the baseline queue and resource audit.
- [#20 Adopt Apple-inspired DESIGN.md for GenieTerm product UX](https://github.com/Ry3nG/GenieTerm/issues/20): define interaction, visual, and copy standards before larger UI work.
- [#21 File sidebar drag-to-terminal should paste quoted paths](https://github.com/Ry3nG/GenieTerm/issues/21): built-in file sidebar drag into terminal should paste safely quoted paths.
- [#22 Resource baseline and pruning audit before heavier transports](https://github.com/Ry3nG/GenieTerm/issues/22): measure CPU, memory, startup, build, and dependency baseline before heavier transport choices.

Upstream Wave references:

- [wavetermdev/waveterm#1980](https://github.com/wavetermdev/waveterm/issues/1980): remote file transfer via Files widget; includes the reproduced directory-as-file-stream bug.
- [wavetermdev/waveterm#965](https://github.com/wavetermdev/waveterm/issues/965): broad file-manager feature set. V1 borrows the transfer/navigation motivation but does not implement rename/delete/cut/copy/paste/archive management.
- [wavetermdev/waveterm#3201](https://github.com/wavetermdev/waveterm/issues/3201): copying or dragging a folder to terminal has no useful behavior; handled in GenieTerm through #21 first.
- [wavetermdev/waveterm#3349](https://github.com/wavetermdev/waveterm/issues/3349): built-in file sidebar should paste quoted paths into terminal blocks like external file managers.
- [wavetermdev/waveterm#3114](https://github.com/wavetermdev/waveterm/issues/3114): preview block reuse; a UX reference for later preview work, not a blocking V1 transfer dependency.
- [wavetermdev/waveterm#3215](https://github.com/wavetermdev/waveterm/issues/3215): HTML preview rendering; relevant to later preview depth, not required for transfer V1.
- [wavetermdev/waveterm#3329](https://github.com/wavetermdev/waveterm/issues/3329): external open-at-path via CLI or URL scheme; informs final open-path/Finder validation but is outside the first transfer queue scaffold.

## Current Baseline

The current GenieTerm `main` already contains the first folder-download scaffold:

- `frontend/util/previewutil.ts` branches remote context-menu actions by `finfo.isdir`.
- `frontend/types/custom.d.ts`, `emain/preload.ts`, and `frontend/preview/mock/preview-electron-api.ts` expose `downloadFolder`.
- `emain/emain-ipc.ts` registers the `download-folder` IPC handler.
- `emain/transfer/download-folder.ts` parses `wsh://` paths, prompts for a destination folder, creates it, and runs `rsync`.
- `frontend/util/transferutil.ts`, `frontend/util/previewutil.test.ts`, and `emain/transfer/download-folder.test.ts` cover the first path/menu/rsync helpers.

This is useful private-build scaffolding, not a complete V1. It does not yet provide a shared transfer queue, durable progress state, upload, multi-select, SFTP fallback, or final macOS release evidence.

## Product Scope

V1 turns the Files widget into a dependable remote workspace surface:

- Download remote files and folders without the directory `.txt` error response.
- Upload local files and folders into a selected remote directory.
- Show transfer lifecycle state: queued, running, completed, failed, canceled.
- Support cancel and retry in the core model before exposing full UI.
- Preserve per-item status for multi-select and grouped operations.
- Paste safely quoted paths when built-in file-sidebar items are dragged into terminal blocks.
- Keep preview/open-path features planned but do not let them block transfer reliability.

Non-goals for V1:

- Full file-manager replacement: rename, delete, cut/copy/paste, permissions editor, recursive search, or archive management.
- Public distribution, auto-update release channel, or cross-platform release claim.
- SFTP fallback before queue semantics and resource baseline are proven.
- AI agent integration or workspace restore.

## Architecture Direction

Use a small domain layer before adding heavier UI:

- `TransferJob`: immutable job description with id, operation, source, destination, item type, transport, status, timestamps, progress, and last error.
- `TransferQueue`: pure reducer/helpers for enqueue, start, progress, complete, fail, retry, cancel, and remove.
- `TransferPath`: path parsing and formatting helpers for `wsh://<connection>/<path>`, local paths, basename selection, trailing slash semantics, and shell-safe terminal quoting.
- `TransferTransport`: later interface for WSH stream/archive, rsync/scp private fallback, and future SFTP.
- Electron bridge: native dialogs, filesystem path extraction from drops, and OS integration stay in Electron main/preload.
- UI integration: Files widget and future transfer panel build jobs and observe queue state; they do not contain transport-specific process logic.

The first implementation scaffold should stay pure TypeScript where possible so Ubuntu can validate queue semantics without a remote server or a native app package.

## Milestones

### M0: Planning And Issue Coordination

Status: in progress.

Acceptance:

- `docs/plans/remote-file-workspace-v1.md` exists and is the source of truth.
- GenieTerm issues #14 through #18 link to this plan, upstream Wave references, acceptance criteria, and quality gates.
- GenieTerm issues #20 through #22 exist and link to this plan.
- No release-complete claim is made before the macOS final gate.

Quality gates:

- GitHub issue bodies have concrete acceptance criteria.
- The plan names Ubuntu and macOS validation separately.
- The worktree is committed with identity `Kestrel <gong0060@e.ntu.edu.sg>`.

### M1: Core Transfer Domain Scaffold

Acceptance:

- Add a pure transfer queue/domain module with no Electron dependency.
- Unit tests cover enqueue, start, progress, success, failure, retry, cancel, invalid transitions, and destination/path parsing.
- Existing folder-download helpers keep passing.
- No UI behavior changes are introduced in this milestone.

Ubuntu gates:

- `npm ci --no-audit --no-fund` if dependencies are not installed.
- `npm test -- frontend/util/transferutil.test.ts frontend/util/previewutil.test.ts emain/transfer/download-folder.test.ts frontend/util/transferqueue.test.ts --run`
- `npm run build:dev`

### M2: Folder Download Hardening

Acceptance:

- Remote directories never use `downloadFile` or `/wave/stream-file` from the normal folder context menu.
- Folder destination preparation rejects file collisions and creates missing directories.
- Failures map to user-facing messages that distinguish parse errors, destination errors, missing tool/start errors, non-zero transfer exit, and cancellation.
- Existing file download behavior remains unchanged.

Ubuntu gates:

- Targeted Vitest for transfer and preview utilities.
- TypeScript build check via `npm run build:dev`.

macOS smoke gate:

- Run installed GenieTerm on a real Mac.
- Download one real remote folder from the Files widget.
- Download one real remote file and verify the existing file path still works.
- Verify the original directory `.txt` error behavior is not reachable through normal folder UI.

### M3: Transfer Queue UI

Acceptance:

- A compact queue surface shows queued, running, completed, failed, and canceled jobs.
- Running jobs expose cancel when the active transport supports it.
- Failed jobs expose retry when source and destination are still meaningful.
- Queue copy and layout follow #20 `DESIGN.md` once adopted.

Ubuntu gates:

- Unit tests for reducer/state transitions.
- `task build:preview`.
- Component preview or Playwright screenshots for desktop and narrow viewports, checked for text overlap and clipped controls.

Implementation note:

- The M3 Ubuntu implementation exposes active and terminal queue state in the Files UI. Cancel/retry controls remain a #16 follow-up until Electron native downloads and spawned `rsync` jobs attach cancellable handles and retry executors to queue jobs.

### M4: Drag-And-Drop Upload And Quoted Terminal Paths

Acceptance:

- Dropping local files or folders onto a remote directory creates upload jobs.
- Upload path construction preserves basename and remote destination semantics.
- Dragging built-in file-sidebar items into a terminal pastes safely quoted paths rather than doing nothing.
- Folder and path behavior is covered by tests before UI wiring.

Ubuntu gates:

- Targeted Vitest for path parsing, path quoting, transfer queue state, and upload job creation.
- Preview/Playwright screenshot gate for any visible drag affordances.

### M5: Multi-Select And Fallback Transport

Acceptance:

- Multi-select creates either one grouped operation with item state or multiple linked jobs with a shared group id.
- Partial failure is visible and retryable per failed item.
- SFTP fallback design is written only after #22 resource baseline and transport constraints are understood.
- Rust is not introduced unless #22 produces evidence for a specific hot path.

Ubuntu gates:

- Unit tests for grouped queue behavior and retry/cancel semantics.
- Build checks for TypeScript and feasible Go targets on Ubuntu.

## Validation Matrix

Ubuntu implementation gates:

- `npm ci --no-audit --no-fund` when `node_modules` is absent or lockfile changes.
- Targeted Vitest for transfer, preview, and util tests.
- `task build:preview` for component preview build.
- `npm run build:dev` for TypeScript/Electron renderer/main build.
- Feasible Go checks on Ubuntu for touched Go packages.
- Component preview or Playwright screenshots whenever visible UI changes are made.

macOS final gate:

- `GENIETERM_BUILD_OUTPUT=/private/tmp/genieterm-make task package`
- Install `/Applications/GenieTerm.app`.
- Verify side-by-side app identity and data directory versus Wave.
- Verify native dialogs.
- Verify drag/drop.
- Verify Finder/open-path behavior.
- Run real remote Files widget download/upload smoke.

The project is not release complete until the macOS final gate has run on a real Mac or Zerui explicitly defers it.

## Commit Layers

Use coherent commits:

1. Phase 0 docs and issue coordination.
2. Pure transfer domain scaffold and tests.
3. Folder-download hardening, if needed.
4. UI queue surface.
5. Upload and drag-to-terminal path behavior.
6. Resource baseline evidence and fallback transport design.

Each commit must use:

```text
Kestrel <gong0060@e.ntu.edu.sg>
```

## Stop Conditions

Pause for Zerui only if one of these appears:

- A product decision changes V1 scope, for example full file-manager behavior versus transfer-first.
- macOS release evidence is required but no Mac is available and deferral has not been granted.
- A validation gate exposes a failing behavior that cannot be resolved without choosing between user-visible semantics.
- Resource measurements show a transport or runtime choice has material product cost and needs explicit tradeoff approval.
