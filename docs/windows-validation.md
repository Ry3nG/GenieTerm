<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Windows validation record

This record distinguishes observed behavior from intended support. It does not claim complete parity with a physical Mac. Supported-platform notes are in [Windows](windows.md); publication requirements are in [Releasing](releasing.md).

## Release and test provenance

Checkpoint: **2026-10-27**. [Public stable release 1.5.1](https://github.com/Ry3nG/GenieTerm/releases/tag/v1.5.1), release ID `425046099`, was published at `2026-10-27T04:51:35Z` from tag `v1.5.1`, source **`367a6b38b289009b2a37ceefc31cc57cee3fb9ad`**. Unauthenticated Windows downloads matched GitHub's asset sizes and SHA-256 digests; `latest.yml`, `beta.yml` and `alpha.yml` passed version, filename, size and SHA-512 checks. The published installer passed fresh install, onboarding, PowerShell/CLI and uninstall checks. The public app checked the latest feed and reported up-to-date without updater errors. The deployed site's download checks also passed.

Public Windows artifact identities:

| Artifact          |     Bytes | SHA-256                                                            |
| ----------------- | --------: | ------------------------------------------------------------------ |
| Windows installer | 183884129 | `58b1b8010cc4f8cf85f207020d5a89e962e89d873db20f462df58c67b589f51a` |
| Windows ZIP       | 236914888 | `90daaf5af7c3bb0e38110592ae9453fea4309f21bb399e0d56bb410bf8eff092` |

The verified installer was copied to `%USERPROFILE%\Downloads\GenieTerm-win32-x64-1.5.1.exe` with the same size and SHA-256 and was marked Internet Zone 3. It is unsigned. The public macOS and Linux latest manifests passed version, architecture, asset-size and manifest-digest checks; all four referenced payload URLs returned HTTP 200 with matching sizes. Those large payloads were not downloaded or hashed locally, and this HTTP check did not launch their apps.

The [live download site](https://ry3ng.github.io/GenieTerm/) passed after deployment [40452318474](https://github.com/Ry3nG/GenieTerm/actions/runs/40452318474) at site-only commit `6cee0546225258b023fff359387018dd2b5ae31e`. All eight download links targeted 1.5.1 and returned HTTP 200 with expected sizes. An isolated Edge browser verified four widths (320–1440 pixels) and desktop/compact no-JavaScript views without horizontal overflow, page errors or asset errors. Desktop and compact no-JavaScript screenshots were also visually inspected. Evidence: `artifacts/site-qa/live-1.5.1/verification.json` and adjacent logs/screenshots.

The release source differs from local candidate 6, **`a899206f6c43a4ddf865ecbc96cabcd8bea52359`**, only in this validation document. Packaging/static checks, both final PowerShell profiles and the official 1.5.0-installer upgrade passed on candidate 6. It changes only the PowerShell completion budget and its regressions relative to candidate 5 (`1c30d8a46ea6f5cd579cd2dfe81505e58d260433`). Remote, editor and native results retain their actual candidate-5 source attribution. The test machine runs Windows 11 Pro 25H2, Windows PowerShell 5.1.26100.9711, and PowerShell 7.6.5.

- **Desktop** means native windows and controls operated through Computer Use. Shell commands were not entered through Computer Use.
- **Packaged E2E** means real Electron, backend and shell/helper processes controlled through Playwright/CDP. Actual RPC transfers are distinguished from OS dialogs and drag/drop.
- **Native tests** exercise real Windows processes, files or sockets where stated. Mock/preview checks and skipped tests do not establish native behavior.

Local candidate-6 build identities, distinct from the public artifacts above:

| Artifact          |     Bytes | SHA-256                                                            |
| ----------------- | --------: | ------------------------------------------------------------------ |
| Windows installer | 183896446 | `efcd7b8ed7fb5649ddfc2e12f41ae5950bc88ce3768ac0862f5bd7ed8bbe3cbd` |
| Windows ZIP       | 236918068 | `9aa091d6e34a8c1c84a006dc40abbb35b8dc3d76858d693c97bf36d47707eb61` |

The candidate-6 renderer `app.asar` SHA-256 is `12751e7f7637cbe985c7b13aaab037dd85ea431095cecaccce3658c358a019a7`.

Candidate-5 identities retained for its executed remote/editor/native checks:

| Artifact                 |     Bytes | SHA-256                                                            |
| ------------------------ | --------: | ------------------------------------------------------------------ |
| Windows installer        | 183893247 | `24001e18465a56a72fafc245e2457f5dca0f8aa14577100c4118999496a60bf5` |
| Windows ZIP              | 236918473 | `981e3931b0441643289dfa4a5d1817f44d7280e32744afc8905f0267aaa1831c` |
| Packaged `app.asar`      |         — | `dfc5f4f6ebd50fcf8f7dfb2d2570d649395883a34828eecf52b2ac305dfbffef` |
| Bundled Linux x64 helper |         — | `da9d55e55c880e6df7949889bafea1658bb81442ccbe4de3b6556a69a6374bcd` |

Raw logs, screenshots, profiles and hashes remain in ignored `artifacts/windows-parity/`, `artifacts/windows-release/`, and `artifacts/published-windows-1.5.0/` / `published-windows-1.5.1/`. They are not shipped. Public verification is recorded in `published-windows-1.5.1/verified-public-assets.json`, `windows-parity/public-other-platforms.json`, `windows-parity/public-1.5.1-user-download.json`, `windows-parity/public-1.5.1-installer.log` and `windows-parity/public-1.5.1-update-app.log`. The candidate-6 installer evidence is `windows-parity/candidate-6-upgrade.log`. The main candidate-5 remote report is `windows-parity/remote-e2e/candidate5-legacy-upgrade-1793072473700-5dbaf5ae/report.json` beneath `artifacts/`.

## Results and limits

| Area                            | Observed result                                                                                                                                                                                                                     | Boundary or pending check                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public download and update feed | **Public 1.5.1 passed:** Windows EXE/ZIP GitHub digests, three channel SHA-512 checks, matching Downloads copy, live-site links and actual app latest-feed check showing up-to-date without updater errors.                         | Installer is unsigned; download-and-restart updating was not exercised.                                                                                                                      |
| Installer and upgrade           | **Public 1.5.1 fresh install/onboarding/uninstall passed;** independent clean-state and zero app/backend process checks passed. Candidate 6's real upgrade from official 1.5.0 preserved the saved workspace and rendered settings. | Candidate upgrade and public fresh-install evidence refer to different package hashes.                                                                                                       |
| Long data/config homes          | **Public 1.5.1 installed app passed** PowerShell and authenticated CLI with Unicode data/config paths of 501/503 characters. Candidate 6 unpacked paths were 513/515 characters.                                                    | Helpers deliberately use a bounded cache path; arbitrary executable path length is not promised.                                                                                             |
| Workspaces and settings         | Native candidate 5 restored the 1.5.0-derived three-panel layout and font size 18. Earlier desktop checks created/switched a Unicode workspace.                                                                                     | Multi-display/DPI and sleep/resume untested.                                                                                                                                                 |
| PowerShell and command blocks   | **Candidate 6 passed:** PS5.1 8/8 and PS7 9/9 packaged checks, including command/parameter/special-file completion and live Ctrl+V settings. Cold Get-Ch took 1,438/1,082 ms without warmup.                                        | Final completion acceptance explicitly used ArrowDown/ArrowUp then Tab. Earlier fast-hover/automatic-popup timing is not established; broad interactive programs/all shells remain untested. |
| Local Files and previews        | Native text/Markdown/CSV/PNG/default-app checks passed. Candidate 5 packaged TXT/JSON/YAML edit, diagnostics, save and disposal passed without renderer errors.                                                                     | Native drag/drop, broad conflicts and recursive transfers untested.                                                                                                                          |
| File safety                     | Native tests cover case/junction self-copy, hard links, DACL preservation, named streams and replacement recovery.                                                                                                                  | No SMB, alternate-volume or physical failure test.                                                                                                                                           |
| Windows keyboard and Host UI    | **Native candidate 5 passed.** User/account data showed in normal and magnified Host; PID filtering returned one owned row; terminal-focused Alt+F4 closed the app normally.                                                        | Other shortcut conflicts and unsupported POSIX process controls remain separate cases.                                                                                                       |
| SSH and Linux helper            | **Candidate 5 passed.** Real SSH used only a dedicated key and pinned host key; installed helper matched the exact packaged hash.                                                                                                   | Agent/password/ProxyJump and first-use trust flows untested.                                                                                                                                 |
| Old remote-manager upgrade      | **Candidate 5 passed.** A real 1.5.0 manager retained its job ID, PID, start time, binary hash and shell environment after the new client/helper started.                                                                           | Normal client exit was tested; arbitrary crash-time output persistence is not claimed.                                                                                                       |
| Durable disconnect/replay       | **Candidate 5 passed.** Output continued during disconnect; the same job replayed all 30 numbered lines exactly once, matching guest disk.                                                                                          | Prolonged outages and macOS remote hosts untested.                                                                                                                                           |
| Remote Files                    | **Candidate 5 passed.** Unicode upload/download hashes matched; Monaco editing saved exact bytes to Linux disk.                                                                                                                     | RPC/keyboard coverage does not establish OS file-dialog or drag/drop behavior.                                                                                                               |
| Remote Host and forwarding      | **Candidate 5 passed.** Real process/port data, UI-created SSH HTTP forward, exact response marker, UI stop and closed endpoint verified.                                                                                           | Remote GPU and unrelated process controls untested.                                                                                                                                          |
| Renderer and cleanup            | **Candidate 5 passed all nine remote checks with zero uncaught exceptions.** Candidate logs had no warnings/errors; no backend panic or cleanup errors; owned app/backend processes exited.                                         | A handled console error from the official 1.5.0 seed phase remains separately attributed in the report.                                                                                      |
| Command AI                      | **Candidate 6 passed in both PowerShell versions:** Insert/Run into empty and Unicode prompts, actual pending HTTP cancellation, and continuous completion after insertion. Both profiles had zero page/console errors.             | Only a local HTTP fixture was used; authenticated external providers/CLIs remain unverified.                                                                                                 |
| Badge, notifications and web    | A real owned Windows process produced a linked badge that cleared on exit. Native menus/default-app opening were exercised.                                                                                                         | OS notification delivery, broad webview navigation and browser handoff remain untested.                                                                                                      |

## Automated gates

The candidate-6 frontend gate passed **98 files / 1,173 tests**, with **16 skipped**, plus TypeScript and lint checks. Candidate 5 previously passed 1,166 tests; neither count includes the skipped cases. Five real Monaco worker checks passed with no errors or warnings. Native Windows Go tests and `go vet` passed across 40 tested packages for the included backend changes. The real SQLite lifecycle test requires CGO; Windows CI installs pinned Zig and explicitly enables it. A no-CGO run does not prove that coverage.

`govulncheck` found no reachable vulnerability and one finding in a required module whose affected code is not called. This is a dated scanner result, not a guarantee about undiscovered defects. Main CI [40448982450](https://github.com/Ry3nG/GenieTerm/actions/runs/40448982450) passed at release source `367a6b38`, including the V1 gate, Windows tests with CGO, Windows package/window smoke, macOS arm64 package/window smoke, Linux packaging and Ubuntu 24.04 installation. Tagged-release workflow [40450228749](https://github.com/Ry3nG/GenieTerm/actions/runs/40450228749) also succeeded at that revision. CI window smoke is separate from physical-desktop feature validation.

## Isolated remote test

The endpoint is an Ubuntu 24.04 x86_64 VM under portable QEMU TCG (two CPUs, 2 GiB RAM). Only `127.0.0.1:2222` exposes SSH. Restricted user networking, an isolated account/key/config and independently pinned host key keep the test separate from existing user connections. The app uses its own data/config and an empty child `USERPROFILE`, preventing default discovery of the user's existing SSH identities. No user SSH config, agent or host security setting was changed.

The upgrade starts official 1.5.0, executes a shell environment marker, and closes its window normally. The backend PID exits and a read-only SQLite query verifies persisted terminal output. Candidate 5 then reconnects to the same old manager and executes a new command reading that environment marker. The old manager's executable stays unchanged while the installed helper must equal the new package's Linux helper SHA-256. Cleanup targets only recorded test jobs, forwards and processes. The VM was shut down at `2026-10-27T03:59:01Z`; an independent check confirmed QEMU PID 28088 absent and no listener on port 2222. No host installation was registered. Disks and evidence were retained in `windows-parity/vm/`; `cleanup.json` records the result.

## Preserved failures and fixes

- The public 1.5.0 remote baseline exposed Windows `file:///C:/` being reinterpreted on Linux and a last-block deletion panic. Native RPC/SQLite regressions and the candidate-5 real transfer/cleanup checks pass. Original report: `remote-e2e/baseline-1.5.0-1793066054341-f5202c0e/`.
- Candidate 3 exposed failure to reattach a durable terminal when a slow background helper install changed readiness without changing SSH connectivity. Candidate 5 proves the actual old-manager upgrade. Failed report: `remote-e2e/candidate3-legacy-upgrade-1793069215611-6ac2a146/`.
- Candidate 4 completed the remote functions but failed its strict renderer gate on an unhandled disconnect resize and a Monaco/YAML worker bridge error. Candidate 5 repeats those paths with zero uncaught exceptions. Failed report: `remote-e2e/candidate4-legacy-upgrade-1793070660796-4ebfff2d/`.
- Native and packaged tests also found Windows quoting/completion, AI prompt clearing/focus, User-column visibility and Alt+F4 defects. The two native fixes passed on candidate 5. Its later PS5.1 cold completion failure is preserved at `frontend-e2e/1793073218372-c7944478/`; candidate 6 addresses that budget without changing remote/backend/editor behavior. Earlier failures remain in `native-cases.json`, `candidate-4-native-cases.json` and `frontend-e2e/`; final PS5.1/PS7 reports are `frontend-e2e/1793073855117-b9391e95/` and `frontend-e2e/1793073884022-7a4e9c98/`.

Harness failures remain separate from product defects: missing isolated home directories, empty connection status, hidden-window close detection, unavailable post-exit logging, and waiting for a forward to become active before sending traffic. None is counted as a passing test. The first candidate-6 fast-hover/Tab attempt is retained at `frontend-e2e/1793073713767-60408d6e/`; its exact earlier selection state was not captured, and no general automatic-popup timing fix is claimed. A separate rapid scripted caret/dispose Monaco stress case is retained under `artifacts/monaco-workers/1793071944275/`; normal settled editor disposal passed, and no general stress-path fix is claimed.

## Platform and resource limits

No physical macOS desktop, Windows 10/ARM64 machine, or WSL installation was tested. A Linux VM and macOS package CI do not establish physical-Mac feature parity or WSL integration. Windows local/WSL shells are not remote durable jobs; remote job-manager hosting on Windows is unsupported. Windows process status and termination do not have every POSIX signal semantic. Completion providers use a fresh NoProfile shell and cannot discover aliases/functions defined only in the interactive session.

Additional resources are needed for authenticated AI providers, SSH agent/password/proxy chains, SMB, multiple displays, other GPU vendors and OS notification behavior. Hostless file-copy URIs preserve origin-OS path meaning across helpers; hosted `file://server/share` remains outside that fix, so no new UNC/SMB support is claimed.

## Repeatable checks

Use [Contributing](../CONTRIBUTING.md), run from the repository root, and keep package smoke isolated from an existing per-user installation:

```powershell
npm test -- --run
go test ./... -count=1 -timeout 5m
go vet ./...
node scripts/verify-windows-package.mjs make --window-smoke --installer-smoke
node scripts/verify-windows-package.mjs make --upgrade-from=<older-installer-path>
```

Record exact candidate identities, preserve failures, and repeat public download/feed verification after publication.
