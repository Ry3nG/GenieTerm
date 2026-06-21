<p align="center">
  <img alt="GenieTerm logo" src="./assets/genieterm-logo.png" width="128">
</p>

# GenieTerm

GenieTerm is a semantic, remote-native terminal for command blocks, durable sessions, and file workflows.

It is built on top of the Wave Terminal codebase and keeps Wave's strong foundation: durable remote sessions, inline previews, built-in editing, `wsh`, and cross-platform Electron/Go packaging. GenieTerm's product direction is narrower and more opinionated: make the terminal itself understand command boundaries, status, output, duration, and remote file identity while reusing the same runtime, session, and controller path.

## Current Focus

- Warp-style semantic command blocks as the default terminal presentation, with classic xterm as a compatibility mode over the same `TerminalView` / `TermWrap` runtime.
- Inline command completion powered by the Fig spec corpus (commands, flags, paths, history).
- A keyless AI command composer (natural language → command) that stays out of the normal workflow.
- A dark-only, Apple-inspired visual identity.
- Remote file and transfer flows that present `genie://` identity while preserving `wsh://` compatibility.

## Product Direction

GenieTerm will continue to develop terminal-first remote workflow features around:

- Semantic command blocks with safe gutter, status, duration, copy, and jump affordances.
- Durable local and remote sessions that remain ordinary xterm sessions underneath.
- Remote file inspection, previewing, upload, download, and recovery flows.
- Additive public `genie` / `genie://` aliases that do not break existing `wsh` / `wsh://` scripts.
- Optional app-builder and AI surfaces kept out of the normal terminal workflow.

## Relationship To Wave

GenieTerm is based on [Wave Terminal](https://github.com/wavetermdev/waveterm), an Apache-2.0 open-source terminal.

This fork keeps the upstream license and acknowledgements while developing an independent product direction.

## Development

Install dependencies:

```sh
task init
```

Run targeted tests for the first GenieTerm transfer slice:

```sh
npm test -- frontend/util/transferutil.test.ts emain/transfer/download-folder.test.ts frontend/util/previewutil.test.ts --run
```

Build a local macOS package outside File Provider-managed folders:

```sh
GENIETERM_BUILD_OUTPUT=/private/tmp/genieterm-make task package
```

Install the arm64 app locally:

```sh
rm -rf /Applications/GenieTerm.app
ditto --norsrc /private/tmp/genieterm-make/mac-arm64/GenieTerm.app /Applications/GenieTerm.app
```

## License

GenieTerm is licensed under Apache-2.0. See [LICENSE](./LICENSE) and [ACKNOWLEDGEMENTS.md](./ACKNOWLEDGEMENTS.md).
