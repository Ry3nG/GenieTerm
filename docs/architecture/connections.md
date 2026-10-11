<!-- Copyright 2026, GenieTerm. Apache-2.0. -->

# Connections

A block selects its execution environment with the `connection` metadata key. Local names include the empty string, `local`, and `local:` variants; `local:gitbash` selects Git Bash on Windows. SSH connections accept host aliases or `user@host:port`. WSL names use `wsl://<distro>`.

## SSH and connserver

`pkg/remote/conncontroller/conncontroller.go` keeps the `SSHConn` registry. Each connection has a field lock and a lifecycle lock to serialize connection setup and closure. `pkg/remote/sshclient.go` handles SSH configuration, authentication, known-host verification, and ProxyJump. Interactive requests go through `pkg/userinput/`.

Connection setup establishes the SSH client, starts its health monitor, and attempts to enable the helper according to `conn:wshenabled` and `conn:askbeforewshinstall`. Helper setup uses `SSHConn.OpenDomainSocketListener()` to request a remote Unix listener through SSH forwarding. The socket has a generated `/tmp/genieterm-<random>.sock` name.

`StartConnServer()` runs the helper in `connserver --router-domainsocket` mode, supplies a JWT over the session's standard input when requested, waits for the `conn:<name>` route, and calls `ConnServerInitCommand`. The session launches and monitors connserver; RPC traffic uses the forwarded socket. Remote implementations are in `pkg/wshrpc/wshremote/`.

Connection status and helper availability are separate. An SSH connection can be `connected` with `wshenabled: false`. Direct SSH shells can run without the helper. File operations in `pkg/remote/fileshare/wshfs/sftp_fallback.go` use SFTP over the existing SSH client when it is connected without WSH, provided the host supports SFTP. Durable terminal controllers require the helper and its connection route; they do not silently switch to a non-durable shell.

## Helper installation and updates

`MakeConnServerCommand()` prefers `~/.genieterm/bin/genie`, falls back to an existing `~/.waveterm/bin/wsh`, and honors `conn:wshpath`. It tries `version --protocol`, then plain `version` for older helpers.

`IsWshVersionUpToDate()` requires a `genie` version matching the app's semantic version and a protocol stamp at least as new as `wavebase.HelperProtocol`. A bare version has protocol zero. Checking only whether a remote version is numerically older would incorrectly preserve some upstream Wave helpers after GenieTerm's version reset.

`InstallWsh()` and `UpdateWsh()` use `remote.CpWshToRemote()` to copy the platform-specific bundled helper. The connect path waits up to 60 seconds for installation, then can hand it off to the background while SSH remains usable without WSH. A completed background install starts connserver and publishes updated status. `wshinstallpct`, `nowshreason`, and `wsherror` expose progress and failure details.

## WSL

`pkg/wslconn/wslconn.go` maintains `WslConn` instances and uses `pkg/wsl/` to launch processes through `wsl.exe`. It reuses the helper version checks and install machinery but starts `connserver --router`, carrying router traffic over standard input/output. Its remote socket path is `wavebase.RemoteFullDomainSocketPath`; there is no SSH forwarding step. WSL terminal shells use `pkg/shellexec/`, without the durable SSH job controller.

## Health and reconnection

`ConnMonitor` in `pkg/remote/conncontroller/connmonitor.go` tracks activity, terminal input, and helper-upload progress. It sends SSH-level `keepalive@openssh.com` requests, so monitoring works without the helper. Health is `good`, `degraded`, or `stalled`, independent of lifecycle states `init`, `connecting`, `connected`, `disconnected`, and `error`.

Input without a response prompts an early probe. Recent upload progress prevents a slow helper transfer from being treated as a dead link. Configured SSH `ServerAliveInterval` and `ServerAliveCountMax` affect the monitor's timeouts; system resume triggers an immediate probe.

`pkg/remote/conncontroller/connreconnect.go` retries dropped connections with exponential backoff and jitter when the policy installed by `pkg/blockcontroller/connreconnect.go` finds a controller on that connection or a running durable job. Explicit disconnect cancels retries. Automatic attempts suppress user prompts and stop on errors requiring credentials, host-key decisions, or configuration repair. Once SSH and connserver return, `pkg/jobcontroller/` reconciles job routes and reattaches streams.

## UI state

The backend publishes `connchange` events carrying `ConnStatus`. `frontend/app/store/global.ts` loads initial status through `ClientService.GetAllConnStatus()` and updates per-connection atoms through `getConnStatusAtom()`.

`frontend/app/block/connectionbutton.tsx` renders connection identity and health. `blockstatus.ts` and `blockstatusline.tsx` in the same directory combine connection state, helper installation, and durable-job state into status messages and actions. The Host view uses `frontend/app/view/host/host-model.ts`.

The connection picker is `frontend/app/modals/conntypeahead.tsx`. The main RPC operations are `ConnListCommand`, `WslListCommand`, `ConnEnsureCommand`, `ConnConnectCommand`, and `ConnDisconnectCommand`. Changing the selected host updates block metadata with `SetMetaCommand`; persistent connection settings use `SetConnectionsConfigCommand`. Terminal resync reacts to connection changes separately from establishing the connection itself.
