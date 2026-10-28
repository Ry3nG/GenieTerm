<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Releasing GenieTerm

Releases are built and published from this repository by GitHub Actions. The version in `package.json` is the single source: `version.cjs` passes it to the Go build (`wavebase.WaveVersion`), to electron-builder and to the tag check.

## What ships

| Channel                    | Platforms                                                                                | Signing                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Stable `vX.Y.Z`            | macOS arm64 + x64 (dmg, zip); Linux x64 + arm64 (AppImage, deb); Windows x64 (NSIS, zip) | macOS ad-hoc signed, not notarized; Linux unsigned; Windows unsigned unless signing is configured |
| Prerelease `vX.Y.Z-beta.N` | the same platforms and package formats                                                   | The same signing configuration                                                                    |

Update payload integrity is covered by the update manifests (`latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`, `latest.yml`), which record size and SHA-512. Windows ships `GenieTerm-win32-x64-X.Y.Z.exe` for normal per-user installation and a `.zip` for an unpacked copy. An unsigned Windows installer may trigger SmartScreen's unrecognized-app warning; publishing a stable version does not imply a trusted code signature.

## Before publishing

1. Land everything on `main` and make sure CI is green there. CI runs the merge gate (`scripts/v1-gate.mjs`), and it packages and launch-tests Linux x64 (including a `.deb` install on Ubuntu 24.04), Windows x64 and macOS arm64. Pull requests run the gate, Linux packaging and the Windows tests; Windows and macOS packaging run on pushes to `main`.
2. On a Mac, run `task check:release`. It runs the merge gate, packages arm64, verifies the bundle, and launches it.
3. Write `docs/releases/vX.Y.Z.md`:
   - Start with `# GenieTerm X.Y`, then one short paragraph that sums up the release. The in-app update prompt shows that paragraph, with a What's New link to the rest.
   - Follow with sections for what changed.
   - The notes become the GitHub Release body and travel in the update metadata.
4. Bump the version with `npm version X.Y.Z --no-git-tag-version` and commit.
5. Use the one-pass publication below once the release commit is ready. For testing packaging changes independently, `gh workflow run release.yml --ref <branch>` still builds and verifies every platform without publishing. A separate dry run is optional: publication runs the same checks before exposing any assets.

Before a major release, also try these by hand in the installed app:

- Restore a workspace.
- Run commands and check the block status, copy and re-run actions.
- Disconnect and reconnect a durable SSH session.
- Browse remote files, upload and download, then cancel and retry a transfer.
- Open the Host view on a GPU host and forward a port.
- Finish a long command in a background tab and check the notification.
- Update from the previous stable release.

## Build, verify and publish once

```sh
gh workflow run release.yml --ref main -f publish=true -f tag=vX.Y.Z
```

The explicit tag must match `package.json`. Manual publication is restricted to `main`; omitting `publish=true` always performs a dry run. Preflight and the platform builds run in parallel. Once every gate and the combined artifact verification pass, the workflow creates an annotated tag at the exact commit it built and publishes those same artifacts. There is no second build after verification. An existing tag must resolve to that commit; it is never moved. The repository's `GITHUB_TOKEN` creates the tag, so its push does not trigger a duplicate workflow.

Tag-triggered publication is also supported:

```sh
git tag -a vX.Y.Z -m "GenieTerm X.Y.Z"
git push origin vX.Y.Z
```

Both publication paths run `.github/workflows/release.yml`:

- **Preflight.** Checks that the tag matches `package.json` and runs the merge gate.
- **macOS.** Builds arm64 and x64 on a native runner. It verifies the bundle identity, the helpers, `codesign --verify --deep --strict` and the update manifests, launch-tests arm64, and fails if packaging modified the checkout.
- **Linux.** Builds natively on `ubuntu-22.04` (x64) and `ubuntu-22.04-arm` (arm64). `wavesrv` is built with Zig 0.13 against glibc 2.28. Each job then:
  - verifies the AppImage and deb with `scripts/verify-linux-package.mjs`;
  - launch-tests the AppImage under Xvfb.

  A separate job installs the x64 `.deb` on `ubuntu-24.04` and checks the PATH link, the desktop entry and the AppArmor profile. It then launches the app with Chromium's sandbox required, uninstalls it, and checks the cleanup.

- **Windows.** Runs for stable tags, prerelease tags and manual runs. It verifies the x64 package, bundled helpers and update metadata, runs a PowerShell command in the packaged app, and installs, launches and uninstalls the NSIS package. If signing credentials are configured, all required executable signatures must verify.
- **Publish.** Runs only if preflight and every build and installation check passed. `scripts/verify-release-assets.mjs` checks the exact asset set and every manifest. For manual publication, the tag is created only after these checks. The job creates a draft, compares the uploaded assets with the verified artifacts (name, size, SHA-256), and only then publishes. It never overwrites a published release. Runs for the same release are serialized so another dispatch cannot cancel publication midway.

If publishing fails after the draft exists, fix the cause and re-run the workflow, which reuses the draft. Delete the draft if its assets should be discarded.

## After publishing

Check the published files themselves:

- Confirm `latest-mac.yml`, both Linux manifests and Windows `latest.yml` on `releases/latest/download/` report the new version. Windows `beta.yml` and `alpha.yml` must point to the same stable installer.
- Download the macOS zip and match its SHA-512 to `latest-mac.yml`. Run `node scripts/verify-installed-app.mjs --window-smoke <path/to/GenieTerm.app>`.
- Run the Linux AppImage once from a fresh profile.

## How updates reach users

All builds read the generic feed `https://github.com/Ry3nG/GenieTerm/releases/latest/download/`, which always serves the latest stable release. Prereleases are never offered through the feed.

- **macOS.** Without a Developer ID, Squirrel.Mac can't install updates, so GenieTerm installs them itself:
  1. It downloads the zip in the background.
  2. On **Restart Now**, a helper re-checks the zip's SHA-512, bundle identity, version and signature.
  3. It waits for GenieTerm and `wavesrv` to exit, swaps the bundle and relaunches.

  If anything fails, the original app comes back; the log is `~/Library/Logs/GenieTerm/updater-helper.log`. A copy running from a read-only location (a mounted dmg, App Translocation) gets the release page instead.

- **Linux AppImage.** Updates itself through `latest-linux.yml` or `latest-linux-arm64.yml`, as long as the file and its folder are writable.
- **Linux deb.** The package manager owns the install, so GenieTerm only reads the manifest's version and shows **Update Available**, pointing to the new `.deb`. There is no apt repository.
- **Windows NSIS.** Uses `latest.yml` to download the installer and offers Restart Now; install-on-quit follows the user's setting. The stable feed also publishes `beta.yml` and `alpha.yml` so earlier preview installs can receive stable releases. Prereleases and unpacked `.zip` copies can be installed manually from GitHub Releases.

## Signing

- **macOS.** The app is ad-hoc signed (`mac.identity: "-"`), and Gatekeeper asks users to approve the first launch. To notarize, you need an Apple Developer Program membership and a Developer ID Application certificate. Provide `CSC_LINK`/`CSC_KEY_PASSWORD` plus notarization credentials to electron-builder. The config switches to Developer ID signing when `CSC_LINK` or `CSC_NAME` is set.
- **Windows.** Code signing is optional for publication. Without credentials, the workflow builds an unsigned installer and reports its signature status. To sign releases, configure both `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` secrets. Partial credentials fail the build. With both configured, stable, prerelease and manual builds use `forceCodeSigning` and require valid signatures; signing failures never fall back to unsigned packages.

  Test the NSIS install and uninstall, a PowerShell terminal, SSH and files, and an update from the previous release on a clean Windows machine. `node scripts/verify-windows-package.mjs make --window-smoke --installer-smoke` uses temporary app data and an installation directory, but NSIS still writes the production app's registration. It refuses to run the installer test if GenieTerm is already installed or running; use a clean account or VM. `--window-smoke` alone does not install the app. The unpacked and fresh-install window checks use Unicode data and config paths longer than 400 characters, run PowerShell and the bundled CLI, and verify the saved setting reaches the terminal.

  Add `--upgrade-from=C:\path\to\previous-installer.exe` to exercise a real NSIS upgrade. The verifier installs the older version, saves a named workspace through the UI and settings through its bundled CLI, installs the candidate into the same directory, and checks the restored workspace and rendered settings before uninstalling. The installation and profile paths include spaces and Unicode. This checks installer migration and data preservation; it does not simulate an update-feed download.

Keep signing material out of the repository.

## Quality gates

| Command                    | What it checks                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task check`               | TypeScript, ESLint, Prettier, Vitest, Go tests, `govulncheck`, `npm audit`, font assets, production build, preview build, visual QA and interaction QA                                                                                                                        |
| `task check:release`       | `task check`, then an arm64 package, `task package:verify`, and a launch of the packaged window                                                                                                                                                                               |
| `task visual:preview`      | Screenshots every preview (`artifacts/visual-qa/`) at desktop, narrow and compact widths. Fails on missing text, React error boundaries, console errors, horizontal overflow or blank renders                                                                                 |
| `task interaction:preview` | Clicks through key flows in the preview server: the command palette, transfers, Host (folding listeners, forwarding a port, form validation) and file drops                                                                                                                   |
| `task package:verify`      | Package identity and version, bundled `wavesrv`/`genie`/`wsh` helpers with no stale versions, code signature (macOS), and the update manifests. On Linux, it also checks AppImage extraction, ELF architecture, deb control fields, dependencies, the desktop entry and icons |
| `task installed:verify`    | An installed app's identity and helpers. With `--window-smoke`, it launches the app in an isolated profile and checks the window title, rendering and errors                                                                                                                  |

Port forwarding runs against mocked RPCs in the preview. The real thing is covered by the Go integration tests in `pkg/remote/portforward`, which run a real SSH client against an in-process SSH server.
