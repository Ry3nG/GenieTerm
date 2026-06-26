# Installed App Gate

Date: 2026-06-27

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

## Verified Evidence

- The installed app bundle exists.
- `Info.plist` has the expected bundle name, display name, executable name, bundle identifier, short version, and bundle version.
- The app bundle contains the main executable and Electron `app.asar`.
- The app bundle contains unpacked `wavesrv`, `genie-<version>-...`, and `wsh-<version>-...` helper binaries.
- Stale `genie-*` or `wsh-*` helper binaries from older versions fail the gate.
- `codesign --verify --deep --strict` passes.
- With `--launch-smoke`, the app launches with an isolated user-data directory and a running process is observed.
- With `--window-smoke`, Playwright launches the packaged Electron executable, verifies the window title and packaged URL, rejects React error boundaries and console errors, and checks that the rendered screenshot is nonblank.

## Current Local Evidence

On 2026-06-27, `/Applications/GenieTerm.app` was still `0.4.50` while the repo package version was newer. The gate intentionally fails that state until the current packaged app is installed.
