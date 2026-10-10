# Block Controller Lifecycle

## Overview

Block controllers manage the execution lifecycle of terminal shells, commands, and other interactive processes. **The frontend drives the controller lifecycle** - the backend is reactive, creating and managing controllers in response to frontend requests.

## Controller States

Controllers have three primary states:
- **`init`** - Controller exists but process is not running
- **`running`** - Process is actively running
- **`done`** - Process has exited

## Architecture Components

### Backend: Controller Registry

Location: [`pkg/blockcontroller/blockcontroller.go`](../pkg/blockcontroller/blockcontroller.go)

The backend maintains a **global controller registry** that maps blockIds to controller instances:

```go
var (
    controllerRegistry = make(map[string]Controller)
    registryLock       sync.RWMutex
)
```

Controllers implement the `Controller` interface in [`blockcontroller.go`](../pkg/blockcontroller/blockcontroller.go):
- `Start(ctx, blockMeta, rtOpts, force)` - Start the controller process
- `Stop(graceful, newStatus, destroy)` - Stop the controller process
- `GetRuntimeStatus()` - Get current runtime status
- `GetConnName()` - Connection the controller was created for
- `SendInput(input)` - Send input (data, signals, terminal size) to the process

There are two implementations:
- **`ShellController`** ([`shellcontroller.go`](../pkg/blockcontroller/shellcontroller.go)) - runs `shell` and `cmd` blocks directly as local, SSH, or WSL processes
- **`DurableShellController`** ([`durableshellcontroller.go`](../pkg/blockcontroller/durableshellcontroller.go)) - runs remote `shell` blocks as durable jobs managed by [`pkg/jobcontroller`](../pkg/jobcontroller/jobcontroller.go). The shell lives under a remote job manager, survives app restarts and disconnects, and is reattached by the block's `JobId`. It is selected when `jobcontroller.IsBlockIdTermDurable()` is true (view `term`, controller `shell`, non-local and non-WSL connection, `term:durable` from block meta → connection config → settings, default true).

### Frontend: View Model

Location: [`frontend/app/view/term/term-model.ts`](../frontend/app/view/term/term-model.ts)

`TermViewModel` manages the frontend side of a terminal block:

**Key Atoms:**
- `shellProcFullStatus` - Holds the current controller status from backend
- `shellProcStatus` - Derived atom for just the status string ("init", "running", "done")
- `isRestarting` - UI state for restart animation

**Event Subscription:**
The constructor subscribes to controller status events:
```typescript
this.shellProcStatusUnsubFn = waveEventSubscribeSingle({
    eventType: "controllerstatus",
    scope: WOS.makeORef("block", blockId),
    handler: (event) => {
        this.updateShellProcStatus(event.data);
    },
});
```

This creates a **reactive data flow**: backend publishes status updates → frontend receives via WebSocket events → UI updates automatically via Jotai atoms.

## Lifecycle Flow

### 1. Frontend Triggers Controller Creation/Start

**Entry Point:** `ResyncController()` in [`blockcontroller.go`](../pkg/blockcontroller/blockcontroller.go), reached via the `ControllerResyncCommand` RPC

The frontend calls this via `RpcApi.ControllerResyncCommand` when:

1. **Manual Restart** - User clicks restart button or presses Enter when process is done
   - Triggered by `TermViewModel.forceRestartController()`
   - Calls `ControllerDestroyCommand` first, then `ControllerResyncCommand` with `forcerestart: true`
   - Includes current terminal size (`termsize: { rows, cols }`)

2. **Connection Status Changes** - Connection becomes available/unavailable
   - Monitored by the `TermResyncHandler` component in [`term.tsx`](../frontend/app/view/term/term.tsx)
   - Watches `connStatus` atom for changes
   - Calls `termRef.current?.resyncController("resync handler")`

3. **Block Meta Changes** - Configuration like controller type or connection changes
   - Happens when block metadata is updated
   - Backend detects changes and triggers resync

### 2. Backend Processes Resync Request

The `ResyncController()` function:

```go
func ResyncController(ctx context.Context, tabId, blockId string, 
                      rtOpts *waveobj.RuntimeOpts, force bool) error
```

**Steps:**

1. **Serialize** - Take the per-block resync mutex
2. **Get Block Data** - Fetch block metadata from database
3. **Determine Controller Type** - Read `controller` meta key ("shell" or "cmd"); an empty value destroys any existing controller
4. **Pick Implementation** - `DurableShellController` if `jobcontroller.IsBlockIdTermDurable()`, else `ShellController`
5. **Check Existing Controller:**
   - If connection changed → destroy
   - If implementation needs to change (shell ↔ durable shell) → destroy
   - If `force=true` → destroy
   - If status is "done" → destroy before restarting
6. **Create and Register** - `MakeShellController()` or `MakeDurableShellController()`, then `registerController()`
7. **Check if Start Needed** - If status is "init":
   - For remote connections: `CheckConnStatus()` (or `CheckConnWshStatus()` for durable controllers, which require wsh) must pass, otherwise the resync returns an error
   - Call `controller.Start(ctx, blockMeta, rtOpts, force)`
8. **Publish Status** - Controller publishes runtime status updates

A `DurableShellController.Start()` reattaches to the block's existing job when its job manager is still running; otherwise it starts a new job (only when `force` is set if the block already had a job).

**Important:** Registering a new controller automatically stops any existing controller for that blockId:
```go
if existingController != nil {
    existingController.Stop(false, Status_Done, true)
    wstore.DeleteRTInfo(waveobj.MakeORef(waveobj.OType_Block, blockId))
}
```

### 3. Backend Publishes Status Updates

Controllers publish their status via the event system when:
- Process starts
- Process state changes
- Process exits

The status includes:
- `shellprocstatus` - "init", "running", or "done"
- `shellprocconnname` - Connection name being used
- `shellprocexitcode` - Exit code when done
- `version` - Incrementing version number for ordering

### 4. Frontend Receives and Processes Updates

**Status Update Handler:**
```typescript
handler: (event) => {
    this.updateShellProcStatus(event.data);
}
```

**Status Update Logic:**
```typescript
updateShellProcStatus(fullStatus: BlockControllerRuntimeStatus) {
    if (fullStatus == null) return;
    const curStatus = globalStore.get(this.shellProcFullStatus);
    // Only update if newer version
    if (curStatus == null || curStatus.version < fullStatus.version) {
        globalStore.set(this.shellProcFullStatus, fullStatus);
    }
}
```

The version check ensures out-of-order events don't cause issues.

### 5. UI Updates Reactively

The UI reacts to status changes through Jotai atoms:

**Header Buttons:**
- Show "Play" icon when status is "init"
- Show "Refresh" icon when status is "running" or "done"
- Display exit code/status icons for cmd controller

**Restart Behavior** (key handling in `term-model.ts`):
```typescript
const shellProcStatus = globalStore.get(this.shellProcStatus);
if ((shellProcStatus == "done" || shellProcStatus == "init") && 
    keyutil.checkKeyPressed(waveEvent, "Enter")) {
    fireAndForget(() => this.forceRestartController());
    return false;
}
```

Pressing Enter when the process is done/init triggers a restart.

## Input Flow

**Frontend → Backend:**

When user types in terminal, data flows through `TermViewModel.sendDataToController()`:
```typescript
sendDataToController(data: string) {
    const b64data = stringToBase64(data);
    RpcApi.ControllerInputCommand(TabRpcClient, { 
        blockid: this.blockId, 
        inputdata64: b64data 
    });
}
```

This calls the backend `blockcontroller.SendInput()` function which forwards to the controller's `SendInput()` method.

`BlockInputUnion` supports three types of input:
- `inputdata` - Raw terminal input bytes
- `signame` - Signal names (e.g., "SIGTERM", "SIGINT")
- `termsize` - Terminal size changes (rows/cols)

## Key Design Principles

### 1. Frontend-Driven Architecture

The frontend has full control over controller lifecycle:
- **Creates** controllers by calling ResyncController
- **Restarts** controllers via forcerestart flag
- **Monitors** status via event subscriptions
- **Sends input** via ControllerInput RPC

The backend is stateless and reactive - it doesn't make lifecycle decisions autonomously.

### 2. Idempotent Resync

`ResyncController()` is idempotent - calling it multiple times with the same state is safe:
- If controller exists and is running with correct type/connection → no-op
- If configuration changed → replaces controller
- If force flag set → always restarts

This makes it safe to call on various triggers (connection change, focus, etc.).

### 3. Versioned Status Updates

Status includes a monotonically increasing version number:
- Frontend can process events out-of-order
- Only applies updates with newer versions
- Prevents race conditions from concurrent updates

### 4. Automatic Cleanup

When a controller is replaced:
- Old controller is automatically stopped
- Runtime info is cleaned up
- Registry entry is updated atomically

The `registerController()` function handles this automatically.

## Common Patterns

### Restarting a Controller

```typescript
// In term-model.ts
async forceRestartController() {
    if (globalStore.get(this.isRestarting)) {
        return;
    }
    this.triggerRestartAtom();  // UI feedback
    await RpcApi.ControllerDestroyCommand(TabRpcClient, this.blockId);
    const termsize = {
        rows: this.termRef.current?.terminal?.rows,
        cols: this.termRef.current?.terminal?.cols,
    };
    await RpcApi.ControllerResyncCommand(TabRpcClient, {
        tabid: globalStore.get(atoms.staticTabId),
        blockid: this.blockId,
        forcerestart: true,
        rtopts: { termsize: termsize },
    });
}
```

### Handling Connection Changes

```typescript
// In term.tsx - TermResyncHandler component
React.useEffect(() => {
    const isConnected = connStatus?.status == "connected";
    const wasConnected = lastConnStatus?.status == "connected";
    if (isConnected == wasConnected && curConnName == lastConnName) {
        return;  // No change
    }
    model.termRef.current?.resyncController("resync handler");
    setLastConnStatus(connStatus);
}, [connStatus]);
```

### Monitoring Status

```typescript
// Status is automatically available via atom
const shellProcStatus = jotai.useAtomValue(model.shellProcStatus);

// Use in UI
if (shellProcStatus == "running") {
    // Show running state
} else if (shellProcStatus == "done") {
    // Show restart button
}
```

## Summary

The block controller lifecycle is **frontend-driven and event-reactive**:

1. **Frontend triggers** controller creation/restart via `ControllerResyncCommand` RPC
2. **Backend processes** the request in `ResyncController()`, creating/starting controllers as needed
3. **Backend publishes** status updates via WebSocket events
4. **Frontend receives** status updates and updates Jotai atoms
5. **UI reacts** automatically to atom changes via React components

This architecture gives the frontend full control over when processes start/stop while keeping the backend focused on process management. The event-based status updates create a clean separation of concerns and enable real-time UI updates without polling.
