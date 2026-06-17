# GenieTerm Practical Transfer Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a private GenieTerm fork of Wave that installs side-by-side with Wave and ships the first remote-file experience fix: folder-aware remote directory download.

**Architecture:** Keep Go module and WSH internals mostly unchanged for the first slice, but rebrand Electron packaging and data directories so GenieTerm does not overwrite Wave. Add a small transfer utility layer for parsing `wsh://` paths and routing remote directories to a folder-aware Electron IPC handler backed by `rsync` for the private macOS build.

**Tech Stack:** GitHub CLI, Electron/Vite/React/TypeScript, Vitest, Electron IPC, Node `child_process`, `rsync`, Go wavesrv via existing Wave build pipeline.

---

## File Structure

- `docs/superpowers/specs/2026-06-17-genieterm-remote-file-transfer-design.md`: copy into the new GenieTerm repo as the product spec.
- `docs/superpowers/plans/2026-06-17-genieterm-practical-transfer-pack.md`: copy into the new GenieTerm repo as the implementation plan.
- `package.json`: rename npm package, product name, app id, homepage, and description.
- `electron-builder.config.cjs`: update macOS app metadata text and disable public Wave update publishing for the private fork.
- `emain/emain-platform.ts`: change Electron app display name and data/config directory base from `waveterm` to `genieterm`.
- `emain/emain.ts`: update user-facing quit prompt text.
- `emain/emain-menu.ts`: update About menu label.
- `emain/updater.ts`: update update notification text or disable private publishing path.
- `frontend/app/modals/about.tsx`: update About modal user-facing name and links.
- `frontend/app/onboarding/onboarding.tsx`: update first-run user-facing name and remove public Wave GitHub star prompts from GenieTerm.
- `frontend/types/custom.d.ts`: add `downloadFolder(path: string): void`.
- `frontend/preview/mock/preview-electron-api.ts`: add mock `downloadFolder`.
- `frontend/util/transferutil.ts`: create pure helpers for parsing `wsh://` remote URIs and building `rsync` arguments.
- `frontend/util/transferutil.test.ts`: create tests for URI parsing and rsync argument construction.
- `frontend/util/previewutil.ts`: branch remote context menu labels/actions by `finfo.isdir`.
- `frontend/util/previewutil.test.ts`: create tests for file vs folder menu behavior.
- `emain/preload.ts`: expose `downloadFolder` through Electron preload.
- `emain/transfer/download-folder.ts`: create pure and Electron-main helpers for folder download.
- `emain/transfer/download-folder.test.ts`: create tests for folder name, rsync path selection, and spawn args.
- `emain/emain-ipc.ts`: register `download-folder` IPC handler.
- `work/issue-drafts/*.md`: temporary local issue drafts before creating GitHub issues in the new private repo.

---

### Task 1: Create Private GenieTerm Repository Safely

**Files:**
- Create: `/Users/gongzerui/Documents/Codex/2026-06-17/go-to-ace-cci-download-this/work/genieterm-old-backup/`
- Create: `/Users/gongzerui/Documents/Codex/2026-06-17/go-to-ace-cci-download-this/work/GenieTerm/`
- Modify remote GitHub repo: `Ry3nG/GenieTerm`

- [ ] **Step 1: Back up existing public GenieTerm repository locally**

Run:

```bash
rm -rf work/genieterm-old-backup
git clone --mirror https://github.com/Ry3nG/GenieTerm.git work/genieterm-old-backup
git -C work/genieterm-old-backup show-ref --head | head
```

Expected: clone succeeds and prints refs from the old Swift/Rust repo.

- [ ] **Step 2: Delete the existing remote repository**

Run:

```bash
gh repo delete Ry3nG/GenieTerm --yes
```

Expected: GitHub CLI deletes `Ry3nG/GenieTerm`.

- [ ] **Step 3: Create the new private repository**

Run:

```bash
gh repo create Ry3nG/GenieTerm \
  --private \
  --description "Private terminal focused on remote file workflows"
```

Expected: GitHub CLI prints the new private repository URL.

- [ ] **Step 4: Clone Wave as the new GenieTerm working repository**

Run:

```bash
rm -rf work/GenieTerm
git clone https://github.com/wavetermdev/waveterm.git work/GenieTerm
git -C work/GenieTerm remote rename origin upstream
git -C work/GenieTerm remote add origin https://github.com/Ry3nG/GenieTerm.git
git -C work/GenieTerm push -u origin main
```

Expected: `work/GenieTerm` exists, `upstream` points to Wave, `origin` points to private GenieTerm, and `main` is pushed.

- [ ] **Step 5: Copy approved spec and this plan into GenieTerm**

Run:

```bash
mkdir -p work/GenieTerm/docs/superpowers/specs work/GenieTerm/docs/superpowers/plans
cp docs/superpowers/specs/2026-06-17-genieterm-remote-file-transfer-design.md work/GenieTerm/docs/superpowers/specs/
cp docs/superpowers/plans/2026-06-17-genieterm-practical-transfer-pack.md work/GenieTerm/docs/superpowers/plans/
git -C work/GenieTerm add docs/superpowers
git -C work/GenieTerm commit -m "docs: add GenieTerm transfer pack specs"
git -C work/GenieTerm push
```

Expected: commit succeeds and the private repo contains the spec and plan.

---

### Task 2: Rebrand The App For Side-By-Side Installation

**Files:**
- Modify: `work/GenieTerm/package.json`
- Modify: `work/GenieTerm/electron-builder.config.cjs`
- Modify: `work/GenieTerm/emain/emain-platform.ts`
- Modify: `work/GenieTerm/emain/emain.ts`
- Modify: `work/GenieTerm/emain/emain-menu.ts`
- Modify: `work/GenieTerm/emain/updater.ts`
- Modify: `work/GenieTerm/frontend/app/modals/about.tsx`
- Modify: `work/GenieTerm/frontend/app/onboarding/onboarding.tsx`

- [ ] **Step 1: Update package identity**

Edit `package.json` with this identity:

```json
{
  "name": "genieterm",
  "productName": "GenieTerm",
  "description": "Private terminal focused on remote file workflows",
  "homepage": "https://github.com/Ry3nG/GenieTerm",
  "build": {
    "appId": "dev.ry3ng.genieterm"
  }
}
```

Keep all existing dependencies, scripts, version, license, workspaces, and `main` unchanged.

- [ ] **Step 2: Update Electron data/config base**

In `emain/emain-platform.ts`, replace the app name and directory base constants with:

```ts
app.setName("genieterm/electron");

const appDisplayName = isDev ? "GenieTerm (Dev)" : "GenieTerm";
const waveDirNamePrefix = "genieterm";
const waveDirNameSuffix = isDev ? "dev" : "";
const waveDirName = `${waveDirNamePrefix}${waveDirNameSuffix ? `-${waveDirNameSuffix}` : ""}`;

const paths = envPaths("genieterm", { suffix: waveDirNameSuffix });

app.setName(appDisplayName);
```

Expected data dirs after this change:

```text
~/Library/Application Support/genieterm
~/.config/genieterm
```

The internal environment variable names `WAVETERM_DATA_HOME` and `WAVETERM_CONFIG_HOME` remain unchanged in V1 so the Go server keeps working.

- [ ] **Step 3: Update user-facing Electron builder strings**

In `electron-builder.config.cjs`, update `extendInfo` descriptions to say `GenieTerm` instead of `Wave`. Change `publish` to a disabled local generic target so private builds do not point at Wave releases:

```js
publish: null,
```

Keep `appId: pkg.build.appId`, `productName: pkg.productName`, output directory, asar settings, and targets unchanged.

- [ ] **Step 4: Update visible app labels**

Change these exact user-facing strings:

```text
Are you sure you want to quit Wave Terminal? -> Are you sure you want to quit GenieTerm?
About Wave Terminal -> About GenieTerm
Wave Terminal -> GenieTerm
Wave has detected a performance issue -> GenieTerm has detected a performance issue
Wave is running in ARM64 translation mode... -> GenieTerm is running in ARM64 translation mode...
```

Apply them in:

```text
emain/emain.ts
emain/emain-menu.ts
emain/emain-platform.ts
emain/updater.ts
frontend/app/modals/about.tsx
frontend/app/onboarding/onboarding.tsx
```

- [ ] **Step 5: Run rebrand checks**

Run:

```bash
rg -n "Wave Terminal|About Wave|quit Wave|Wave has detected|waveterm/electron|envPaths\\(\"waveterm\"|dev\\.commandline\\.waveterm" package.json electron-builder.config.cjs emain frontend
npm run build:dev
```

Expected: `rg` should only show intentionally unchanged documentation/help links or internal legacy comments. `npm run build:dev` should exit 0.

- [ ] **Step 6: Commit the side-by-side rebrand**

Run:

```bash
git add package.json electron-builder.config.cjs emain frontend
git commit -m "chore: rebrand app identity to GenieTerm"
git push
```

Expected: commit and push succeed.

---

### Task 3: Add Transfer Utility Tests And Pure Helpers

**Files:**
- Create: `work/GenieTerm/frontend/util/transferutil.ts`
- Create: `work/GenieTerm/frontend/util/transferutil.test.ts`

- [ ] **Step 1: Write failing tests for remote URI parsing**

Create `frontend/util/transferutil.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
    buildRsyncFolderArgs,
    ensureTrailingSlash,
    getRemotePathBaseName,
    parseWshRemoteUri,
} from "./transferutil";

describe("transferutil", () => {
    it("parses home-relative wsh remote URIs", () => {
        expect(parseWshRemoteUri("wsh://paw-5090-ws/~/projects/out")).toEqual({
            connection: "paw-5090-ws",
            remotePath: "~/projects/out",
        });
    });

    it("parses absolute wsh remote URIs", () => {
        expect(parseWshRemoteUri("wsh://server//var/log/app")).toEqual({
            connection: "server",
            remotePath: "/var/log/app",
        });
    });

    it("decodes encoded connection and path components", () => {
        expect(parseWshRemoteUri("wsh://host%20alias/%7E/project%20data")).toEqual({
            connection: "host alias",
            remotePath: "~/project data",
        });
    });

    it("rejects local and malformed remote URIs", () => {
        expect(() => parseWshRemoteUri("/tmp/file")).toThrow("Folder download only supports remote wsh:// paths");
        expect(() => parseWshRemoteUri("wsh://local/~/file")).toThrow("Folder download requires a remote connection");
        expect(() => parseWshRemoteUri("wsh://missing-path")).toThrow("Invalid remote path");
    });

    it("normalizes trailing slashes", () => {
        expect(ensureTrailingSlash("/tmp/out")).toBe("/tmp/out/");
        expect(ensureTrailingSlash("/tmp/out/")).toBe("/tmp/out/");
    });

    it("gets stable folder names from remote paths", () => {
        expect(getRemotePathBaseName("~/projects/out/")).toBe("out");
        expect(getRemotePathBaseName("/var/log/app")).toBe("app");
        expect(getRemotePathBaseName("~")).toBe("download");
    });

    it("builds rsync folder args with trailing source and destination slashes", () => {
        expect(buildRsyncFolderArgs("wsh://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out")).toEqual([
            "-az",
            "paw-5090-ws:~/projects/out/",
            "/Users/me/Desktop/out/",
        ]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- frontend/util/transferutil.test.ts --run
```

Expected: FAIL because `frontend/util/transferutil.ts` does not exist.

- [ ] **Step 3: Implement transfer utility helpers**

Create `frontend/util/transferutil.ts`:

```ts
export type ParsedWshRemoteUri = {
    connection: string;
    remotePath: string;
};

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function ensureTrailingSlash(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

export function parseWshRemoteUri(filePath: string): ParsedWshRemoteUri {
    if (typeof filePath !== "string" || !filePath.startsWith("wsh://")) {
        throw new Error("Folder download only supports remote wsh:// paths");
    }
    const uriBody = filePath.slice("wsh://".length);
    const slashIdx = uriBody.indexOf("/");
    if (slashIdx < 1 || slashIdx === uriBody.length - 1) {
        throw new Error(`Invalid remote path: ${filePath}`);
    }
    const connection = safeDecodeURIComponent(uriBody.slice(0, slashIdx));
    const remotePath = safeDecodeURIComponent(uriBody.slice(slashIdx + 1));
    if (!connection || !remotePath) {
        throw new Error(`Invalid remote path: ${filePath}`);
    }
    if (connection === "local") {
        throw new Error("Folder download requires a remote connection");
    }
    return { connection, remotePath };
}

export function getRemotePathBaseName(remotePath: string): string {
    const normalized = remotePath.replace(/\/+$/, "");
    const lastSlashIdx = normalized.lastIndexOf("/");
    const baseName = lastSlashIdx >= 0 ? normalized.slice(lastSlashIdx + 1) : normalized;
    if (!baseName || baseName === "~") {
        return "download";
    }
    return baseName;
}

export function buildRsyncFolderArgs(remoteUri: string, destinationPath: string): string[] {
    const parsed = parseWshRemoteUri(remoteUri);
    return ["-az", `${parsed.connection}:${ensureTrailingSlash(parsed.remotePath)}`, ensureTrailingSlash(destinationPath)];
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm test -- frontend/util/transferutil.test.ts --run
npm run build:dev
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit transfer utilities**

Run:

```bash
git add frontend/util/transferutil.ts frontend/util/transferutil.test.ts
git commit -m "feat: add remote transfer path helpers"
git push
```

Expected: commit and push succeed.

---

### Task 4: Branch Files Widget Download Menu By File Type

**Files:**
- Modify: `work/GenieTerm/frontend/types/custom.d.ts`
- Modify: `work/GenieTerm/frontend/preview/mock/preview-electron-api.ts`
- Modify: `work/GenieTerm/emain/preload.ts`
- Modify: `work/GenieTerm/frontend/util/previewutil.ts`
- Create: `work/GenieTerm/frontend/util/previewutil.test.ts`

- [ ] **Step 1: Write failing menu tests**

Create `frontend/util/previewutil.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("addOpenMenuItems", () => {
    let downloadFile: ReturnType<typeof vi.fn>;
    let downloadFolder: ReturnType<typeof vi.fn>;
    let openNativePath: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        downloadFile = vi.fn();
        downloadFolder = vi.fn();
        openNativePath = vi.fn();
        vi.doMock("@/app/store/global", () => ({
            createBlock: vi.fn(),
            getApi: () => ({
                downloadFile,
                downloadFolder,
                openNativePath,
            }),
        }));
    });

    it("downloads remote files with Download File", async () => {
        const { addOpenMenuItems } = await import("./previewutil");
        const menu = addOpenMenuItems([], "paw-5090-ws", {
            path: "~/projects/out.txt",
            dir: "~/projects",
            isdir: false,
        } as FileInfo);
        const item = menu.find((entry) => entry.label === "Download File");

        expect(item).toBeTruthy();
        item.click();

        expect(downloadFile).toHaveBeenCalledWith("wsh://paw-5090-ws/~/projects/out.txt");
        expect(downloadFolder).not.toHaveBeenCalled();
    });

    it("downloads remote directories with Download Folder", async () => {
        const { addOpenMenuItems } = await import("./previewutil");
        const menu = addOpenMenuItems([], "paw-5090-ws", {
            path: "~/projects/out",
            dir: "~/projects",
            isdir: true,
        } as FileInfo);
        const item = menu.find((entry) => entry.label === "Download Folder");

        expect(item).toBeTruthy();
        item.click();

        expect(downloadFolder).toHaveBeenCalledWith("wsh://paw-5090-ws/~/projects/out");
        expect(downloadFile).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- frontend/util/previewutil.test.ts --run
```

Expected: FAIL because `downloadFolder` is not typed and `previewutil.ts` still labels directories as `Download File`.

- [ ] **Step 3: Add `downloadFolder` to Electron API types and mocks**

In `frontend/types/custom.d.ts`, add next to `downloadFile`:

```ts
downloadFolder: (path: string) => void; // download-folder
```

In `frontend/preview/mock/preview-electron-api.ts`, add next to `downloadFile`:

```ts
downloadFolder: (_path: string) => {},
```

In `emain/preload.ts`, add next to `downloadFile`:

```ts
downloadFolder: (filePath) => ipcRenderer.send("download-folder", { filePath }),
```

- [ ] **Step 4: Update remote menu branch**

In `frontend/util/previewutil.ts`, replace the remote `menu.push` block with:

```ts
menu.push({
    label: finfo.isdir ? "Download Folder" : "Download File",
    click: () => {
        const remoteUri = formatRemoteUri(finfo.path, conn);
        if (finfo.isdir) {
            getApi().downloadFolder(remoteUri);
        } else {
            getApi().downloadFile(remoteUri);
        }
    },
});
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test -- frontend/util/previewutil.test.ts --run
npm run build:dev
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit menu branching**

Run:

```bash
git add frontend/types/custom.d.ts frontend/preview/mock/preview-electron-api.ts emain/preload.ts frontend/util/previewutil.ts frontend/util/previewutil.test.ts
git commit -m "feat: route remote folder downloads separately"
git push
```

Expected: commit and push succeed.

---

### Task 5: Add Electron Folder Download Handler

**Files:**
- Create: `work/GenieTerm/emain/transfer/download-folder.ts`
- Create: `work/GenieTerm/emain/transfer/download-folder.test.ts`
- Modify: `work/GenieTerm/emain/emain-ipc.ts`

- [ ] **Step 1: Write failing helper tests**

Create `emain/transfer/download-folder.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildFolderDownloadPlan, getRsyncPath } from "./download-folder";

describe("download-folder helpers", () => {
    it("builds a folder download plan", () => {
        expect(buildFolderDownloadPlan("wsh://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out")).toEqual({
            folderName: "out",
            rsyncArgs: ["-az", "paw-5090-ws:~/projects/out/", "/Users/me/Desktop/out/"],
        });
    });

    it("selects the first existing rsync candidate", () => {
        const selected = getRsyncPath((candidate) => candidate === "/usr/local/bin/rsync");
        expect(selected).toBe("/usr/local/bin/rsync");
    });

    it("falls back to PATH rsync when no known absolute path exists", () => {
        const selected = getRsyncPath(() => false);
        expect(selected).toBe("rsync");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- emain/transfer/download-folder.test.ts --run
```

Expected: FAIL because `emain/transfer/download-folder.ts` does not exist.

- [ ] **Step 3: Implement folder download helpers and IPC registration**

Create `emain/transfer/download-folder.ts`:

```ts
import * as electron from "electron";
import fs from "fs";
import * as child_process from "node:child_process";
import * as path from "path";
import { buildRsyncFolderArgs, getRemotePathBaseName, parseWshRemoteUri } from "../../frontend/util/transferutil";

type ExistsFn = (candidate: string) => boolean;

export type FolderDownloadPlan = {
    folderName: string;
    rsyncArgs: string[];
};

export function getRsyncPath(existsFn: ExistsFn = fs.existsSync): string {
    for (const candidate of ["/opt/homebrew/bin/rsync", "/usr/local/bin/rsync", "/usr/bin/rsync"]) {
        if (existsFn(candidate)) {
            return candidate;
        }
    }
    return "rsync";
}

export function buildFolderDownloadPlan(remoteUri: string, destinationPath: string): FolderDownloadPlan {
    const parsed = parseWshRemoteUri(remoteUri);
    return {
        folderName: getRemotePathBaseName(parsed.remotePath),
        rsyncArgs: buildRsyncFolderArgs(remoteUri, destinationPath),
    };
}

function showFolderDownloadError(message: string, err?: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err ?? "");
    console.error(message, err);
    electron.dialog.showErrorBox("Download Folder Failed", `${message}${errMessage ? `\n\n${errMessage}` : ""}`);
}

export function registerDownloadFolderHandler() {
    electron.ipcMain.on("download-folder", async (event, payload: { filePath?: string }) => {
        const senderWindow = electron.BrowserWindow.fromWebContents(event.sender);
        let remoteUri = payload?.filePath;
        let folderName = "download";
        try {
            const parsed = parseWshRemoteUri(remoteUri);
            folderName = getRemotePathBaseName(parsed.remotePath);
        } catch (err) {
            showFolderDownloadError("Could not parse the remote folder path.", err);
            return;
        }

        const result = await electron.dialog.showSaveDialog(senderWindow, {
            title: "Download Folder",
            buttonLabel: "Download",
            defaultPath: folderName,
            properties: ["createDirectory"],
        });
        if (result.canceled || !result.filePath) {
            return;
        }

        try {
            if (fs.existsSync(result.filePath) && !fs.statSync(result.filePath).isDirectory()) {
                throw new Error(`Destination exists and is not a folder: ${result.filePath}`);
            }
            await fs.promises.mkdir(result.filePath, { recursive: true });
        } catch (err) {
            showFolderDownloadError("Could not prepare the destination folder.", err);
            return;
        }

        const plan = buildFolderDownloadPlan(remoteUri, result.filePath);
        const rsyncPath = getRsyncPath();
        const child = child_process.spawn(rsyncPath, plan.rsyncArgs, { windowsHide: true });
        let stderr = "";

        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (err) => {
            showFolderDownloadError(`Could not start rsync at ${rsyncPath}.`, err);
        });
        child.on("close", (code) => {
            if (code === 0) {
                new electron.Notification({ title: "Folder Download Complete", body: path.basename(result.filePath) }).show();
                return;
            }
            showFolderDownloadError(`rsync exited with code ${code}.`, new Error(stderr.trim() || "No error output from rsync."));
        });
    });
}
```

- [ ] **Step 4: Wire IPC registration**

In `emain/emain-ipc.ts`, add this import:

```ts
import { registerDownloadFolderHandler } from "./transfer/download-folder";
```

Inside `initIpcHandlers()`, immediately after the existing `download` handler, add:

```ts
registerDownloadFolderHandler();
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test -- frontend/util/transferutil.test.ts emain/transfer/download-folder.test.ts frontend/util/previewutil.test.ts --run
npm run build:dev
```

Expected: all tests pass and build exits 0.

- [ ] **Step 6: Commit folder download IPC**

Run:

```bash
git add emain/transfer/download-folder.ts emain/transfer/download-folder.test.ts emain/emain-ipc.ts
git commit -m "feat: add remote folder download handler"
git push
```

Expected: commit and push succeed.

---

### Task 6: Create GenieTerm Feature Issues

**Files:**
- Create: `work/issue-drafts/01-remote-folder-download.md`
- Create: `work/issue-drafts/02-drag-drop-upload.md`
- Create: `work/issue-drafts/03-transfer-queue.md`
- Create: `work/issue-drafts/04-multi-select-transfer.md`
- Create: `work/issue-drafts/05-sftp-fallback.md`

- [ ] **Step 1: Create issue drafts**

Create drafts with these titles and bodies:

```markdown
# Remote folder download

Implement folder-aware remote downloads from the Files widget. Directory actions must not route through `/wave/stream-file`; they should create folder transfer jobs and save to a local directory.
```

```markdown
# Drag-and-drop upload to remote folders

Allow users to drag local files or folders from Finder into a remote Files widget directory and upload them to that directory.
```

```markdown
# Transfer queue with progress, cancel, and retry

Add a compact transfer queue showing queued, running, complete, failed, and canceled jobs. Running jobs should be cancelable; failed jobs should expose retry when source and destination still exist.
```

```markdown
# Multi-select remote file transfers

Support transferring multiple selected remote files and folders in one action. The UI should preserve per-item status when a grouped operation partially fails.
```

```markdown
# SFTP fallback when WSH is unavailable

Add an SFTP transport fallback for servers where WSH cannot be installed or started. This should support common SSH config features used by remote development and HPC workflows.
```

- [ ] **Step 2: Create GitHub issues in the private repo**

Run:

```bash
gh issue create --repo Ry3nG/GenieTerm --title "Remote folder download" --body-file work/issue-drafts/01-remote-folder-download.md --label enhancement
gh issue create --repo Ry3nG/GenieTerm --title "Drag-and-drop upload to remote folders" --body-file work/issue-drafts/02-drag-drop-upload.md --label enhancement
gh issue create --repo Ry3nG/GenieTerm --title "Transfer queue with progress, cancel, and retry" --body-file work/issue-drafts/03-transfer-queue.md --label enhancement
gh issue create --repo Ry3nG/GenieTerm --title "Multi-select remote file transfers" --body-file work/issue-drafts/04-multi-select-transfer.md --label enhancement
gh issue create --repo Ry3nG/GenieTerm --title "SFTP fallback when WSH is unavailable" --body-file work/issue-drafts/05-sftp-fallback.md --label enhancement
```

Expected: five private GitHub issue URLs are printed.

---

### Task 7: Build, Install, And Verify The First Slice

**Files:**
- Read: `work/GenieTerm/make/`
- Install app: `/Applications/GenieTerm.app`

- [ ] **Step 1: Initialize dependencies**

Run:

```bash
task init
```

Expected: Node and Go dependencies install successfully.

- [ ] **Step 2: Run tests and development build**

Run:

```bash
npm test -- frontend/util/transferutil.test.ts emain/transfer/download-folder.test.ts frontend/util/previewutil.test.ts --run
npm run build:dev
```

Expected: tests pass and build exits 0.

- [ ] **Step 3: Package GenieTerm**

Run:

```bash
task package
```

Expected: macOS app artifacts appear under `make/`, including a GenieTerm `.app` inside the packaged output or DMG/zip.

- [ ] **Step 4: Install side-by-side with Wave**

Run a command matching the produced artifact shape. If `make/mac*/GenieTerm.app` exists, use:

```bash
rm -rf /Applications/GenieTerm.app
cp -R make/mac*/GenieTerm.app /Applications/
```

If only a zip or dmg exists, expand/mount it and copy `GenieTerm.app` to `/Applications/GenieTerm.app`.

Expected: `/Applications/GenieTerm.app` exists and `/Applications/Wave.app` remains untouched.

- [ ] **Step 5: Verify identity and code signature**

Run:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleName' /Applications/GenieTerm.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' /Applications/GenieTerm.app/Contents/Info.plist
codesign --verify --deep --strict --verbose=2 /Applications/GenieTerm.app
```

Expected:

```text
GenieTerm
dev.ry3ng.genieterm
... valid on disk
... satisfies its Designated Requirement
```

- [ ] **Step 6: Launch and verify folder download manually**

Run:

```bash
open -a /Applications/GenieTerm.app
```

Manual expected behavior:

1. GenieTerm launches as a separate app.
2. GenieTerm uses `~/Library/Application Support/genieterm` and `~/.config/genieterm`.
3. Open the remote Files widget for `paw-5090-ws`.
4. Right-click `~/projects/Little-WAM/data/deploy_debug/kairos_red_cube_step006000_32steps_20260617_143443`.
5. Menu shows `Download Folder`, not `Download File`.
6. Save dialog defaults to folder name `kairos_red_cube_step006000_32steps_20260617_143443`, not `.txt`.
7. Download completes and the local folder contains 105 files.

- [ ] **Step 7: Commit any packaging fixes**

If packaging required source fixes, run:

```bash
git status --short
git add package.json electron-builder.config.cjs emain frontend docs
git commit -m "fix: package GenieTerm side by side"
git push
```

Expected: final source state is pushed to private repo.

---

## Self-Review Notes

- Spec coverage: repository bootstrap, side-by-side install, remote folder download, test coverage, feature issues, and local install are covered.
- Deferred V1 scope: upload, transfer queue, multi-select, and SFTP fallback are intentionally created as GitHub issues after the first slice. They are not prerequisites for installing the first usable GenieTerm build.
- Type consistency: `downloadFolder`, `download-folder`, `ParsedWshRemoteUri`, `buildRsyncFolderArgs`, and `registerDownloadFolderHandler` names are consistent across tasks.
- Risk: keeping `WAVETERM_*` internal environment names avoids broad Go rewrites in the first slice, but visible app/data names become GenieTerm.
