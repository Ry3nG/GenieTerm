# Contributing to GenieTerm

Thanks for helping. This guide covers setting up a development build, finding your way around the code, and getting a change merged.

## What fits

GenieTerm is a terminal for people who work on remote machines. Changes that make command blocks, durable SSH sessions, remote files or the Host view better are the most welcome. If you're planning something larger, or a new kind of view, open an issue first so we can agree on the shape before you build it.

GenieTerm began as a fork of [Wave Terminal](https://github.com/wavetermdev/waveterm). Internal names such as `Wave*`, `wshrpc`, `WAVETERM_*` and `~/.waveterm` stay as they are, so existing user data and the remote helper protocol keep working. Use "GenieTerm" in anything a user sees.

## Set up

You need **Node.js 22**, **Go 1.27** or later, and **[Task](https://taskfile.dev/installation/)**. Packaging for Linux or Windows also needs **Zig 0.13**, which builds the backend's C dependencies.

```sh
git clone https://github.com/Ry3nG/GenieTerm.git
cd GenieTerm
task init     # install dependencies
task dev      # run the app with hot reload
```

`task preview` starts a standalone component preview, with no Electron and no backend. It renders every view with mock data and is the quickest way to work on UI.

## Find your way around

| Path           | What's there                                                                               |
| -------------- | ------------------------------------------------------------------------------------------ |
| `emain/`       | Electron main process: windows, IPC, the updater, file transfers                           |
| `frontend/`    | The React app: terminal, Files, Host, the command palette, settings                        |
| `cmd/`, `pkg/` | Go: the `wavesrv` backend and the `genie` helper that runs on remote hosts                 |
| `scripts/`     | Quality gates, package verifiers, preview QA                                               |
| `docs/`        | [Architecture](docs/architecture/README.md), release notes, [releasing](docs/releasing.md) |

Start with [docs/architecture](docs/architecture/README.md). It explains how the processes fit together and where each subsystem lives.

The code conventions are in [`.kilocode/rules/rules.md`](.kilocode/rules/rules.md). The highlights:

- Use 4-space indentation and named exports.
- Write `== null` rather than comparing against `undefined`.
- Return early instead of nesting.
- Comments explain why, not what.
- In Go, use string constants instead of enum types.

A few files are generated. After changing Go types in `pkg/wshrpc`, run `task generate`, and don't edit `frontend/types/gotypes.d.ts` or `frontend/app/store/wshclientapi.ts` by hand.

## Check your change

```sh
task check            # typecheck, lint, format, unit and Go tests, audits, preview QA
task check:release    # all of the above, then package the app and verify the build
```

CI runs `task check` on every pull request. It also packages and launch-tests the app on Linux, including an install of the `.deb` on Ubuntu 24.04, and runs the Go and Electron main-process tests on Windows. Windows and macOS packaging run after the change lands on `main`. For UI changes, include a before-and-after screenshot in the pull request and check the view at narrow widths too: blocks can be any size.

## Build a package

```sh
# macOS (both architectures; keep the output outside iCloud Drive)
GENIETERM_BUILD_OUTPUT=/tmp/genieterm-make task package

# Linux, for the machine's own architecture
GENIETERM_LINUX_TARGETS=AppImage,deb task package -- --linux
task package:verify -- make --require-arch "$(node -p process.arch)"

# Windows x64
task package -- --win --x64
node scripts/verify-windows-package.mjs make --window-smoke --installer-smoke
```

## Pull requests

- Keep each pull request focused, and say how you verified it.
- Add tests for behavior changes. Most areas have a `*.test.ts` or `_test.go` file beside the code.
- If the change is user-visible, add a line to the next release's notes in `docs/releases/`.

Maintainers cut releases as described in [docs/releasing.md](docs/releasing.md).
