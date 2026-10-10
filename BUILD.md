# Building GenieTerm

These notes cover local development and packaging for GenieTerm.

## Prerequisites

- Node.js 22
- Go 1.27 or newer
- Task: https://taskfile.dev/installation/
- npm

Windows packaging also needs Zig (see [Windows x64](#windows-x64)).

Linux packaging is unsupported and untested; GenieTerm does not ship Linux packages. The inherited Wave targets still expect `zip`, `rpm`, `snapd`, `snapcraft`, `lxd`, `libarchive-tools`, `binutils`, `libopenjp2-tools`, `squashfs-tools`, and Zig.

## Clone

```sh
git clone git@github.com:Ry3nG/GenieTerm.git
cd GenieTerm
```

## Install Dependencies

```sh
task init
```

## Run Locally

Run the Electron/Vite development server:

```sh
task dev
```

Run a standalone local build:

```sh
task start
```

## Package Locally

When building from a File Provider-managed folder on macOS, place build output outside that folder to avoid extended attribute signing errors:

```sh
GENIETERM_BUILD_OUTPUT=/private/tmp/genieterm-make task package
```

Install the arm64 app locally:

```sh
rm -rf /Applications/GenieTerm.app
ditto --norsrc /private/tmp/genieterm-make/mac-arm64/GenieTerm.app /Applications/GenieTerm.app
```

## Windows x64

Build on a native Windows x64 machine with Node.js 22, Go 1.27 or newer, Task, and Zig 0.13.0 (the version CI pins in `.github/workflows/ci.yml`). Zig is required because the Windows `wavesrv` build uses `zig cc` as its C compiler.

```powershell
task package -- --win --x64
node scripts/verify-windows-package.mjs make --window-smoke --installer-smoke
```

Windows packages are unsigned previews.

## Quality Gate

`task v1:gate` is the merge gate. It runs the full Vitest and Go suites plus typecheck, lint, format, and build checks; CI runs the same full suites.

```sh
task v1:gate
```

## Focused Tests

Focused transfer tests for a quick local regression check:

```sh
npm test -- frontend/util/transferutil.test.ts emain/transfer/download-folder.test.ts frontend/util/previewutil.test.ts --run
```
