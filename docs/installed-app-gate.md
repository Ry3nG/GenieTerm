# Installed App Gate

This page covers macOS. The Windows x64 packaged-app and installer workflow criteria are in [`windows-release-gate.md`](windows-release-gate.md).

Run:

```sh
task installed:verify
```

By default this verifies `/Applications/GenieTerm.app`. To verify another app bundle:

```sh
task installed:verify -- /path/to/GenieTerm.app
```

For final release smoke, include a launch check:

```sh
task installed:verify -- --launch-smoke
```

For the stronger packaged-window smoke used by the release gate:

```sh
task installed:verify -- --window-smoke
```

## Checks

- The installed app bundle exists.
- `Info.plist` has the expected bundle name, display name, executable name, bundle identifier, short version, and bundle version.
- The app bundle contains the main executable and Electron `app.asar`.
- The app bundle contains unpacked `wavesrv`, `genie-<version>-...`, and `wsh-<version>-...` helper binaries.
- Stale `genie-*` or `wsh-*` helper binaries from older versions fail the gate.
- `codesign --verify --deep --strict` passes (release builds are ad-hoc signed unless a Developer ID is configured).
- With `--launch-smoke`, the app launches with an isolated user-data directory and a running process is observed.
- With `--window-smoke`, Playwright launches the packaged Electron executable, verifies the window title and packaged URL, rejects React error boundaries and console errors, and checks that the rendered screenshot is nonblank.

## Verifying a published release

The gate fails until the installed app matches the repo's `package.json` version, so install the release under test first:

1. Download `GenieTerm-darwin-<arch>-<version>.dmg` (or the zip) from the GitHub Release and copy `GenieTerm.app` to `/Applications`. Do not run it from the mounted dmg; App Translocation makes it read-only and the updater cannot replace it.
2. The app is ad-hoc signed and not notarized, so the first launch is blocked by Gatekeeper. Open it once, then use **System Settings → Privacy & Security → Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/GenieTerm.app`.
3. Run `task installed:verify -- --window-smoke` from a checkout of the release tag.
4. Install the previous stable release, update through **Check for Updates → Restart Now**, and confirm the relaunched app reports the new version. On failure, the helper log is `updater-helper.log` in GenieTerm's logs folder.

Record the version, architecture, and results with the release.
