<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# GenieTerm on Windows

Windows x64 packages are available from [GitHub Releases](https://github.com/Ry3nG/GenieTerm/releases/latest). Choose the `.exe` installer for a normal per-user installation or the `.zip` for an unpacked copy. No Microsoft Store account is needed.

## Install and update

The installer is unsigned. Windows may show an unknown-publisher or SmartScreen warning. Download packages from the GenieTerm repository, and check the release's asset details when verifying a download.

Run the installer in your normal Windows account. To update an earlier Windows preview, install the current EXE over it. Keep the same account so GenieTerm can restore your saved settings and workspaces.

Installed copies check the stable GitHub update feed. You can also download and install a newer EXE manually. For an unpacked ZIP, close GenieTerm before replacing its application files.

## Terminal and remote work

GenieTerm supports Windows PowerShell and PowerShell 7. Command blocks require PSReadLine; the terminal's integration status explains when it is unavailable. Paths dropped into a PowerShell terminal are quoted for PowerShell, including spaces, apostrophes and Unicode characters.

Connect to a supported Linux or macOS SSH host to use the remote helper, durable sessions, remote files and Host tools. Local Windows shells are not remote durable sessions. Windows remote-host job-manager support is not included.

Remote-folder downloads use `scp.exe` from Windows OpenSSH Client. If it is unavailable, install the OpenSSH Client optional Windows feature and retry the transfer.

## Report a problem

Include the GenieTerm version, Windows version, shell version, the action that failed, and whether it happens in a new workspace. Remove credentials and private host details before attaching logs or screenshots to a [GitHub issue](https://github.com/Ry3nG/GenieTerm/issues).

See [Contributing](../CONTRIBUTING.md) for native development and package verification, and [Releasing](releasing.md) for publication checks.
