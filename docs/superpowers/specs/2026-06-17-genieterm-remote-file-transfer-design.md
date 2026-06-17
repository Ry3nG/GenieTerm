# GenieTerm Remote File Transfer V1 Design

## Product Positioning

GenieTerm is a private fork of Wave focused on high-friction terminal workflows rather than competing with Codex, Claude, Cursor, or other AI applications. V1 targets remote file transfer because it is immediately useful, clearly under-served, and already validated by a real bug: downloading a remote directory currently routes through a file-only stream and saves a `.txt` error response.

The V1 feature name is **Practical Transfer Pack**.

## Goals

- Make remote directory download work from the Files widget.
- Support practical file and folder upload to a remote directory.
- Support multiple selected files/folders where the existing Files UI exposes selection.
- Show clear transfer progress and final status instead of relying on logs or native download behavior.
- Provide useful failure messages for common cases: permission denied, remote disconnected, missing transfer tool, target exists, and unsupported connection.
- Keep the implementation small enough to ship and install locally before broader GenieTerm product work.

## Non-Goals

- Do not build a full file manager in V1: no rename, delete, cut/copy/paste, permissions editor, archive manager, or recursive search.
- Do not implement AI agent integration, MCP, Codex/Claude session management, or workspace restore in V1.
- Do not create a public product distribution, update channel, website, or marketing site in V1.
- Do not require upstream Wave maintainers to accept the design; this is for the private GenieTerm fork.

## User Experience

The Files widget should distinguish files and folders:

- Remote file context menu: `Download File`.
- Remote folder context menu: `Download Folder`.
- Local-to-remote drag/drop: dropping files or folders onto a remote directory starts an upload to that directory.
- Multi-select, where available, should start one queued transfer job per selected item or one grouped job with item-level status.

Transfers appear in a compact transfer panel or toast-style queue with:

- item name
- source and destination
- current state: queued, running, complete, failed, canceled
- progress where available
- cancel while running
- retry after failure
- reveal/open destination after success

Native save dialogs should be used for selecting local download destinations. Folder download should save into a local directory, not a `.txt` file.

## Transport Strategy

V1 should use a pragmatic layered transport strategy:

1. Prefer Wave/GenieTerm's existing WSH/file RPC layer when it can support the operation cleanly.
2. For the private macOS build, allow an `rsync`/`scp` fallback for SSH-style connections where the connection name resolves through local SSH config.
3. Surface unsupported paths clearly rather than silently falling back to broken file streams.

This keeps the first private build useful while leaving space for a future cross-platform SFTP fallback.

## Architecture

The implementation should introduce a small transfer abstraction rather than wiring every UI action directly to a transport command.

Core pieces:

- `TransferJob`: describes operation type, source URI, destination URI/path, item type, connection, and status.
- `TransferQueue`: owns job lifecycle, progress updates, cancel/retry, and notifications.
- `TransferTransport`: interface for concrete implementations such as WSH stream, rsync/scp, and future SFTP.
- Files widget integration: builds `TransferJob` objects from context menu, save dialog, selection, or drag/drop events.
- Electron main process bridge: performs local filesystem dialogs and launches platform transfer work that cannot run safely in the renderer.

The renderer should never treat a directory as a file stream. Directory actions must create folder-aware transfer jobs.

## Error Handling

Failures should be reported in product language:

- Remote path is a directory but file download was requested.
- Remote connection is unavailable.
- Destination exists and cannot be overwritten.
- Local destination cannot be created.
- Remote permission denied.
- Transfer tool unavailable.
- Transfer canceled by user.

Logs should retain technical stderr details, but the UI should show a concise explanation and a retry action where retry is meaningful.

## Testing And Verification

Manual verification for V1:

- Download a remote single file.
- Download a remote directory containing nested files.
- Download multiple selected remote items.
- Upload one local file to a remote directory.
- Upload one local directory to a remote directory.
- Upload multiple local items.
- Cancel a long transfer.
- Retry a failed transfer after fixing the cause.
- Verify failure message when remote connection is disconnected.
- Verify failure message when destination exists as a file.

Automated coverage should focus on:

- URI parsing for `wsh://<connection>/<path>`.
- file-vs-directory menu branching.
- transfer job state transitions.
- transport selection logic.
- error mapping from transport failures to user-facing messages.

## First Implementation Slice

The first working slice should be:

1. Rebrand/fork bootstrap just enough that the local app can build and install as GenieTerm without overwriting Wave.
2. Add folder-aware `Download Folder` for remote directories.
3. Route folder downloads through a transfer job and macOS private-build rsync fallback.
4. Add simple completion/failure notifications.
5. Verify by downloading the previously failing remote directory case.

After this slice works, expand to drag/drop upload, multi-select transfer, and queue UI. These remain part of V1, but they do not block the first local GenieTerm install.

## V1 Acceptance Criteria

V1 is complete when:

- GenieTerm installs locally as a separate app without overwriting Wave.
- A remote folder can be downloaded from the Files widget into a local folder.
- A remote file can still be downloaded normally.
- Local files and folders can be uploaded to the current remote directory.
- Multiple selected items can be transferred in one action where the UI supports selection.
- The user can see whether each transfer is queued, running, complete, failed, or canceled.
- Failed transfers show a human-readable cause and can be retried when the source and destination still exist.
- The original `.txt` error-download behavior cannot be triggered from normal folder-download UI.
