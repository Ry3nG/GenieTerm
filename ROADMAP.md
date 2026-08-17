# GenieTerm Roadmap

GenieTerm is a semantic, remote-native terminal: command blocks, durable sessions, and file movement in one workflow. Classic xterm stays available as a compatibility mode over the same runtime.

Public `genie` / `genie://` aliases are additive. `wsh` / `wsh://` remain supported.

The living tracker is [`docs/GENIETERM-ROADMAP.md`](docs/GENIETERM-ROADMAP.md). That file is the source of truth when this summary drifts.

## Now

- Finish the daily-driver semantic terminal: jump past output, per-block actions, honest shell-integration fallback.
- Finish remote files: cancel/retry in the transfer UI, `genie://` presentation, macOS installed-app smoke.

## Next

- Subscriber-gated remote sysinfo.
- Honest path when the remote helper is missing.
- 1.0 as terminal + durable remote + files — not a Wave-sized surface.

## Later

- Session-aware local/remote file handoff.
- Palette workflows.
- IDE-style input editor over the existing xterm session.
