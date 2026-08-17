# GenieTerm v1.0.0 Release Gate

Acceptance contract for tagging `1.0.0`. A feature is not release-ready because it exists; it is release-ready when it passes the gates below **and** belongs in the 1.0 product.

## Product bar

1.0 is **terminal + durable remote + files**. Git, Web, Sysinfo, Processes, Settings chrome, and the command palette may ship with the app; they do **not** block 1.0 unless they break the three core flows.

- Every visible 1.0 surface must feel intentional: stable layout, useful empty/error/loading states, no clipped text.
- Every command that mutates local or remote state must confirm destructive actions and report structured errors.
- Every 1.0 feature must work in the installed app, not only in `task dev`.
- Incomplete platform leftovers (Tsunami, WaveAI chat, VDom apps) stay hidden or out of the default package.

## 1.0 feature matrix

| Area            | 1.0 capability                                                                                         | Acceptance bar                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Terminal        | semantic command blocks, classic compatibility, status, duration, copy, re-run, jump, jump-past-output | commands render as stable blocks; failed commands are distinct; actions do not corrupt input; missing shell integration is explicit |
| Remote sessions | local + SSH sessions reconnect; durable mode is discoverable                                           | closing the laptop or the app does not silently kill a durable remote session                                                       |
| Files           | local/remote browse, preview, edit, upload/download, transfer queue with cancel/retry                  | paths present as `genie://`; folder download never uses the file stream path; failures are retryable                                |

Out of the 1.0 contract (may exist, must not regress the rows above):

- Git sidebar
- Webview
- Sysinfo / process viewer
- App builder / Tsunami
- Command composer / inline AI (allowed, not required to tag 1.0)

## Automated gate

Before merging release-bound work:

```sh
task v1:gate
```

Before tagging:

```sh
task v1:gate:package
```

The release gate must pass:

- TypeScript typecheck, ESLint, Vitest, Go tests
- Production frontend/electron build
- Preview build + visual QA + interaction QA
- macOS package + artifact identity + installed-app smoke

Details: `docs/visual-qa/preview-screenshot-gate.md`, `docs/visual-qa/preview-interaction-gate.md`, `docs/packaging-artifact-gate.md`, `docs/installed-app-gate.md`.

## Interaction gate (installed app)

- Launch the installed app and restore a workspace.
- Run a command and inspect block status, copy, and re-run.
- Open a durable SSH session, disconnect, reconnect.
- Browse remote files; download a folder; upload a file; cancel or retry a transfer.

## Release decision

Tag `1.0.0` only when:

- `task v1:gate:package` passes on a real Mac.
- The 1.0 feature matrix is all pass or explicitly deferred in this file.
- CI is green on `main`.
- The installed app version is `1.0.0`.
