<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# GenieTerm Roadmap & Working Doc

Living tracker for the GenieTerm fork. Identity, what's shipped, what's in flight, and
precise plans for what's deferred — so work continues step by step without re-deriving context.

## Product identity (decided with the owner)

- **Terminal-first.** GenieTerm is the open, modern, best-remote, most-pleasant-to-live-in terminal.
  It competes with Ghostty/Warp/iTerm2/Wave on the *terminal* axis, not on AI.
- **No me-too AI.** A built-in AI chat (competes with Claude Code/Codex) and a bare agent-launcher
  (no value over typing `claude`) were both tried and **removed**. Agents "just work" in any terminal
  (the login-shell PATH fix). Real AI differentiation, if ever, = multi-agent orchestration, not chat.
- **Warp-like UX is the bet.** Warp's real innovation = command **blocks** + IDE input editor +
  command palette — done **local-first, no login, no telemetry** (the wedge against Warp).
- **Soft fork.** Rebrand the product + own the module path (`github.com/Ry3nG/GenieTerm`); keep internal
  `Wave*`/`wshrpc`/`WAVETERM_*`/`.waveterm` so upstream Wave fixes stay cheap to merge. Preserve Wave
  Apache-2.0 attribution (About "Built on Wave" + onboarding line).
- **Visual system:** Apple design.md on dark surfaces. Tokens in `frontend/tailwindsetup.css` (@theme)
  + `frontend/app/theme.scss` (:root) — **keep these two in sync**. Accent `#2997ff`, surfaces
  `#1d1d1f`/`#272729`/`#2a2a2c`, SF Pro, 8/11/18 radii.

## Shipped (on `main`)

- Apple-dark re-skin (tokens, fonts, component shapes, hardcode sweep); version reset 0.14.5 → **0.1.0**.
- De-Wave user-visible naming incl. the AI system prompt; Go module rename → `github.com/Ry3nG/GenieTerm`.
- Editable keybindings (`app:keybindings` + action table in `keymodel.ts`, hot-reload).
- Hide tab bar/sidebar (`Cmd:Shift:b` / `Cmd:b`); right-click paste (default on).
- btop-style **sysinfo** dashboard (CPU + per-core meters + memory + network + disk; severity colors).
- Agent launcher **PATH fix** (cmd blocks run via login shell → `claude`/`codex` resolve on PATH).
- Built-in AI chat removed from default UX (no auto-open, AI button hidden); workspace default color → blue.
- **Command palette** (`Cmd:Shift:P`) driven by the keybinding action table.
- Occam cleanup: Wave doc links → GenieTerm repo, dead Discord CTAs removed, About modal fixed, logo rounded.

## In flight: Command Blocks (Warp flagship)

The signature Warp feature. Feasible because shell integration (OSC 16162 A/C/D) already registers
xterm markers (`termWrap.promptMarkers`) at every command boundary.

- ✅ `frontend/app/view/term/cmdblocks.ts` — data model + buffer-range/output helpers.
- ⏳ `termwrap.ts` — block index (`cmdBlocks` + atom + publish + marker-disposal cleanup).
- ⏳ `osc-handlers.ts` — build/finalize blocks on A/C/D (gate on normal buffer; skip empty Enters & alt-screen TUIs).
- ⏳ `term.tsx` — `<TermBlockDecorations>` → one xterm decoration per block (gutter accent + exit-code badge).
- ⏳ `keymodel.ts` + `term-model.ts` — jump prev/next (`Cmd:Shift:Up/Down`), copy command/output (palette + ctx menu).
- Later: sticky header, hover toolbar, re-run, "jump past output".

**Hard constraint (do not forget):** xterm cannot fold/hide buffer lines (fixed char-grid; Warp built a
custom renderer for this). **True collapse is deferred / out of scope.** Ship "jump past output"
(scroll the long output away) as the ~80% substitute. Everything else (gutter/badge/jump/copy/sticky/re-run)
is feasible via xterm's decoration API + a thin React overlay.

Full design lives in the Plan-agent output of session wf-… ; phased plan: index+badge+jump+copy (MVP),
then gutter-bar+sticky+jump-past-output, then hover-toolbar+re-run.

## Deferred — with plans (do these, in roughly this order)

### genie-cli (rename the user-facing `wsh` command → `genie`)  — NEEDS A REAL-SHELL TEST
Risky: `wsh` is load-bearing for shell integration + the token handshake + the remote helper. Do NOT
rush blind. Plan: typed command `genie`, keep a `wsh` alias; **keep internal** `wshrpc`/`wsh://`/`wsh:cmd`
meta/`WAVETERM_*`/`.waveterm`/remote `~/.waveterm/bin/wsh`/the `wsh vX.Y.Z` version string (parsed over SSH).
Touch points: the on-PATH binary name (`pkg/util/shellutil/shellutil.go` install/copy) + the shell-integration
scripts that call `wsh token`/`wsh completion` must change **together**; cobra `Use`→`genie`
(`cmd/wsh/cmd/wshcmd-root.go`); Taskfile build target output names can stay `wsh-<ver>`. Safest first step:
install `genie` as an additional symlink/copy alongside `wsh` (additive, non-breaking), then flip cobra Use.
**Verify in a real shell + a real SSH remote before shipping** (it lands in the user's terminals on reinstall).

### UX / discoverability (best-practice polish)
- Keybindings editor UI (the flagship feature is JSON-only today): a settings view listing the action
  table (export labels from `keymodel.ts`) with press-to-rebind → writes `app:keybindings`.
- "View" menu toggles for hide-tabbar/hide-sidebar (settings flyover in `widgets.tsx`) so they're
  recoverable/discoverable, not key-only.
- Onboarding: lead terminal-first (reorder features, AI last/optional); bump stale 2025 copyrights;
  fix `fakechat.tsx` `~/waveterm` references; the onboarding "Upstream Project" link text says
  "GenieTerm source repository" but points to wavetermdev — relabel to "Wave Terminal (upstream)".

### Perf / arch
- sysinfo: memoize the Observable Plot so it isn't rebuilt every render (effect deps on a fresh `plot`
  object) — `sysinfo.tsx` SingleLinePlot; wrap `Plot.plot(...)` + marks in `useMemo`, effect dep `[plot]`.
- (Optional) gate the backend sysinfo loop on having subscribers (`pkg/wshrpc/wshremote/sysinfo.go`).
- (Optional) single-source the two design-token files.

### Warp roadmap (after Command Blocks)
- Workflows (parameterized saved commands via the palette + an args modal); themes import; then the
  hard one — the IDE input editor (local editable buffer over xterm; reuse Monaco) for syntax highlight
  + completions + inline NL→command.

## Release checklist (do when features are complete + verified)

1. Bump version: edit `package.json` `version` (single source → `version.cjs` → Taskfile ldflags → Go `WaveVersion`).
2. Verify: `CGO_ENABLED=1 go build -tags "osusergo,sqlite_omit_load_extension" ./...` and `task check:ts`
   (ignore the 3 pre-existing preview/mock tsc errors), and smoke-test `task electron:quickdev`.
3. `git push origin main`.
4. Reinstall locally: `task package` → replace `/Applications/GenieTerm.app` with the built artifact, relaunch.
   NOTE: quitting the running app drops its window; durable SSH sessions reconnect on relaunch. Do this when
   the user is present (don't disrupt a live session unattended).

## How to continue
Pick the next ⏳ item, implement incrementally, `go build`/`tsc` to verify, commit, push. Keep this doc current.
