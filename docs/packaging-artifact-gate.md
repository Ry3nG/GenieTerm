# Packaging Artifact Gate

Date: 2026-06-27

Run after packaging:

```sh
task package:verify -- /path/to/package-output
```

The v1 release package gate runs this automatically after the macOS arm64 zip package step:

```sh
task v1:gate:package
```

## Verified Evidence

- A `GenieTerm.app` bundle exists in the package output directory.
- A zip artifact for the current package version exists in the package output directory.
- `Info.plist` has the expected bundle name, display name, executable name, bundle identifier, short version, and bundle version.
- The app bundle contains the main executable and Electron `app.asar`.
- The app bundle contains unpacked `wavesrv`, `genie-<version>-...`, and `wsh-<version>-...` helper binaries.
- Stale `genie-*` or `wsh-*` helper binaries from older versions fail the gate.
- `codesign --verify --deep --strict` passes for the packaged app bundle.

## Scope

This verifies the package artifact before install. It does not replace the installed-app gate, which still verifies `/Applications/GenieTerm.app` and must be extended with launch and workflow smoke tests before v1.0.0.
