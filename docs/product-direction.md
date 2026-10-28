<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Product direction

GenieTerm prioritizes a fast local terminal and reliable SSH, with remote files, port forwarding and session recovery available where the work happens. Opening the app should lead directly to an interactive terminal. Existing workspace data and remote-session compatibility must survive product simplification.

## Feature decisions

| Capability                                          | Direction                    | Reason                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input, rendering, startup, SSH and session recovery | Invest first                 | They affect every terminal session.                                                                                                                                               |
| Files, transfers and port forwarding                | Keep contextual              | They remove concrete steps from remote development.                                                                                                                               |
| Command history and output search                   | Keep compact                 | Finding an earlier command or its output is a specific terminal task. Avoid permanent management surfaces.                                                                        |
| Parameterized command recipes                       | First removal candidate      | A separate editor, argument syntax and storage lifecycle overlap shell functions and scripts. Validate a recurring user task before expanding or retaining this system long term. |
| Saved workspace setups                              | Secondary, loaded on request | A template for creating fresh workspaces is different from restoring existing work. Ordinary workspace switching should not load or promote it.                                   |
| Release introductions and feature walkthroughs      | Explicitly requested         | Upgrades and restarts must not interrupt terminal work. Retain progress so help remains available.                                                                                |

These are product priorities, not usage findings. No telemetry or user study establishes that a feature is unused. Removing stored recipes or templates requires a separate compatibility decision; hiding their promotion must not erase them.

Before adding a feature, name the recurring task, the current shortest path, and the steps it removes. Account for new concepts, persistent state, startup work and background activity. A feature count is not a release criterion.

## Performance evidence

Use `scripts/perf-bench.mjs` against packaged apps with isolated profiles. Record startup separately from a restored multi-tab workspace, idle physical footprint, echo latency, output throughput and settled multi-tab cost. Repeat comparable measurements before claiming an improvement. The echo probe measures input RPC to received bytes, not physical key-to-pixel latency; output arrival is not proof that the last line has painted.

On 2026-10-28, one local run of the public macOS arm64 1.6.1 package measured 424.1 MB total idle physical footprint, 476.0 MB after adding three tabs and settling, and 5,232 ms to the terminal element when restoring that four-tab workspace. This is an initial observation on one machine, not a release threshold or evidence of a 1.6 regression. Establish repeated baselines before setting budgets.

Code review found synchronous whole-snapshot reads and writes in `emain/command-library.ts`, worth profiling as history grows. Host overview sampling and ports polling already stop when their views are not visible; removing those features cannot be assumed to improve idle performance.
