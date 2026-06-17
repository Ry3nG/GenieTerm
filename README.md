<p align="center">
  <img alt="GenieTerm logo" src="./assets/genieterm-logo.png" width="128">
</p>

# GenieTerm

GenieTerm is a remote-first terminal for files, sessions, and everyday development workflows.

It is built on top of the Wave Terminal codebase and keeps Wave's strong foundation: block-based workspaces, durable remote sessions, inline previews, built-in editing, `wsh`, and cross-platform Electron/Go packaging. GenieTerm's product direction is narrower and more opinionated: make remote development feel local, especially around files.

## Current Focus

- Reliable remote file and folder download from the Files widget.
- Side-by-side installation with Wave using a separate app identity and data directory.
- Local-first development flow for a private product fork.

## Product Direction

GenieTerm will continue to develop remote workflow features around:

- Drag-and-drop upload to remote folders.
- Transfer queue with progress, cancel, and retry.
- Multi-select transfers across files and folders.
- SFTP fallback for hosts where WSH is unavailable.
- Better remote file inspection, previewing, and recovery flows.

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
