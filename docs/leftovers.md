<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# What stays, and why

GenieTerm deleted the unused Wave product surfaces in 0.4.82. Internal protocol names stay on purpose.

## Deleted (do not restore)

- WaveAI chat backend (`pkg/aiusechat` except `codexcompose`), HTTP `/wave/aichat`, `wsh ai`
- Tsunami app builder (`tsunami/`, `frontend/builder/`, builder RPCs, scaffold packaging)
- `aifilediff`, `launcher`, `cpuplot` alias
- Wave 0.12–0.14 upgrade onboarding

## Kept because they still run

| Thing | Why |
| --- | --- |
| `wshrpc`, WOS, `wavesrv`, `WAVETERM_*` | Soft-fork merge internals; the remote/session runtime |
| `pkg/aiusechat/codexcompose` | The only AI: NL → command proposal |
| `vdom` view + `/vdom/` + RPC | `wsh` HTML widget protocol; not a product surface, still on the term RPC bus |
| `pkg/wcloud` loops | No-op without an endpoint; still imported by telemetry send |
| Git / Web / Sysinfo / Processes | Shipped widgets, not 1.0 blockers |

Do not re-add Tsunami, WaveAI chat, or a launcher picker.
