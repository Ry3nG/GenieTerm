# GenieTerm Roadmap

GenieTerm is a semantic, remote-native terminal designed to make commands, remote sessions, and file movement feel like one terminal workflow. The roadmap now starts with the terminal presentation itself: command blocks become the default view, while the classic xterm grid remains available as a compatibility mode over the same runtime.

## Current Slice

- GenieTerm 0.3.0 Semantic Terminal Foundation.
- Semantic terminal mode is the default presentation for `TerminalView` / `TermWrap`.
- Classic xterm mode stays available for compatibility without a duplicate session, controller, or runtime.
- Existing command-block data becomes visible through safe gutter, status, duration, copy, and jump affordances.
- Public `genie` / `genie://` aliases are additive; `wsh` / `wsh://` remain supported.

## Next Product Bets

- Command re-run and jump-past-output affordances.
- Transfer queue with progress, cancel, retry, and history.
- Multi-select transfers across files and folders.
- SFTP fallback for hosts where WSH is unavailable.
- Better remote preview, inspect, and recovery flows.

## Later

- Session-aware file handoff between local and remote tools.
- Safer batch operations for experiment artifacts and logs.
- Productized remote workflow templates for repeated development tasks.
