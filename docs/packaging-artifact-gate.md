# Packaging Artifact Gate

Run after packaging:

```sh
task package:verify -- /path/to/package-output
```

Require specific architectures (the release workflow uses both):

```sh
task package:verify -- make --require-arch arm64,x64
```

The v1 release package gate runs this automatically after the macOS arm64 zip package step:

```sh
task v1:gate:package
```

## Checks

- A `GenieTerm.app` bundle exists in the package output directory.
- A zip artifact for the current package version exists in the package output directory.
- `Info.plist` has the expected bundle name, display name, executable name, bundle identifier, short version, and bundle version.
- The app bundle contains the main executable and Electron `app.asar`.
- The app bundle contains unpacked `wavesrv`, `genie-<version>-...`, and `wsh-<version>-...` helper binaries.
- Stale `genie-*` or `wsh-*` helper binaries from older versions fail the gate.
- `codesign --verify --deep --strict` passes for every packaged app bundle. Without an Apple Developer ID (`CSC_LINK` / `CSC_NAME`), `electron-builder.config.cjs` ad-hoc signs the whole bundle (`mac.identity: "-"`), which satisfies this check; the signature kind (ad-hoc or the Developer ID authority) is logged. An unsigned or partially signed bundle fails — there is no override.
- Every update manifest for the version's channels (`latest-mac.yml`, `beta-mac.yml`, `alpha-mac.yml` for stable; `beta-mac.yml`, `alpha-mac.yml` for a beta) has the package version, lists only zips, lists every `GenieTerm-darwin-*-<version>.zip` in the output (and each `--require-arch`), and each entry's size and sha512 match the file. All channel manifests list the same files. The same check runs standalone with `node scripts/verify-update-metadata.mjs <dir> [--mac] [--windows] [--require-arch arm64,x64]`.

## Scope

This verifies the package artifact before install. The installed-app gate (`docs/installed-app-gate.md`) verifies an installed bundle and launch smoke; the release workflow runs its `--window-smoke` against the built arm64 app.

For Windows x64, the native Windows CI job runs `scripts/verify-windows-package.mjs` against the package output, including a packaged-window smoke. Windows is an unsigned preview on prerelease tags; `docs/windows-release-gate.md` lists what it needs before it can ship on stable.
