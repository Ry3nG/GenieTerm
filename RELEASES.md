# Releasing GenieTerm

GenieTerm publishes from **this** repository: [Ry3nG/GenieTerm](https://github.com/Ry3nG/GenieTerm). Ignore leftover Wave S3 / Homebrew / WinGet / Chocolatey / Snap instructions — this fork does not operate those channels.

## Current process

1. Land the work on `main`. `package.json` `version` is the single source (`version.cjs` → Taskfile ldflags → Go `WaveVersion`).
2. Confirm `task v1:gate` is green locally or in CI (`.github/workflows/ci.yml`).
3. Tag the same version:

   ```sh
   git tag v0.4.80
   git push origin v0.4.80
   ```

4. Pushing `v*` runs `.github/workflows/release.yml`:
   - Ubuntu preflight: audit, `tsc`, lint, format, Vitest, `go test`, production + preview builds, preview QA
   - macOS `task package`
   - GitHub Release upload when the tag matches `package.json`
5. Code signing and notarization are optional. They run only when the matching repo secrets are present; otherwise the pipeline produces unsigned builds.
6. Smoke the attached macOS artifact with `docs/installed-app-gate.md` before telling anyone to install it.

`workflow_dispatch` on the Release workflow can dry-build without publishing.

## Local package (no tag)

```sh
GENIETERM_BUILD_OUTPUT=/private/tmp/genieterm-make task package
rm -rf /Applications/GenieTerm.app
ditto --norsrc /private/tmp/genieterm-make/mac-arm64/GenieTerm.app /Applications/GenieTerm.app
```

Packaging from a File Provider-managed folder will break signing; keep `GENIETERM_BUILD_OUTPUT` on a real disk.

## Auto-update

Packaged builds use `electron-updater` against this repo's GitHub Releases. `autoupdate:enabled` is on by default. There is no Wave S3 feed and no Homebrew cask for GenieTerm.

## What this fork does not do

- Wave "Bump Version" / "Build Helper" workflows
- Upload to `s3://waveterm-github-artifacts`
- Publish to Homebrew, WinGet, Chocolatey, or Snap
