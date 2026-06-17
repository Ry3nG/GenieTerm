# Building GenieTerm

These notes cover local development and packaging for GenieTerm.

## Prerequisites

- Node.js 22
- Go 1.25 or newer
- Task: https://taskfile.dev/installation/
- npm

Linux packaging also needs `zip`, `rpm`, `snapd`, `snapcraft`, `lxd`, `libarchive-tools`, `binutils`, `libopenjp2-tools`, `squashfs-tools`, and Zig.

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

## Focused Tests

Run the transfer tests used by CI:

```sh
npm test -- frontend/util/transferutil.test.ts emain/transfer/download-folder.test.ts frontend/util/previewutil.test.ts --run
```
