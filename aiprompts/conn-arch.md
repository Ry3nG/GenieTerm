# Wave Terminal Connection Architecture

## Overview

Wave Terminal's connection system is designed to provide a unified interface for running shell processes across local, SSH, and WSL environments. The architecture is built in layers, with clear separation of concerns between connection management, shell process execution, and block-level orchestration.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    Block Controllers                             │
│  (blockcontroller/blockcontroller.go, shellcontroller.go)      │
│  - Block lifecycle management                                    │
│  - Controller registry and switching                             │
│  - Connection status verification                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              Connection Controllers (ConnUnion)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Local      │  │     SSH      │  │     WSL      │         │
│  │              │  │ (conncontrol │  │  (wslconn)   │         │
│  │              │  │    ler)      │  │              │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│  - Connection lifecycle (init → connecting → connected)         │
│  - WSH (Wave Shell Extensions) management                       │
│  - Domain socket setup for RPC communication                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Shell Process Execution                         │
│                   (shellexec/shellexec.go)                      │
│  - ShellProc wrapper for running processes                       │
│  - PTY management                                                │
│  - Process lifecycle (start, wait, kill)                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              Low-Level Connection Implementation                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   os/exec    │  │golang.org/x/ │  │  pkg/wsl     │         │
│  │              │  │  crypto/ssh  │  │              │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│  - Local process spawning                                        │
│  - SSH protocol implementation                                   │
│  - WSL command execution                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Block Controllers (`pkg/blockcontroller/`)

**Primary Files:**
- [`blockcontroller.go`](../pkg/blockcontroller/blockcontroller.go) - Controller registry and orchestration
- [`shellcontroller.go`](../pkg/blockcontroller/shellcontroller.go) - Shell/terminal controller implementation
- [`durableshellcontroller.go`](../pkg/blockcontroller/durableshellcontroller.go) - Durable remote shell controller backed by `pkg/jobcontroller`

**Responsibilities:**
- **Controller Registry**: Maintains a global map of active block controllers (`controllerRegistry`)
- **Lifecycle Management**: Handles controller creation, starting, stopping, and switching
- **Connection Verification**: Checks connection status before starting shell processes ([`CheckConnStatus()`](../pkg/blockcontroller/blockcontroller.go))
- **Controller Types**: Supports `shell` and `cmd` controllers; remote `shell` blocks use `DurableShellController` when `term:durable` resolves true

**Key Functions:**
- [`ResyncController()`](../pkg/blockcontroller/blockcontroller.go) - Main entry point for synchronizing block state with desired controller
- [`registerController()`](../pkg/blockcontroller/blockcontroller.go) - Registers a new controller, stopping any existing one
- [`getController()`](../pkg/blockcontroller/blockcontroller.go) - Retrieves active controller for a block

**ShellController Details:**
- Implements the `Controller` interface
- Manages shell processes via [`ShellProc`](../pkg/shellexec/shellexec.go)
- Handles three connection types via `ConnUnion`:
  - **Local**: Direct process execution on local machine
  - **SSH**: Remote execution via SSH connections
  - **WSL**: Windows Subsystem for Linux execution
- Key methods:
  - [`setupAndStartShellProcess()`](../pkg/blockcontroller/shellcontroller.go) - Sets up and starts shell process
  - [`getConnUnion()`](../pkg/blockcontroller/shellcontroller.go) - Determines connection type and retrieves connection object
  - [`manageRunningShellProcess()`](../pkg/blockcontroller/shellcontroller.go) - Manages I/O for running process

### 2. Connection Controllers

#### SSH Connections (`pkg/remote/conncontroller/`)

**Primary File:** [`conncontroller.go`](../pkg/remote/conncontroller/conncontroller.go)

**Architecture:**
- **Global Registry**: `clientControllerMap` maintains all SSH connections
- **Connection Lifecycle**: 
  ```
  init → connecting → connected → (running) → disconnected/error
  ```
- **Thread Safety**: Each connection has a field lock (`SSHConn.lock`) and a lifecycle lock (`SSHConn.lifecycleLock`)

**SSHConn Structure:**
```go
type SSHConn struct {
    lock               *sync.Mutex      // Protects struct fields
    lifecycleLock      *sync.Mutex      // Serializes connect/close
    Status             string           // Connection state
    WshEnabled         *atomic.Bool     // WSH availability flag
    Opts               *remote.SSHOpts  // Connection parameters
    Client             *ssh.Client      // Underlying SSH client
    DomainSockName     string          // Unix socket for RPC
    DomainSockListener net.Listener    // Socket listener
    ConnController     *ssh.Session    // Runs "wsh connserver"
    Error              string          // Connection error
    WshError           string          // WSH-specific error
    WshVersion         string          // Installed WSH version
    // ...
}
```

**Key Responsibilities:**
1. **SSH Client Management**: 
   - Establishes SSH connections using [`golang.org/x/crypto/ssh`](https://pkg.go.dev/golang.org/x/crypto/ssh)
   - Handles authentication (pubkey, password, keyboard-interactive)
   - Supports ProxyJump for multi-hop connections

2. **Domain Socket Setup** ([`OpenDomainSocketListener()`](../pkg/remote/conncontroller/conncontroller.go)):
   - Creates Unix domain socket on remote host (`/tmp/genieterm-*.sock`)
   - Enables bidirectional RPC communication
   - Socket used by both connserver and shell processes

3. **WSH (Wave Shell Extensions) Management**:
   - **Version Check** ([`StartConnServer()`](../pkg/remote/conncontroller/conncontroller.go)): Runs the helper's `version` subcommand to check installation
   - **Installation** ([`InstallWsh()`](../pkg/remote/conncontroller/conncontroller.go)): Copies the `genie` helper binary to the remote (`remote.CpWshToRemote()`)
   - **Update** ([`UpdateWsh()`](../pkg/remote/conncontroller/conncontroller.go)): Updates existing WSH installation
   - **User Prompts** ([`getPermissionToInstallWsh()`](../pkg/remote/conncontroller/conncontroller.go)): Asks user for install permission

4. **Connection Server** (`wsh connserver`):
   - Long-running process on remote host
   - Provides RPC services for file operations, command execution, etc.
   - Communicates via domain socket
   - Command built by [`MakeConnServerCommand()`](../pkg/remote/conncontroller/conncontroller.go): runs `~/.genieterm/bin/genie`, falling back to a legacy `~/.waveterm/bin/wsh` if only that is present (or `conn:wshpath` when set)

**Connection Flow:**
```
1. GetConn(opts) - Retrieve or create connection
2. Connect(ctx) → connectInternal() - Establish SSH client (auth handled in remote.ConnectToClient())
3. tryEnableWsh() - Check conn:wshenabled / ask permission
4. OpenDomainSocketListener() - Set up RPC channel
5. StartConnServer() - Launch helper connserver
6. (InstallWsh() inline with a 60s bound, else background install while connected without wsh)
7. Status: Connected - Ready for shell processes
```

#### SSH Client (`pkg/remote/sshclient.go`)

**Responsibilities:**
- **Authentication Methods**:
  - Public key with optional passphrase ([`createPublicKeyCallback()`](../pkg/remote/sshclient.go))
  - Password authentication ([`createPasswordCallbackPrompt()`](../pkg/remote/sshclient.go))
  - Keyboard-interactive ([`createInteractiveKbdInteractiveChallenge()`](../pkg/remote/sshclient.go))
  - SSH agent support

- **Known Hosts Verification** ([`createHostKeyCallback()`](../pkg/remote/sshclient.go)):
  - Reads `~/.ssh/known_hosts` and global known_hosts
  - Prompts user for unknown hosts
  - Handles key changes/mismatches

- **ProxyJump Support**:
  - Recursive connection through jump hosts
  - Max depth: `SshProxyJumpMaxDepth = 10`

- **User Interaction**:
  - Integrates with Wave's [`userinput`](../pkg/userinput/) system
  - Non-blocking prompts for passwords, passphrases, host verification

#### WSL Connections (`pkg/wslconn/`)

**Primary File:** [`wslconn.go`](../pkg/wslconn/wslconn.go)

**Architecture:**
- **Similar to SSH**: Parallel structure to `conncontroller` but for WSL
- **Global Registry**: `clientControllerMap` for WSL connections
- **Connection Naming**: `wsl://[distro-name]` (e.g., `wsl://Ubuntu`)

**WslConn Structure:**
```go
type WslConn struct {
    Lock               *sync.Mutex
    Status             string
    WshEnabled         *atomic.Bool
    Name               wsl.WslName      // Distro name
    Client             *wsl.Distro      // WSL distro interface
    DomainSockName     string          // Uses RemoteFullDomainSocketPath
    ConnController     *wsl.WslCmd     // Runs "wsh connserver"
    // ... similar to SSHConn
}
```

**Key Differences from SSH:**
- **No Network Socket**: WSL processes run locally, no SSH connection needed
- **Domain Socket Path**: Uses predetermined path ([`wavebase.RemoteFullDomainSocketPath`](../pkg/wavebase/))
- **Command Execution**: Uses `wsl.exe` command-line tool
- **Simpler Authentication**: No auth needed, user already logged into Windows

**Connection Flow:**
```
1. GetWslConn(distroName) - Get/create WSL connection
2. Connect(ctx) - Start connection process
3. OpenDomainSocketListener() - Set domain socket path (no actual listener)
4. StartConnServer() - Launch wsh connserver in WSL
5. (Install/Update WSH if needed)
6. Status: Connected - Ready for shell processes
```

### 3. Shell Process Execution (`pkg/shellexec/`)

**Primary File:** [`shellexec.go`](../pkg/shellexec/shellexec.go)

**ShellProc Structure:**
```go
type ShellProc struct {
    ConnName  string          // Connection identifier
    Cmd       ConnInterface   // Actual process interface
    CloseOnce *sync.Once      // Ensures single close
    DoneCh    chan any        // Signals process completion
    WaitErr   error           // Process exit status
}
```

**ConnInterface Implementations** (in [`conninterface.go`](../pkg/shellexec/conninterface.go)):
- **Local**: `CmdWrap` wraps `os/exec.Cmd` with PTY
- **SSH**: `SessionWrap` wraps SSH session
- **WSL**: `WslCmdWrap` wraps WSL command

**Process Startup Functions:**
- [`StartLocalShellProc()`](../pkg/shellexec/) - Local shell processes
- [`StartRemoteShellProc()`](../pkg/shellexec/) - SSH remote shells (with WSH)
- [`StartRemoteShellProcNoWsh()`](../pkg/shellexec/) - SSH remote shells (no WSH)
- [`StartWslShellProc()`](../pkg/shellexec/) - WSL shells (with WSH)
- [`StartWslShellProcNoWsh()`](../pkg/shellexec/) - WSL shells (no WSH)

**Key Features:**
- **PTY Management**: Pseudo-terminal for interactive shells
- **Graceful Shutdown**: Sends SIGTERM, waits briefly, then SIGKILL
- **Process Wrapping**: Abstracts differences between local/remote/WSL execution

### 4. Generic Connection Interface (`pkg/genconn/`)

**Purpose**: Provides abstraction layer for running commands across different connection types

**Primary File:** [`ssh-impl.go`](../pkg/genconn/ssh-impl.go)

**Interface Hierarchy:**
```go
ShellClient -> ShellProcessController
```

**SSHShellClient:**
- Wraps `*ssh.Client`
- Creates `SSHProcessController` for each command

**SSHProcessController:**
- Wraps `*ssh.Session`
- Implements stdio piping (stdin, stdout, stderr)
- Handles command lifecycle (Start, Wait, Kill)
- Thread-safe with internal locking

**Usage Pattern:**
```go
client := genconn.MakeSSHShellClient(sshClient)
proc, _ := client.MakeProcessController(cmdSpec)
stdout, _ := proc.StdoutPipe()
proc.Start()
// Read from stdout...
proc.Wait()
```

### 5. Shell Utilities (`pkg/util/shellutil/`)

**Primary File:** [`shellutil.go`](../pkg/util/shellutil/shellutil.go)

**Responsibilities:**

1. **Shell Detection**:
   - [`DetectLocalShellPath()`](../pkg/util/shellutil/shellutil.go) - Finds user's default shell
   - [`GetShellTypeFromShellPath()`](../pkg/util/shellutil/shellutil.go) - Identifies shell type (bash, zsh, fish, pwsh)
   - [`DetectShellTypeAndVersion()`](../pkg/util/shellutil/shellutil.go) - Gets shell version info

2. **Shell Integration Files**:
   - [`InitCustomShellStartupFiles()`](../pkg/util/shellutil/shellutil.go) - Creates Wave's shell integration
   - Manages startup files for each shell type:
     - Bash: `.bashrc` in `shell/bash/`
     - Zsh: `.zshrc`, `.zprofile`, etc. in `shell/zsh/`
     - Fish: `wave.fish` in `shell/fish/`
     - PowerShell: `wavepwsh.ps1` in `shell/pwsh/`

3. **Environment Management**:
   - [`WaveshellLocalEnvVars()`](../pkg/util/shellutil/shellutil.go) - Wave-specific environment variables
   - [`UpdateCmdEnv()`](../pkg/util/shellutil/shellutil.go) - Updates command environment

4. **WSH Binary Management**:
   - [`GetLocalWshBinaryPath()`](../pkg/util/shellutil/shellutil.go) / `GetLocalGenieBinaryPath()` - Locate platform-specific helper binaries
   - Supports multiple OS/arch combinations

5. **Git Bash Detection** (Windows):
   - [`FindGitBash()`](../pkg/util/shellutil/shellutil.go) - Locates Git Bash installation
   - Checks multiple common installation paths

## Connection Types and Workflows

### Local Connections

**Connection Name**: `"local"`, `"local:"`, or `""` (empty)

**Workflow:**
1. Block controller checks connection type via [`IsLocalConnName()`](../pkg/remote/conncontroller/conncontroller.go)
2. No connection setup needed
3. Shell process started directly via [`StartLocalShellProc()`](../pkg/shellexec/)
4. Uses `os/exec.Cmd` with PTY
5. WSH integration via environment variables

**Special Case - Git Bash (Windows):**
- Variant: `"local:gitbash"`
- Requires special shell path detection
- Uses Git Bash binary instead of default shell

### SSH Connections

**Connection Name**: `"user@host:port"` (parsed by [`remote.ParseOpts()`](../pkg/remote/))

**Full Connection Workflow:**

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Connection Request (from Block Controller)                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. GetConn(opts) - Retrieve/Create SSHConn                      │
│    - Check global registry (clientControllerMap)                │
│    - Create new SSHConn if needed                               │
│    - Status: "init"                                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. conn.Connect(ctx) - Establish SSH Connection                 │
│    - Status: "connecting"                                        │
│    - Read SSH config (~/.ssh/config)                            │
│    - Resolve ProxyJump if configured                            │
│    - Create SSH client auth methods:                            │
│      • Public key (with agent support)                          │
│      • Password                                                 │
│      • Keyboard-interactive                                     │
│    - Establish SSH connection                                    │
│    - Verify known_hosts                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. OpenDomainSocketListener(ctx) - Set Up RPC Channel          │
│    - Create random socket path: /tmp/genieterm-[random].sock   │
│    - Use ssh.Client.ListenUnix() for remote forwarding         │
│    - Start RPC listener goroutine                               │
│    - Socket available for all subsequent operations             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. StartConnServer(ctx) - Launch Wave Shell Extensions         │
│    - Run: "genie version" (wsh fallback) to check installation  │
│    - If not installed or outdated:                              │
│      a. Detect remote platform (OS/arch)                        │
│      b. Get user permission (if configured)                     │
│      c. InstallWsh() - Copy binary to remote                    │
│      d. Retry StartConnServer()                                 │
│    - Run: "genie connserver" on remote                          │
│    - Pass JWT token for authentication                          │
│    - Monitor connserver output                                   │
│    - Wait for RPC route registration                            │
│    - Status: "connected"                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Connection Ready - Can Start Shell Processes                 │
│    - SSHConn available in registry                              │
│    - Domain socket active for RPC                               │
│    - WSH connserver running                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. Start Shell Process (from ShellController)                   │
│    - setupAndStartShellProcess()                                │
│    - Create swap token (for shell integration)                  │
│    - StartRemoteShellProc() or StartRemoteShellProcNoWsh()     │
│    - SSH session created for shell                              │
│    - PTY allocated                                              │
│    - Shell starts with Wave integration                         │
└─────────────────────────────────────────────────────────────────┘
```

**WSH (Wave Shell Extensions) Details:**

**What is WSH?**
- Binary program (published as `genie`; `wsh` kept for compatibility) that runs on remote hosts
- Provides RPC services for Wave Terminal
- Written in Go, cross-platform
- Versioned to match Wave Terminal version

**WSH Components:**
1. **wsh version**: Reports installed version
2. **wsh connserver**: Long-running RPC server
   - Handles file operations
   - Executes commands
   - Provides remote state information
   - Communicates over domain socket

**WSH Installation Process:**
1. Check if the helper is installed: run `~/.genieterm/bin/genie version` (falls back to an existing `~/.waveterm/bin/wsh`)
2. If not installed: Detect platform with `uname -sm`
3. Get appropriate `genie` binary from the local app bundle
4. Copy to remote: `~/.genieterm/bin/genie` (only `genie` is deployed; no new `wsh` copy)
5. Set executable permissions
6. Re-run `StartConnServer()`; if the inline install times out, keep the connection in no-wsh mode and finish installing in the background

**With vs Without WSH:**
- **With WSH**: Full RPC support, better integration, file sync
- **Without WSH**: Basic shell only, limited features
- Fallback to no-WSH mode on installation failure

### WSL Connections

**Connection Name**: `"wsl://[distro]"` (e.g., `"wsl://Ubuntu"`)

**Workflow:**
```
1. GetWslConn(distroName) - Get/create WslConn
2. conn.Connect(ctx) - Start connection
3. OpenDomainSocketListener() - Set socket path (no actual listener)
4. StartConnServer() - Launch "wsh connserver" via wsl.exe
5. Install/update WSH if needed (similar to SSH)
6. Status: "connected"
7. StartWslShellProc() - Create shell process in WSL
```

**Key Differences from SSH:**
- Uses `wsl.exe` command-line tool
- No network connection overhead
- Predetermined domain socket path
- Simpler authentication (inherited from Windows)

## Token Swap System

**Purpose**: Pass connection-specific environment variables to shell processes

**Implementation:** [`shellutil.TokenSwapEntry`](../pkg/util/shellutil/)

**Flow:**
1. ShellController creates swap token before starting process
2. Token contains:
   - Socket name for RPC
   - JWT token for authentication
   - RPC context (TabId, BlockId, Conn)
   - Custom environment variables
3. Token stored in global swap map
4. Shell process receives token ID via environment
5. Shell integration scripts swap token for actual values
6. Token removed from map after use

**Purpose:**
- Avoid exposing JWT tokens in process listings
- Enable shell integration without hardcoded values
- Support multiple shells on same connection

## Error Handling and Recovery

### Connection Failures

**SSH Connection Errors:**
- Authentication failure → Prompt user (password, passphrase)
- Host key mismatch → Prompt for verification
- Network timeout → Status: "error", display error message
- ProxyJump failure → Error shows which jump host failed

**Recovery Mechanisms:**
- [`conn.WaitForConnect(ctx)`](../pkg/remote/conncontroller/conncontroller.go) - Block until connected
- [`EnsureConnection()`](../pkg/remote/conncontroller/conncontroller.go) - Connect if not already connected
- Automatic fallback to no-WSH mode on installation failure

### Process Failures

**Shell Process Errors:**
- Process crash → WaitErr contains exit code
- PTY failure → Captured in error message
- I/O errors → Logged and surfaced to user

**Cleanup:**
- [`ShellProc.Close()`](../pkg/shellexec/shellexec.go) - Graceful then forceful kill
- [`SSHConn.Close()`](../pkg/remote/conncontroller/conncontroller.go) - Cleanup all resources (via `closeInternal_withlifecyclelock()`)
- [`deleteController()`](../pkg/blockcontroller/blockcontroller.go) - Remove from registry

## Configuration Integration

### Connection Configuration

**Source:** [`pkg/wconfig/`](../pkg/wconfig/)

**Per-Connection Settings:**
- `conn:wshenabled` - Enable/disable WSH
- `conn:wshpath` - Custom WSH binary path
- `conn:shellpath` - Custom shell path

**Global Settings:**
- `conn:askbeforewshinstall` - Prompt before WSH installation
- Stored in `~/.config/genieterm/settings.json`
- Per-connection overrides in `~/.config/genieterm/connections.json`

### SSH Configuration

**Source:** `~/.ssh/config`

**Supported Directives:**
- `Host` - Connection matching
- `HostName` - Target hostname
- `Port` - SSH port
- `User` - Username
- `IdentityFile` - Private key paths
- `ProxyJump` - Jump host specification
- `UserKnownHostsFile` - Known hosts file
- `GlobalKnownHostsFile` - System known hosts
- `AddKeysToAgent` - Add keys to SSH agent

**Library:** [`github.com/kevinburke/ssh_config`](https://github.com/kevinburke/ssh_config)

## Thread Safety

### Synchronization Patterns

**SSHConn/WslConn:**
```go
conn.WithLock(func() {
    // ... modify connection state (SSHConn.lock / WslConn.Lock)
})
```

**Atomic Flags:**
```go
conn.WshEnabled.Load()    // Read WSH enabled status
conn.WshEnabled.Store(v)  // Update atomically
```

**Controller Registry:**
```go
registryLock.RLock()       // Read lock for lookups
registryLock.Lock()        // Write lock for modifications
```

**ShellProc Completion:**
```go
sp.CloseOnce.Do(func() {   // Ensure single execution
    sp.WaitErr = waitErr
    close(sp.DoneCh)       // Signal completion
})
```

## Event System Integration

### Connection Events

**Published via:** [`pkg/wps/`](../pkg/wps/) (Wave Publish/Subscribe)

**Event Types:**
- `Event_ConnChange` - Connection status changed
- `Event_ControllerStatus` - Block controller status update
- `Event_BlockFile` - Block file operation (terminal output)

**Example:**
```go
wps.Broker.Publish(wps.WaveEvent{
    Event: wps.Event_ConnChange,
    Scopes: []string{fmt.Sprintf("connection:%s", connName)},
    Data: connStatus,
})
```

**Frontend Integration:**
- Events received via WebSocket
- Connection status updates UI
- Real-time terminal output streaming

## Summary of Responsibilities

| Component | Responsibilities |
|-----------|-----------------|
| **blockcontroller/** | Block lifecycle, controller registry, connection coordination |
| **shellcontroller** | Shell process management, ConnUnion abstraction, I/O handling |
| **conncontroller/** | SSH connection lifecycle, WSH management, domain socket setup |
| **wslconn/** | WSL connection lifecycle, parallel to SSH but for WSL |
| **sshclient.go** | Low-level SSH: auth, known_hosts, ProxyJump |
| **shellexec/** | Process execution abstraction, PTY management |
| **genconn/** | Generic command execution interface |
| **shellutil/** | Shell detection, integration files, environment setup |

## Key Design Principles

1. **Layered Architecture**: Clear separation between block management, connection management, and process execution

2. **Connection Abstraction**: ConnUnion pattern allows uniform handling of Local/SSH/WSL

3. **WSH Optional**: System works with and without Wave Shell Extensions, degrading gracefully

4. **Thread Safety**: Defensive locking, atomic flags, singleton patterns prevent race conditions

5. **Error Recovery**: Multiple retry mechanisms, fallback modes, user prompts for resolution

6. **Configuration Hierarchy**: Global → Connection-Specific → Runtime overrides

7. **Event-Driven Updates**: Real-time status updates via pub/sub system

8. **User Interaction**: Non-blocking prompts for passwords, confirmations, installations

This architecture provides a robust foundation for Wave Terminal's multi-environment shell capabilities, with clear extension points for adding new connection types or capabilities.