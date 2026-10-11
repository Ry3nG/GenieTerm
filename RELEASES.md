# Releasing GenieTerm

GenieTerm publishes from **this** repository: [Ry3nG/GenieTerm](https://github.com/Ry3nG/GenieTerm). Ignore leftover Wave S3 / Homebrew / WinGet / Chocolatey / Snap instructions — this fork does not operate those channels.

## What ships

| Channel                      | Platforms                                                             | Signing                                                                    |
| ---------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Stable (`vX.Y.Z`)            | macOS arm64 + x64 (zip and dmg), Linux arm64 + x64 (AppImage and deb) | macOS ad-hoc signed, not notarized (no Apple Developer ID); Linux unsigned |
| Prerelease (`vX.Y.Z-beta.N`) | macOS and Linux arm64 + x64, Windows x64                              | macOS ad-hoc; Linux unsigned; Windows **unsigned preview**                 |
| Windows on stable            | deferred                                                              | needs a code-signing certificate (`docs/windows-release-gate.md`)          |
| Linux                        | AppImage and deb, x64 + arm64                                         | unsigned; update metadata verifies SHA-512 and size                        |

## Current process

1. Land the work on `main`. `package.json` `version` is the single source (`version.cjs` → Taskfile ldflags → Go `WaveVersion`). Release versions are `X.Y.Z` or `X.Y.Z-beta.N`.
2. Confirm CI is green on `main` (`.github/workflows/ci.yml`): the `V1 gate` job runs `node scripts/v1-gate.mjs`. Non-draft PRs, pushes, and manual runs package and smoke-test Linux x64 and Windows x64; pushes and manual runs also package and launch-smoke macOS arm64.
3. Run `task v1:gate:package` on a Mac (see `docs/v1-release-gate.md`).
4. Optionally add release notes at `docs/releases/vX.Y.Z.md`. They become the GitHub Release body and are embedded in the update metadata, so the in-app update dialog shows them.
5. Tag the same version:

   ```sh
   git tag v1.0.0
   git push origin v1.0.0
   ```

6. Pushing `v*` runs `.github/workflows/release.yml`:
   - **Preflight** (Ubuntu): tag matches `package.json`, then `node scripts/v1-gate.mjs` — the same gate as CI.
   - **build-macos**: `task package` for arm64 + x64, `task package:verify -- make --require-arch arm64,x64` (bundle identity, helpers, `codesign --verify --deep --strict`, and `*-mac.yml` version/size/sha512 against the zips), a packaged-window smoke of the arm64 app, and a check that packaging left the checkout unchanged.
   - **build-linux**: native x64 on `ubuntu-22.04` and arm64 on `ubuntu-22.04-arm`, after preflight. Pinned Zig 0.13.0 builds the CGO server against glibc 2.28; helpers remain pure Go. Each matrix job builds AppImage + deb, verifies their payloads and update metadata, runs the extracted AppImage under `xvfb-run` using CDP, and checks that packaging left the checkout unchanged (excluding Zig's cache).
   - **build-windows**: only on prerelease tags and manual runs (or on stable when `GENIETERM_WINDOWS_STABLE=signed`, see below). Builds and smoke-tests the NSIS installer and zip.
   - **publish**: runs only when macOS and both Linux builds succeeded and Windows succeeded or was skipped. `scripts/verify-release-assets.mjs` checks the exact asset set — Windows assets only when the Windows build ran, so a stable release without Windows never carries a Windows `latest.yml` — and every update manifest. The release is created as a **draft**, the uploaded assets are compared (name, size, sha256) with the verified artifacts, and only then is it published (`--latest` for stable, `--prerelease` for prereleases). An already-published release is never overwritten; the job fails instead.
7. Smoke the published macOS artifact with `docs/installed-app-gate.md` before telling anyone to install it.

`workflow_dispatch` on the Release workflow builds and verifies everything (including an unsigned Windows preview) without publishing.

If a publish run fails after creating the draft, fix the cause and re-run the workflow: it reuses the draft. Delete the draft on GitHub if its assets should be discarded.

## Installing an unsigned macOS build

The macOS app is ad-hoc signed but not notarized, so Gatekeeper blocks the first launch of a downloaded copy:

1. Move `GenieTerm.app` to `/Applications` (do not run it from the dmg).
2. Open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway** for GenieTerm.

Alternatively, clear the quarantine attribute from Terminal: `xattr -dr com.apple.quarantine /Applications/GenieTerm.app`.

## Local package (no tag)

```sh
GENIETERM_BUILD_OUTPUT=/private/tmp/genieterm-make task package
rm -rf /Applications/GenieTerm.app
ditto --norsrc /private/tmp/genieterm-make/mac-arm64/GenieTerm.app /Applications/GenieTerm.app
```

Without `CSC_LINK` / `CSC_NAME`, `electron-builder.config.cjs` ad-hoc signs the bundle (`mac.identity: "-"`). Packaging from a File Provider-managed folder will break signing; keep `GENIETERM_BUILD_OUTPUT` on a real disk.

## Auto-update

Packaged builds use `electron-updater` with the generic feed `https://github.com/Ry3nG/GenieTerm/releases/latest/download/`, which always resolves to the latest **stable** release. There is no Wave S3 feed and no Homebrew cask.

- **macOS**: builds without a Developer ID cannot use Squirrel.Mac. GenieTerm downloads the zip in the background and, on **Restart Now**, launches a helper that re-verifies the zip's sha512, the bundle id, version, and code signature, waits for GenieTerm and `wavesrv` to exit, swaps the bundle, and relaunches. Any failure restores and relaunches the original app (log: `updater-helper.log` in GenieTerm's logs folder, normally `~/Library/Logs/GenieTerm/`). If the app runs from a read-only location (a mounted dmg, App Translocation) or a folder the user cannot write, GenieTerm stays open and offers the release page or the downloaded zip instead. Install-on-quit is only available on Developer ID–signed builds.
- **Beta channel**: prereleases are never served by the feed and are installed manually from the Releases page. Stable releases ship `beta-mac.yml` / `alpha-mac.yml` with the same content as `latest-mac.yml`, so users on the beta channel keep receiving stable updates.
- **Windows previews** are installed manually. When the latest stable release has no Windows metadata, the updater reports "no updates" instead of an error.
- **Linux AppImage**: the packaging supplies electron-updater's generic feed in `resources/app-update.yml` and publishes `latest-linux.yml` for x64 and `latest-linux-arm64.yml` for arm64. Stable builds also publish matching `beta-linux*.yml` and `alpha-linux*.yml`. Each manifest contains only that architecture's AppImage, with its size and SHA-512. AppImage installs support self-update when the file and its directory are writable; keep the downloaded file executable (`chmod +x`).
- **Linux deb**: update manually by downloading the new package and running `sudo apt install ./GenieTerm-linux-<arch>-<version>.deb`. Deb files are excluded from updater metadata; there is no GenieTerm apt repository.

## Linux packaging and verification

Run on a native x64 or arm64 Linux host with Node, Go, Task, Zig 0.13.0, and the Electron/Xvfb dependencies installed by the Linux workflow jobs:

```sh
GENIETERM_LINUX_TARGETS=AppImage,deb task package -- --linux --publish never
ARCH="$(node -p 'process.arch')"
VERSION="$(node -p 'require("./package.json").version')"
task package:verify -- make --require-arch "$ARCH"
xvfb-run -a node scripts/verify-installed-app.mjs --window-smoke --linux-appimage "make/GenieTerm-linux-${ARCH}-${VERSION}.AppImage"
```

The Linux artifact names are `GenieTerm-linux-x64-<version>.AppImage`, `GenieTerm-linux-x64-<version>.deb`, `GenieTerm-linux-arm64-<version>.AppImage`, and `GenieTerm-linux-arm64-<version>.deb`. Deb control architectures are `amd64` and `arm64`; prerelease control versions use `~` in place of `-` for Debian version ordering. Native runners are required because `wavesrv` is built for the host architecture. The glibc 2.28 backend floor targets Ubuntu 20.04+/Debian 10+; the runner smoke does not establish compatibility with every older distribution or desktop.

Verification extracts the executable AppImage without mounting FUSE, checks Electron/server ELF architecture, archive identity/version, all versioned `genie` and `wsh` helpers, the generic update feed, and manifest hashes/sizes. It inspects the deb control fields and dependencies, lists and extracts its payload, and checks the executable, desktop entry and icons. Debian maintainer scripts register `/usr/bin/genieterm`, preserve the setuid Chromium sandbox, and remove the alternative on uninstall without removing it during an upgrade.

The smoke uses an isolated profile, config, and data directory, connects to Electron over CDP, and checks a visible packaged window, title, error boundary, console errors, and rendered content. It retries with `--no-sandbox` only when Electron reports that the smoke environment's sandbox is unavailable; this flag is never added to the shipped desktop entry.

## What this fork does not do

- Wave "Bump Version" / "Build Helper" workflows
- Upload to `s3://waveterm-github-artifacts`
- Publish to Homebrew, WinGet, Chocolatey, or Snap
- Publish Linux rpm, Snap, pacman, or zip packages (local target overrides remain available)
