<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Windows x64 Release Gate

**Status:** Windows x64 is deferred from the stable channel until a code-signing certificate exists. Stable tags (`vX.Y.Z`) publish macOS only; Windows ships as an **unsigned preview** on prerelease tags (`vX.Y.Z-beta.N`). The preview is installed manually: the update feed only serves the latest stable release, which has no Windows metadata, and a failed Windows preview build blocks only that prerelease, never a stable release.

The Windows package is ready for a public stable release when every check below has saved evidence. Run the build and package smoke on a native Windows runner. Repeat the installer and user workflow checks on a clean Windows 11 x64 desktop.

## Package and update files

- The Windows x64 CI job builds the current version's NSIS installer and ZIP. The package verifier checks an isolated NSIS install, packaged-app launch, and uninstall.
- The unpacked app contains `GenieTerm.exe`, `app.asar`, `wavesrv.x64.exe`, and the matching version's Windows x64 `genie` and `wsh` helpers.
- The Windows update manifest (`latest.yml` for stable, `beta.yml` for a beta preview) names the published Windows x64 update package with matching size and SHA-512; every referenced asset is present in the GitHub Release and downloads successfully.
- The published installer and executables have a verifiable signature from the intended publisher. Unsigned artifacts can be used for internal testing but do not satisfy this public-release gate.

## Enabling Windows on stable

Shipping Windows on a stable tag needs a code-signing certificate from a CA that Windows trusts. Then:

1. Provide signing to electron-builder. With an exportable certificate (`.pfx`), add the `WIN_CSC_LINK` (base64 or URL of the `.pfx`) and `WIN_CSC_KEY_PASSWORD` repository secrets; electron-builder reads them directly. Cloud or HSM-backed certificates cannot be exported as a `.pfx`. For **Azure Trusted Signing**, set `win.azureSignOptions` (`publisherName`, `endpoint`, `certificateProfileName`, `codeSigningAccountName`) in `electron-builder.config.cjs` and pass the Microsoft Entra credentials (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) as secrets to the "Build signed Windows x64 release" step, replacing the `WIN_CSC_*` check. Other HSM providers need a custom `win.signtoolOptions.sign` hook that calls the provider's signing tool.
2. Set the repository variable `GENIETERM_WINDOWS_STABLE=signed`. The release workflow then builds Windows on stable tags with `GENIETERM_REQUIRE_WINDOWS_SIGNATURE=1` (electron-builder `forceCodeSigning`) and runs `scripts/verify-windows-package.mjs make --require-signature`; missing secrets fail the release instead of shipping unsigned binaries.
3. Pass every check in this document.

Keep signing material out of the repository and chat.

## Installed app

- Install the NSIS package as a normal user, launch GenieTerm from the installed location, then uninstall it. Record the installed version and publisher shown by Windows.
- First launch opens a usable local PowerShell terminal. Run a successful and a failing command; verify command status, output, copy, re-run, and restart.
- Connect to an SSH host, run a command, restart the terminal, and verify new output appears immediately. Test disconnect/reconnect and a durable session across an app restart.
- Browse and edit remote files; upload and download a file and a folder; verify transfer errors and retry on a failed transfer.
- Confirm `scp.exe` is available from the Windows OpenSSH Client, and that a missing client gives an actionable folder-download error.
- Install the previous stable version and update through GenieTerm to the candidate version. Verify the relaunched version, retained settings/workspaces, and a working terminal.

## Release decision

Adding Windows to a stable tag needs `GENIETERM_WINDOWS_STABLE=signed`, a clean worktree, matching package version, green macOS and Windows gates, independent review of the release diff, and a documented disposition for every failed check. After publication, read back the tag, workflow result, public Release, installer, ZIP, channel-matched update manifest, and the installed app version independently.
