# GenieTerm v1.0.0 Release Gate

Acceptance contract for tagging `1.0.0`. A feature is not release-ready because it exists; it is release-ready when it passes the gates below **and** belongs in the 1.0 product.

## Product bar

1.0 is **terminal + durable remote + files + host**. Web, Settings chrome, and the command palette may ship with the app; they do **not** block 1.0 unless they break the core flows.

- Every visible 1.0 surface must feel intentional: stable layout, useful empty/error/loading states, no clipped text.
- Every command that mutates local or remote state must confirm destructive actions and report structured errors.
- Every 1.0 feature must work in the installed app, not only in `task dev`.
- Incomplete platform leftovers (Tsunami, WaveAI chat, VDom apps) stay hidden or out of the default package.

## 1.0 feature matrix

| Area            | 1.0 capability                                                                                         | Acceptance bar                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Terminal        | semantic command blocks, classic compatibility, status, duration, copy, re-run, jump, jump-past-output | commands render as stable blocks; failed commands are distinct; actions do not corrupt input; missing shell integration is explicit |
| Remote sessions | local + SSH sessions reconnect; durable mode is discoverable                                           | closing the laptop or the app does not silently kill a durable remote session                                                       |
| Files           | local/remote browse, preview, edit, upload/download, transfer queue with cancel/retry                  | paths present as `genie://`; folder download never uses the file stream path; failures are retryable                                |
| Host            | overview with GPUs, processes, listening ports, SSH port forwarding, long-command notifications        | samples only while visible; forwards listen on 127.0.0.1 only and survive reconnects; works for this Mac and SSH hosts              |

Out of the 1.0 contract (may exist, must not regress the rows above):

- Webview
- App builder / Tsunami
- Command composer / inline AI (allowed, not required to tag 1.0)

## Automated gate

Before merging release-bound work:

```sh
task v1:gate
```

Before tagging, on a Mac:

```sh
task v1:gate:package
```

`scripts/v1-gate.mjs` is the single source of the check list: CI (`ci.yml` → `V1 gate`) and the release preflight (`release.yml`) both run `node scripts/v1-gate.mjs`, so they cannot drift. The gate must pass:

- TypeScript typecheck, ESLint, format check, Vitest, Go tests, `govulncheck`, runtime `npm audit`
- All local font references in the shipped Font Awesome CSS resolve to packaged source assets
- Production frontend/electron build
- Preview build + visual QA + interaction QA
- With `--package --installed` (macOS): an arm64 package, `task package:verify` (bundle identity, helpers, `codesign --verify --deep --strict`, update metadata against the zip), and a packaged-window smoke

The release workflow additionally builds macOS arm64 + x64 on a native runner, verifies both zips against `latest-mac.yml` / `beta-mac.yml` / `alpha-mac.yml`, launch-smokes the arm64 app, and fails if packaging changed the checkout. Pushes to `main` run the same arm64 packaging + smoke in CI.

Stable releases are **macOS-only**. Windows x64 is explicitly deferred from stable until a code-signing certificate exists; it ships as an **unsigned preview** on prerelease tags (`vX.Y.Z-beta.N`) and never blocks or touches the stable channel. Linux is not shipped.

Details: `docs/visual-qa/preview-screenshot-gate.md`, `docs/visual-qa/preview-interaction-gate.md`, `docs/packaging-artifact-gate.md`, `docs/installed-app-gate.md`, `RELEASES.md`.

## Interaction gate (installed app)

- Install and launch the macOS package from `/Applications`, then restore a workspace.
- Run a command and inspect block status, copy, and re-run.
- Open a durable SSH session, disconnect, reconnect.
- Browse remote files; download a folder; upload a file; cancel or retry a transfer.
- Open five tabs, visit each, and switch with Cmd+1–5: each window keeps one renderer and the selected terminal takes the first keystroke.
- Open Host on an SSH host with an NVIDIA GPU: GPU cards update; start `python3 -m http.server 8000` there, then Forward & open serves it on localhost.
- Open Host on a container or pod over SSH (PID 1 in another namespace): disks list the container's volumes, and GPU processes from other containers read "Not visible from here".
- Connect to a host whose helper is missing, outdated or turned off: the Host view offers Install or Update helper, and the terminals stay connected.
- Run `sleep 15` and switch to another tab: a notification arrives when it finishes, and clicking it returns to that block.
- Update from the previous stable release through the in-app updater and confirm the relaunched version.

Real-host record for 1.0.0 (2026-10-11): an Ubuntu 24.04 workstation with an RTX 5090 and a Kubernetes pod with an A800, both over SSH from the packaged macOS arm64 build. Covered: GPU data, disks (NFS, CIFS, FUSE and bind volumes), listening ports, a forward served through each host (HTTP 200), helper update from a same-version build, install from `conn:wshenabled: false`, and replacing a crashing leftover helper.

## Release decision

Tag `1.0.0` only when:

- `task v1:gate:package` passes on a real Mac.
- The 1.0 feature matrix is all pass or explicitly deferred in this file.
- CI is green on `main`, including the macOS arm64 packaging job.
- The installed macOS app version is `1.0.0`, for both arm64 and x64 artifacts.

The macOS app is ad-hoc signed and not notarized (no Apple Developer ID). That is accepted for 1.0: release notes must tell users that Gatekeeper blocks the first launch and that they open it with **System Settings → Privacy & Security → Open Anyway** (after moving the app to `/Applications`), or by running `xattr -dr com.apple.quarantine /Applications/GenieTerm.app`.

Windows x64 is **deferred** from 1.0 stable. It does not gate the stable tag; it continues as an unsigned preview on prerelease tags, gated by `docs/windows-release-gate.md`, until a signing certificate is available.
