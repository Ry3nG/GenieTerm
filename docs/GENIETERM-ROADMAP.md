<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# GenieTerm Roadmap & Working Doc

Living tracker for the GenieTerm fork. Identity, what's shipped, what's in flight, and
precise plans for what's deferred — so work continues step by step without re-deriving context.

## Product identity (decided with the owner)

- **Semantic terminal-first.** GenieTerm is the open, modern, best-remote, most-pleasant-to-live-in terminal.
  It competes with Ghostty/Warp/iTerm2/Wave on the *terminal* axis, not on AI, and treats command
  boundaries/status/output as first-class terminal presentation data.
- **No me-too AI.** A built-in AI chat (competes with Claude Code/Codex) and a bare agent-launcher
  (no value over typing `claude`) were both tried and **removed**. Agents "just work" in any terminal
  (the login-shell PATH fix). Real AI differentiation, if ever, = multi-agent orchestration, not chat.
- **Warp-like UX is the bet.** Warp's real innovation = command **blocks** + IDE input editor +
  command palette — done **local-first, no login, no telemetry** (the wedge against Warp). GenieTerm
  must keep one terminal runtime/session/controller: semantic mode is a presentation layer over
  `TerminalView` / `TermWrap`; classic xterm is a compatibility presentation mode, not a second terminal.
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
- **Command Blocks foundation** (v0.2.0): per-command block index from the OSC A/C/D markers, jump-between-commands
  (`Cmd:Shift:Up/Down`), and palette "Copy Last Command" / "Copy Last Command Output". Decoration UI still ⏳.
- sysinfo: Observable Plot memoized (rebuilds only on data/size change, not every render).
- Occam v2: star-ask onboarding panels now link/display the real GenieTerm repo (were starring Wave); "Upstream Project"
  link relabeled to the Wave repo it points at; redundant `rounded-[22%]` mask dropped from the logo (PNG is already a squircle).
- Preview mocks realigned to current types (`numthreads`, config `version`/`buildtime`). Remaining tsc noise = 3 errors in
  `preview-directory-utils.tsx` only — a discriminated-union narrowing quirk under `strictNullChecks: false` in upstream Wave code.
- Version bumped 0.1.0 → **0.2.0**; pushed to `origin/main`.
- Logo assets: all `genieterm-logo*.png` + `build/icon.icns` were RGB with **no alpha** → white squircle corners
  (About modal + dock). Regenerated with a corner-flood-fill alpha mask. `build/icon.ico` (Windows-only) still stale — fix on a Windows build.
- **Fork version-reset landmine (fixed):** resetting the version (0.14.5 → 0.2.0) made `IsWshVersionUpToDate`'s
  `semver.Compare(...) < 0` treat a leftover upstream `wsh v0.14.5` on remotes as "newer" → it was never replaced,
  so remote sysinfo ran on old wsh and never emitted this fork's disk/net metrics. Changed to reinstall on version
  *inequality*. Any remote first connected on old Wave auto-updates its `~/.waveterm/bin/wsh` on next connect.

## In flight: GenieTerm 0.3.0 Semantic Terminal Foundation

The signature Warp feature becomes the default terminal presentation. Feasible because shell integration
(OSC 16162 A/C/D) already registers xterm markers (`termWrap.promptMarkers`) at every command boundary.

- ✅ `frontend/app/view/term/cmdblocks.ts` — data model + buffer-range/output helpers.
- ✅ `termwrap.ts` — block index (`cmdBlocks` + `cmdBlocksAtom` + debounced publish + marker-disposal cleanup; reset on truncate/dispose).
- ✅ `osc-handlers.ts` — build/finalize blocks on A/C/D (`onPromptStart`/`onCommandStart`/`onCommandDone`); empty Enters (A with no C) are dropped via `blockHasCommand`.
- ✅ `keymodel.ts` + `term-model.ts` — jump prev/next (`Cmd:Shift:Up/Down`, `term:jump-prev/next-block`) scrolls to the prev/next command's prompt line; `term:copy-last-command` / `term:copy-last-output` (palette-first, no default key). All gated on a focused term + normal buffer.
- ⏳ `term.tsx` — semantic/classic terminal mode wrapper around existing `TerminalView` / `TermWrap`; no duplicate session/controller.
- ⏳ `term.tsx` — visible command-block affordances: gutter marker, status, duration, copy command/output, jump to command.
- ⏳ `transferutil.ts` and public copy/display helpers — accept and present `genie://` while keeping `wsh://` compatibility.
- ⏳ normal UX — Wave app-builder and built-in AI-chat surfaces hidden or demoted unless explicitly enabled.
- Later: sticky header, hover toolbar, re-run, "jump past output" (have `blockEndLine` helper ready).

**Hard constraint (do not forget):** xterm cannot fold/hide buffer lines (fixed char-grid; Warp built a
custom renderer for this). **True collapse is deferred / out of scope.** Ship "jump past output"
(scroll the long output away) as the ~80% substitute. Everything else (gutter/badge/jump/copy/sticky/re-run)
is feasible via xterm's decoration API + a thin React overlay.

0.3.0 scope: default semantic presentation + classic compatibility mode + safe visible block affordances +
additive Genie public aliases + normal-UX demotion of Wave app-builder/AI chat.

## Deferred — with plans (do these, in roughly this order)

### genie-cli (rename the user-facing `wsh` command → `genie`)
Risky: `wsh` is load-bearing for shell integration + the token handshake + the remote helper. The 0.4.0 migration model is
staged compatibility, not a destructive rename: typed command `genie`, keep a `wsh` alias; **keep internal**
`wshrpc`/`wsh://`/`wsh:cmd` meta/`WAVETERM_*` where they are merge-stability internals. Build/package emits
`dist/bin/genie-*` as the primary artifact and `dist/bin/wsh-*` as the compatibility artifact.

Remote helper migration: newly provisioned remotes install `~/.genieterm/bin/genie` and keep
`~/.waveterm/bin/wsh` available. New launch and generated shell-integration paths prefer `genie`; `wsh` remains a
fallback for existing remotes and old sessions. Version detection treats `genie vX.Y.Z` as current and `wsh vX.Y.Z` as
fallback that still needs primary-helper migration. **Verify in a real shell + a real SSH remote before shipping**
(it lands in the user's terminals on reinstall).

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

**State as of v0.3.0 planning:** Command Blocks foundation + jump + copy shipped; sysinfo memoized;
Occam polish done. The next release makes semantic terminal presentation the default while preserving
classic xterm compatibility over the same runtime.

**Reinstall is intentionally NOT done** — `task package` + replacing `/Applications/GenieTerm.app` quits the user's
running app and any live SSH session. Do release packaging/reinstall only when the owner is present
(release checklist step 4).

**Next ⏳ items, in order of safety×value:**
1. Semantic/classic presentation setting and wrapper over the existing terminal runtime.
2. Visible command-block gutter/status/duration/copy/jump affordances.
3. Safe `genie` / `genie://` public aliases that keep `wsh` / `wsh://` compatibility.
4. Hide/demote app-builder and AI-chat surfaces from the normal terminal UX.
5. Keybindings editor UI (#19) — settings view over the `keymodel.ts` action table (labels already exported).

Pick the next ⏳ item, implement incrementally, `tsc`/VSCode-errors to verify, commit, push. Keep this doc current.

## 0.4.0 implementation notes: public CLI + command composer

### CLI/helper audit and migration model

- Pre-change audit: Cobra root already presented `Use: "genie"` and kept `Aliases: []string{"wsh"}`, but packaged helper
  artifacts were `dist/bin/wsh-*` only. `task build` depended on `build:wsh`, and `dev:installwsh` copied only a `wsh`
  executable into the GenieTerm data bin directory.
- Local shell startup templates prepend the helper bin dir to `PATH`; newly generated templates call `genie token` /
  `genie completion`. The installed `wsh` executable remains as the compatibility alias.
- Remote SSH and WSL launch paths used to assume `~/.waveterm/bin/wsh` for version checks, connserver launch, and helper
  install. That path is load-bearing for existing remote sessions and older generated rc files, so it must not be removed.
- Remote install/update is staged compatibility: provision primary `~/.genieterm/bin/genie` and keep
  `~/.waveterm/bin/wsh` as a fallback. Newly generated remote shell integration and connserver launch prefer `genie`;
  fallback to `wsh` is kept for remotes that have not completed migration or old sessions already using the old path.
- Remote version detection should update when the primary helper is missing, mismatched, or the launch path fell back to
  `wsh`, even if the fallback `wsh` version matches the app version. This avoids leaving a current-version compatibility
  helper in place without installing the public `genie` helper.

### Command Composer foundation

- The existing Wave AI panel/backend remains available internally but is not the 0.4.0 UX. The composer should live in
  the terminal surface and command palette, using focused terminal context: shell/OS/cwd/connection, recent command
  blocks, and selected output when available.
- MVP output is a structured command proposal list: command, explanation, target context, and risk label. It inserts or
  copies into terminal input; it never auto-runs. Destructive/sudo/network/write commands are explicitly labelled and
  require confirmation before insertion.
- Full provider integration is deferred unless it stays small. The implementation should ship a clean model/backend seam
  plus deterministic local fallback so tests and UI are coherent before wiring live providers.
