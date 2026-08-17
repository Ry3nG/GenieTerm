<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Wave leftovers still in the tree

Inventory of platform that GenieTerm **inherits and currently keeps** so Wave merges stay possible. This is not a product backlog. Do not re-open these as features.

Default UX should not depend on anything in the "hidden" column.

| Subsystem                                                        | Default path                                                                                   | Why it is still here                  | Cleanup later                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `pkg/aiusechat`, WaveAI RPCs, `schema/waveai.json`               | Hidden. Chat panel removed; retirement tests lock that. Composer uses `aicommandcompose` only. | Soft-fork merge surface               | Stop registering unused HTTP/RPC if we declare a hard fork |
| `tsunami/`, `frontend/builder/`, `tsunamiscaffold` extraResource | Hidden unless `feature:waveappbuilder === true`                                                | Soft-fork + opt-in builder            | Stop packaging the scaffold when the flag is off           |
| `vdom` view + `/vdom/`                                           | No widget. Still used by some `wsh` HTML overlays                                              | Wire protocol                         | Keep until helper widgets are gone                         |
| `launcher`, `aifilediff`, `cpuplot` alias                        | Not in default widgets                                                                         | Registry compatibility                | Leave registered                                           |
| `pkg/wcloud`, telemetry loops                                    | Endpoints empty; `telemetry:enabled: false`                                                    | Merge-stable no-op                    | Idle loops can be gated                                    |
| Wave upgrade onboarding `v0.12`–`v0.14`                          | **Removed** in the 2026-08 doc/onboarding convergence                                          | Was user-visible rot                  | Do not restore                                             |
| `aiprompts/*`                                                    | Contributor notes only                                                                         | Describes Wave internals we still run | Read as inherited architecture, not product docs           |
| `RELEASES.md` Wave S3 / brew / winget                            | **Rewritten** for this repo's `release.yml`                                                    | —                                     | —                                                          |
| `SECURITY.md` Wave mailbox                                       | **Rewritten** to the GenieTerm owner                                                           | —                                     | —                                                          |

Internal names (`wavesrv`, `waveterm.db`, `WAVETERM_*`, JWT issuer `waveterm`) stay. They are merge-stability internals, not leftovers to rename.
