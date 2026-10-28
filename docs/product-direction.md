<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Product direction

GenieTerm prioritizes a fast local terminal and reliable SSH, with remote files, port forwarding and session recovery available where the work happens. Opening the app should lead directly to an interactive terminal. Existing workspace data and remote-session compatibility must survive product simplification.

## Feature decisions

| Capability                                          | Direction                    | Reason                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input, rendering, startup, SSH and session recovery | Invest first                 | They affect every terminal session.                                                                                                                                               |
| Files, transfers and port forwarding                | Keep contextual              | They remove concrete steps from remote development.                                                                                                                               |
| Command history and output search                   | Keep compact                 | Finding an earlier command or its output is a specific terminal task. Avoid permanent management surfaces.                                                                        |
| Parameterized command recipes                       | Removed in 1.6.2      | The editor, parameter engine and persistence operations overlapped shell functions and scripts. Their implementation has been removed. |
| Saved workspace setups                              | Removed in 1.6.2 | Template creation, storage access, UI and dedicated backend methods have been removed. Existing workspaces continue to restore.                                   |
| Release introductions and feature walkthroughs      | Explicitly requested         | Upgrades and restarts must not interrupt terminal work. Retain progress so help remains available.                                                                                |

These are product priorities, not usage findings. No telemetry or user study establishes that a feature is unused. The owner explicitly approved removing recipes and templates. Legacy files and inert template metadata are retained for recovery; no recipe or template runtime remains.

Before adding a feature, name the recurring task, the current shortest path, and the steps it removes. Account for new concepts, persistent state, startup work and background activity. A feature count is not a release criterion.

## Performance evidence

Use `scripts/perf-bench.mjs` against packaged apps with isolated profiles. Record startup separately from a restored multi-tab workspace, idle physical footprint, echo latency, output throughput and settled multi-tab cost. Repeat comparable measurements before claiming an improvement. The echo probe measures input RPC to received bytes, not physical key-to-pixel latency; output arrival is not proof that the last line has painted.

On 2026-10-28, one local run of the public macOS arm64 1.6.1 package measured 424.1 MB total idle physical footprint, 476.0 MB after adding three tabs and settling, and 5,232 ms to the terminal element when restoring that four-tab workspace. This is an initial observation on one machine, not a release threshold or evidence of a 1.6 regression. Establish repeated baselines before setting budgets.

Command history now loads lazily and writes asynchronously; closed history panels release their snapshots. Host overview sampling and ports polling already stop when their views are not visible; removing those features cannot be assumed to improve idle performance.

The 1.6.2 candidate was compared with the public 1.6.1 macOS arm64 package on an Apple M3 Pro (18 GB RAM), using five warm-profile relaunches per version and default settings:

| Measurement | 1.6.1 | 1.6.2 |
| --- | ---: | ---: |
| Window visible, median | 4,715 ms | 817 ms |
| Terminal element present, median | 5,108 ms | 1,211 ms |
| Terminal element present, range | 5,067–5,168 ms | 1,061–1,373 ms |

This is a 76% reduction in the measured terminal-startup median, not an SSH handshake or cold-boot benchmark. Renderer CPU profiling attributed about 3.7 seconds of the old startup to eager browser local-storage initialization. The production build now discards unused Jotai storage initialization and avoids loading persisted debug namespaces; command-palette recents use existing client metadata. Build-level regression tests verify that ordinary state utilities do not touch local storage and that explicitly imported storage utilities still work.

One full workload run per version also recorded the following. These samples are observations, not established latency or memory budgets:

| Measurement | 1.6.1 | 1.6.2 |
| --- | ---: | ---: |
| Idle physical footprint, all app processes | 424.1 MB | 428.1 MB |
| Idle renderer JS heap | 17.4 MB | 16.3 MB |
| Four tabs after settling, physical footprint | 476.0 MB | 452.0 MB |
| Input RPC to received echo, p50 / p95 (25 samples) | 2.75 / 143.13 ms | 2.42 / 3.45 ms |
| Receive 200,000 output lines | 1.34 s | 1.17 s |
| Restore four tabs to terminal element | 5,232 ms | 1,598 ms |

Idle memory is effectively unchanged at this sample size; the four-tab result does not yet establish a repeatable reduction. The input regression tests separately verify immediate first-byte dispatch, ordered coalescing under backpressure, Unicode/control bytes and recovery after an RPC failure. A packaged-app check connected to an actual Linux SSH host and ran a command successfully. Upgrade checks retained existing workspace IDs and command history, removed both feature surfaces, resumed the shortened tour only on request, and verified an immediate normal quit flushes pending history writes.
