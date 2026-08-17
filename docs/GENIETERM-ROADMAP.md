<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# GenieTerm Roadmap

Living tracker. Last aligned with `package.json` **0.4.81** on 2026-08-17.

If a sentence here disagrees with older plans under `docs/plans/` or `docs/superpowers/`, this file wins.

## Product identity

GenieTerm is an open, local-first, no-login **semantic terminal** for people who live in SSH.

It is not Ghostty (speed), not Warp (closed + login), not VS Code Remote (an IDE), and not Wave's AI workspace. The only defensible wedge is the combination nobody else ships together:

1. Command-aware terminal presentation over one xterm runtime
2. Durable local and remote sessions
3. Remote files that share that same workspace

**AI rule:** no chat panel, no agent launcher, no me-too coding agent. The only first-class AI is **natural language → a proposed command** (insert/copy, never auto-run).

**Soft-fork rule:** user-facing name is GenieTerm; internals stay `Wave*` / `wshrpc` / `WAVETERM_*` / `.waveterm` so Wave cherry-picks stay cheap. Do not rename those to "finish the rebrand."

**xterm ceiling:** decorations can draw cards, gutters, and overlays. They cannot fold or hide buffer lines. Do not promise Warp-style collapse. "Jump past output" is the substitute.

## What 1.0 actually is

1.0 is **terminal + durable remote + files**. Git, Web, Sysinfo, and Processes may exist; they are not release-blocking.

See `docs/v1-release-gate.md`.

## Shipped (on `main`, 0.4.80)

- Semantic presentation default (`term:presentation: semantic`); classic xterm is the same `TermWrap` with decorations off
- Command-block data from OSC 16162 A/C/D; gutter card; last-command status / duration / copy / re-run / Fix with AI
- Jump previous/next block (`Cmd:Shift:Up/Down`); palette copy last command / output
- Fig / history / path / file completion; ArrowRight accepts the highlighted item
- Command composer (`Cmd:Shift:Space`) + inline NL compose; Wave AI chat panel removed from the default UX
- Public `genie` CLI + `wsh` compatibility binary; remotes prefer `~/.genieterm/bin/genie`
- Parser accepts `genie://` and `wsh://` (new formatted URIs still emit `wsh://`)
- Files: folder download, drag-drop upload, transfer queue model + status list
- Git sidebar; command palette; editable keybindings
- Widget rail and app builder opt-in; telemetry / wcloud endpoints empty
- Apple-dark visual system; GenieTerm branding and data directories

## Gaps vs the daily-driver bar

- No jump-past-output action (`blockEndLine()` exists, unused)
- No per-block sticky header or hover toolbar (action bar is last-command only)
- `term:durable` defaults to `false`
- Transfer cancel/retry exist in the queue model, not in the Files UI
- User-visible remote paths still print `wsh://`
- No SFTP fallback when the helper is missing
- Remote sysinfo loop is 1 Hz whether anyone is subscribed
- First-run onboarding still taught Wave leftovers until this cleanup

## Next work (in this order)

### P1 — Daily-driver terminal

1. Jump past output
2. Sticky current-block chrome + per-block copy / re-run
3. Honest UI when shell integration is missing
4. Consider durable-on-by-default for SSH, or ask once

### P2 — Remote workspace

1. Transfer queue cancel / retry in the Files UI
2. Present `genie://` everywhere; keep `wsh://` as the wire/compat scheme
3. Honest helper-missing path (SFTP or an explicit install prompt)
4. Gate sysinfo / process sampling on subscribers (`#22`)
5. macOS installed-app smoke for download / upload / drag

### P3 — Leftover platform (do not merge-break)

See `docs/leftovers.md`. Default path should not ship Tsunami scaffold or live WaveAI HTTP if we can stop packaging them. Do not delete `wshrpc` / WOS / conncontroller.

### P4 — 1.0

Only after P1 + P2. Tag `1.0.0` when `docs/v1-release-gate.md` passes on a real Mac.

### P5 — After 1.0

Workflows in the palette. Then an IDE input editor. Not a custom renderer. Not a multi-agent product.

## Fork policy

Merge or cherry-pick Wave on a regular cadence, or start deleting leftover subsystems. A soft fork with no upstream pulse pays the tax and gets none of the fixes.

## How to continue

1. Read this file, then `docs/leftovers.md` if the change touches Wave platform code.
2. Implement the next P1/P2 item, not a new widget.
3. Keep this file current in the same PR. Do not add a fourth product definition.
