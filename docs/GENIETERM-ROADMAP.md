<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# GenieTerm Roadmap

Living tracker. Release scope last reviewed for **1.0.0** on 2026-10-11.

If a sentence here disagrees with an older plan, this file wins. Superseded plans live in git history.

## Product identity

GenieTerm is an open, local-first, no-login **semantic terminal** for people who live in SSH.

It is not Ghostty (speed), not Warp (closed + login), not VS Code Remote (an IDE), and not Wave's AI workspace. The only defensible wedge is the combination nobody else ships together:

1. Command-aware terminal presentation over one xterm runtime
2. Durable local and remote sessions
3. Remote files that share that same workspace

**AI rule:** no chat panel, no agent launcher, no me-too coding agent. The only first-class AI is **natural language → a proposed command** (insert/copy, never auto-run).

**Soft-fork rule:** user-facing name is GenieTerm; internals stay `Wave*` / `wshrpc` / `WAVETERM_*` / `.waveterm` so the code still reads like upstream and existing user data keeps working. Do not rename those to "finish the rebrand." The Go module path is already `github.com/Ry3nG/GenieTerm`, so an upstream cherry-pick needs its imports rewritten.

**xterm ceiling:** decorations can draw cards, gutters, and overlays. They cannot fold or hide buffer lines. Do not promise Warp-style collapse. "Jump past output" is the substitute.

## What 1.0 actually is

1.0 is **terminal + durable remote + files + host**. Every machine you work on, local or over SSH, is a first-class object: its shell, its files, and what it is doing (GPUs, processes, ports). Web may exist; it is not release-blocking.

See `docs/v1-release-gate.md`.

## Shipped

- Semantic presentation default (`term:presentation: semantic`); classic xterm is the same `TermWrap` with decorations off
- Command-block data from OSC 16162 A/C/D; gutter card; last-command status / duration / copy / re-run / Fix with AI
- Jump previous/next block (`Cmd:Shift:Up/Down`); palette copy last command / output
- Fig / history / path / file completion; ArrowRight accepts the highlighted item
- Command composer (`Cmd:Shift:Space`) + inline NL compose; Wave AI chat panel removed from the default UX
- Public `genie` CLI + `wsh` compatibility binary; remotes prefer `~/.genieterm/bin/genie`
- Parser accepts `genie://` and `wsh://`; formatted URIs emit `genie://`
- Files: folder download, drag-drop upload, transfer queue model + status list
- Git sidebar; command palette; editable keybindings
- Widget rail opt-in; WaveAI chat and Tsunami/builder removed from the tree
- Apple-dark visual system; GenieTerm branding and data directories
- 0.4.87: completion input mirror follows ctrl/option word-jump arrows and alt-delete; completion providers time out instead of blocking the popup; `genie://conn/` root paths parse and `tryParseRemoteUri`/`isRemoteUri` simplify URI handling
- 0.4.91: command blocks and their output boundaries restore from terminal checkpoints and raw shell markers; terminal input is sent in order, and recovery deduplicates concurrent output by file offset
- 0.4.91: helperless SSH connections use SFTP for file browsing, preview, editing, and transfer; transfer jobs survive app restarts with interrupted downloads available for retry
- 0.4.91: large directory lists render incrementally with virtual rows; connection JSON editing detects disk changes; terminal and process views reduce background work; editor modules load on demand and release packages omit source maps

- 0.4.92–0.4.94-beta.2: Windows x64 NSIS/ZIP preview (unsigned, prerelease tags only), native Windows CI packaging and installer smoke, release asset validation

## 0.5.0 — release hardening

- Terminal: Enter always reaches the shell (no natural-language interception; the exit-127 proposal and `Cmd:Shift:Space` composer stay); re-run and inline "Run" refuse to type into a running program; blocks without a `D` finish as "Interrupted"; stale completion popups never apply; history completion matches the whole typed prefix; `Cmd+K` keeps the next block; settings changes no longer rebuild the terminal; cache snapshots record scrollback
- Shell integration: PowerShell command blocks (A/C/D, untested on Windows hardware), fish base64 fix, nounset-safe bash/zsh hooks, `$?` preserved for prompt frameworks, appends tagged with the terminal file epoch
- Remote: SSH auto-reconnect with backoff after drops and sleep/wake, handshake timeouts, keepalives for helperless hosts, ProxyJump/agent cleanup, durable-session confirmations on window close / workspace delete / connection switch, actionable host-key errors
- Files: atomic, symlink-preserving saves and copies; no 32 MB cap; folder upload; save conflict detection; delete always confirms and names the path; cancel no longer quits the app; retry works for every transfer type; rsync/scp honor ports and GenieTerm connection settings and quote remote paths
- Platform: telemetry and Wave cloud endpoints removed; process viewer and sysinfo sample only under a live lease; dead RPCs, events, config keys and Electron leftovers removed
- Release: macOS-only stable channel (ad-hoc signed), Windows deferred to prerelease previews, draft-then-verify publishing, update metadata verification, updater relaunches the old app on any install failure
- Supply chain: Go 1.27, govulncheck/gofmt/vet in the gate, npm advisories cleared, workflow actions pinned by SHA
- Performance: PTY output coalescing, router backlog drained on progress, batched terminal appends, lazy view modules, durable stream window 2 MB (200k lines in ~1 s; 10 MiB over a 50 ms link in ~0.5 s)

## 1.0.0

- Host view (replaces Sysinfo and Processes): a summary plus per-resource detail (CPU, memory, each GPU from nvidia-smi, network, disks), processes, listening ports with owners; the genie helper carries a protocol stamp and updates in place; SSH local port forwarding (`pkg/remote/portforward`); see `docs/releases/v1.0.0.md`
- Long-command notifications (`term:notifyafter`), click-through to the block
- Terminal header: clickable working directory (opens Files there) and git branch / ahead-behind / dirty; widget rail shown by default with Terminal, Files, Host, each opening on the focused connection
- Removed: Git panel and `GitRunCommand`; Web from the rail
- One renderer per window with an LRU of mounted tab panes; hidden panes stop drawing and release WebGL (five tabs 1.2 GB → 0.7 GB, ~26 MB per extra tab). See `docs/performance/single-renderer.md`
- Terminal header shows the working directory; default-named tabs follow the first block's folder
- Command palette: groups, keyword/initials search, recent-first, saved connections
- Ctrl-C exits show as Interrupted; transfer queue rows with progress, status and reasons; composer example prompts; welcome screen says what GenieTerm is
- No telemetry calls remain in the UI

## Known gaps

- PowerShell integration and the Windows preview need a smoke test on real Windows hardware
- Multi-select remote file transfers (#17) are not implemented
- Host on Windows: listening ports are not implemented; GPUs only for NVIDIA (no Apple Silicon or AMD)
- Port forwards are in memory and end when GenieTerm quits; the "open a forwarded URL when a terminal prints localhost:PORT" prompt is not built
- rsync folder downloads show no percentage (openrsync and rsync 3 share no progress format)
- Copying from an SFTP-only host to a wsh host still buffers files and refuses folders/large files with a clear error
- Re-run clears the typed line with Ctrl-E Ctrl-U; shells in vi mode may not honor that

## Next work (in this order)

### P1 — Daily-driver terminal

Shipped in 0.4.84: jump past output, sticky command action bar with hover-target + per-block copy/re-run, missing shell-integration banner, one-shot durable prompt on SSH.

### P2 — Remote workspace

Shipped in 0.4.84: transfer cancel/retry in Files (folder rsync), `genie://` display, honest helper-missing copy, sysinfo sampling only while a sysinfo view is open.

### P3 — Leftover platform

Done in 0.4.82: WaveAI chat, Tsunami/builder, launcher, and aifilediff are gone. Composer (`codexcompose`) stays. VDom RPC stays because it is still on the term `wsh` bus. See `docs/leftovers.md`.

### P4 — 1.0

Shipped 2026-10-11 after `docs/v1-release-gate.md` passed on a real Mac. Stable 1.0 is macOS-only; Windows x64 joins the stable channel only after `docs/windows-release-gate.md` passes for a signed package.

### P5 — After 1.0

Offer to forward when a remote terminal prints `http://localhost:PORT`. Durable sessions list per host. Workflows in the palette. Then an IDE input editor. Not a custom renderer. Not a multi-agent product.

## Fork policy

There is no upstream remote or merge cadence today. Either set one up (and accept the import rewrites), or keep deleting leftover subsystems. A soft fork with no upstream pulse pays the tax and gets none of the fixes.

## How to continue

1. Read this file, then `docs/leftovers.md` if the change touches Wave platform code.
2. Close a known gap above before adding a new widget.
3. Keep this file current in the same PR. Do not add a fourth product definition.
