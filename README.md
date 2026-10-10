<p align="center">
  <img alt="GenieTerm logo" src="./assets/genieterm-logo.png" width="128">
</p>

<h1 align="center">GenieTerm</h1>

<p align="center">The terminal for people who live in SSH.</p>

GenieTerm is a macOS terminal built around three things that usually live in separate tools:

- **Command blocks.** GenieTerm follows your shell's prompts, so every command keeps its status, duration and output together. Copy a command or its output, re-run it, or jump between commands with ⇧⌘↑ / ⇧⌘↓. Underneath it is an ordinary xterm session; switch to the classic grid in Settings whenever you like.
- **Durable SSH.** A durable session keeps running on the host through sleep, network changes and app restarts, then reattaches and streams back whatever it printed while you were away.
- **Remote files.** Browse folders on this Mac or any connected host, preview Markdown, images and code, edit with atomic saves, drag files in, and download whole folders, all next to the shell that's using them.

It runs on your machine. There is no account and no usage data. The one AI feature is optional: press ⇧⌘Space, describe what you want, and GenieTerm proposes a command for you to review. It never runs one on its own.

## Install

Download the latest release from the [Releases page](https://github.com/Ry3nG/GenieTerm/releases) (Apple Silicon and Intel). The app is ad-hoc signed and not notarized, so the first launch is blocked by Gatekeeper: move it to `/Applications`, try to open it once, then choose **Open Anyway** in System Settings → Privacy & Security. GenieTerm updates itself after that.

A Windows x64 build is published as an unsigned preview on prerelease tags; see [`docs/windows-release-gate.md`](docs/windows-release-gate.md). Linux is not shipped.

## The `genie` helper

Inside any GenieTerm terminal, local or remote:

```sh
genie view README.md      # preview a file in a block
genie edit ~/.zshrc       # open it in the editor
```

GenieTerm installs the helper on a host the first time you connect (it asks first). Without it, Files still works over SFTP. `wsh` and `wsh://` remain as aliases for `genie` and `genie://`.

## Development

```sh
task init           # install dependencies
task electron:dev   # run the app in development
task v1:gate        # the merge gate: typecheck, lint, tests, Go checks, audits, visual QA
```

Build and install a local macOS package (build outside File Provider-managed folders such as iCloud Drive):

```sh
GENIETERM_BUILD_OUTPUT=/private/tmp/genieterm-make task package -- --mac zip --arm64
rm -rf /Applications/GenieTerm.app
ditto --norsrc /private/tmp/genieterm-make/mac-arm64/GenieTerm.app /Applications/GenieTerm.app
```

On Windows x64, with Node 22, Go, Task and Zig installed:

```powershell
task package -- --win --x64
node scripts/verify-windows-package.mjs make --window-smoke --installer-smoke
```

Product scope and what comes next are in [`docs/GENIETERM-ROADMAP.md`](docs/GENIETERM-ROADMAP.md); release gates are in [`docs/v1-release-gate.md`](docs/v1-release-gate.md).

## Relationship to Wave

GenieTerm is a fork of [Wave Terminal](https://github.com/wavetermdev/waveterm). It keeps Wave's runtime (durable remote sessions, previews, the editor, the helper, Electron/Go packaging) and narrows the product to the terminal, durable remote sessions and files. Wave AI chat and the app builder are removed. Internal names still say Wave so the code reads like upstream.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [ACKNOWLEDGEMENTS.md](./ACKNOWLEDGEMENTS.md).
