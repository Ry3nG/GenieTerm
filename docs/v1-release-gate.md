# GenieTerm v1.0.0 Release Gate

This document is the acceptance contract for shipping GenieTerm v1.0.0. A feature is not release-ready because it exists; it is release-ready only when it passes the functional, visual, interaction, and installed-app gates below.

## Product Bar

- Every visible surface must feel intentional: predictable layout, clear hierarchy, stable dimensions, useful empty/error/loading states, and no clipped or overlapping text.
- Every command that mutates local or remote state must be parameterized, confirm destructive actions, report structured errors, and be testable without relying on shell-string concatenation.
- Every v1 feature must work in the installed app, not only in dev mode.
- Every major UI flow must have both automated checks and a visual QA record before release.
- If a feature is incomplete, it must be hidden, guarded, or removed from the release path.

## Core Feature Matrix

| Area | v1 Capability | Acceptance Bar |
| --- | --- | --- |
| Terminal | semantic command blocks, classic compatibility, command status, duration, copy/rerun affordances | commands render as stable blocks; failed commands are visually distinct; selection/copy/rerun do not corrupt terminal input |
| Workspace | tabs, block layout, focused block context, persistent workspace state | layout restores correctly; focused cwd/connection drives side panels; no panel acts on the wrong host/path |
| Files | local/remote browsing, preview, edit, upload/download, transfer queue | file actions have clear target identity; destructive actions confirm; previews handle text/image/markdown/csv/json/errors |
| Git | Source Control, graph, diff, staging, commit, pull/push/fetch | VS Code-like changes/staged/merge groups; Git Graph-like refs/topology/details; diff supports readable file/hunk rendering; commands are RPC-parameterized |
| Web | webview navigation and session safety | URL state is visible; navigation errors are recoverable; webview cannot silently hijack app shortcuts |
| System Info | CPU/memory/process/system panels | values refresh predictably; unavailable remote data has explicit errors; charts do not jump or overlap |
| Processes | process list and actions | list handles remote errors; kill/refresh actions are explicit and safe |
| Settings | app config, theme, connections, secrets | settings persist; invalid values show actionable validation; secrets are never logged or displayed accidentally |
| Transfer | download/upload/copy queues | progress, cancel, retry, history, conflict behavior, and failure recovery are covered |
| Release/Update | package, install, launch, version, signing state | packaged app launches; bundle version matches package version; install verification passes on target platform |

## Automated Gate

Run the baseline gate before merging any v1 change:

```sh
task v1:gate
```

Run the release gate before tagging:

```sh
task v1:gate:package
```

The release gate must pass:

- TypeScript typecheck.
- Full Vitest suite.
- Go test suite for repo packages.
- Production frontend/electron build.
- Standalone preview build, including visual QA fixtures.
- Preview screenshot QA at fixed desktop and narrow viewports.
  Current preview coverage is tracked in `docs/visual-qa/preview-screenshot-gate.md`.
- Preview interaction QA for the highest-risk preview surfaces.
  Current interaction coverage is tracked in `docs/visual-qa/preview-interaction-gate.md`.
- macOS packaging on the release machine.
- Packaged app artifact identity, version, helper binaries, zip presence, and signature verification on macOS.
  Current package artifact checks are tracked in `docs/packaging-artifact-gate.md`.
- Installed app bundle version and signature verification on macOS.
  Current installed app checks are tracked in `docs/installed-app-gate.md`.

## Visual QA Gate

Each feature area needs visual QA evidence across these states:

- Empty/default.
- Loading.
- Error.
- Dense content.
- Narrow and wide window.
- Local and remote context where applicable.
- Keyboard and pointer interaction.

The visual QA pass should use Computer Use for the installed app whenever the app surface is involved. Screenshots must be reviewed for clipping, overlap, confusing hierarchy, unreadable contrast, and stale content.

## Interaction Gate

Each core workflow must have a short interaction script before release:

- Launch installed app.
- Open or restore a workspace.
- Run terminal command and inspect command block status.
- Browse files and open previews.
- Use Git changes, graph, file diff, stage/unstage, and non-destructive commands.
- Open settings and verify persistence.
- Exercise remote connection error and recovery states.

## Ponytail-Inspired Development Rules

Ponytail's useful lesson for this codebase is: prefer the smallest robust implementation that rides existing platform behavior, but never remove the parts users rely on for safety. For GenieTerm v1.0.0 that means:

- Reuse existing Wave/Genie runtime, RPC, model, preview, and layout paths before creating parallel systems.
- Prefer proven libraries or platform APIs for hard domains such as diffing, process management, terminal behavior, and packaging.
- Do not omit validation, error states, accessibility, tests, or visual QA to make an implementation look simpler.
- Make features boringly reliable first; polish after the state model and command contracts are solid.

## Release Decision

v1.0.0 can be tagged only when:

- `task v1:gate:package` passes.
- The feature matrix above is all pass or explicitly hidden.
- Visual QA has been performed on the installed app.
- CI is green on `main`.
- The installed app version is `1.0.0`.
