import * as electron from "electron";
import fs from "fs";
import * as child_process from "node:child_process";
import * as path from "path";
import type { TransferError, TransferJobInput } from "../../frontend/util/transferqueue";
import { buildRsyncFolderArgs, getRemotePathBaseName, parseWshRemoteUri } from "../../frontend/util/transferutil";
import { buildLocalFileUri, createDownloadTransferJobId, downloadTransferTracker } from "./download-transfer";
import { clearTransferCancelHandle, registerTransferCancelHandle } from "./transfer-handles";

type ExistsFn = (candidate: string) => boolean;

export type FolderDownloadPlan = {
    folderName: string;
    transport: "rsync" | "scp";
    args: string[];
    cwd?: string;
};

export type FolderDownloadFailureKind = "parse" | "destination" | "start" | "exit" | "canceled";

export type FolderDownloadError = TransferError & {
    detail?: string;
};

export function getRsyncPath(existsFn: ExistsFn = fs.existsSync): string {
    for (const candidate of ["/opt/homebrew/bin/rsync", "/usr/local/bin/rsync", "/usr/bin/rsync"]) {
        if (existsFn(candidate)) {
            return candidate;
        }
    }
    return "rsync";
}

export function buildFolderDownloadPlan(
    remoteUri: string,
    destinationPath: string,
    platform = process.platform
): FolderDownloadPlan {
    const parsed = parseWshRemoteUri(remoteUri);
    if (platform === "win32") {
        const destination = path.win32.parse(destinationPath);
        const remotePath = parsed.remotePath.replace(/\/+$/, "") + "/.";
        return {
            folderName: getRemotePathBaseName(parsed.remotePath),
            transport: "scp",
            args: ["-r", `${parsed.connection}:${remotePath}`, destination.base],
            cwd: destination.dir,
        };
    }
    return {
        folderName: getRemotePathBaseName(parsed.remotePath),
        transport: "rsync",
        args: buildRsyncFolderArgs(remoteUri, destinationPath),
    };
}

export function buildFolderDownloadTransferJobInput(
    remoteUri: string,
    destinationPath: string,
    id: string,
    platform = process.platform
): TransferJobInput {
    const plan = buildFolderDownloadPlan(remoteUri, destinationPath, platform);
    return {
        id,
        operation: "download",
        itemType: "folder",
        transport: plan.transport,
        source: remoteUri,
        destination: buildLocalFileUri(destinationPath),
        label: plan.folderName,
    };
}

export function mapFolderDownloadError(kind: FolderDownloadFailureKind, err?: unknown): FolderDownloadError {
    const detail = err instanceof Error ? err.message : err == null ? undefined : String(err);
    const base = (() => {
        switch (kind) {
            case "parse":
                return {
                    code: "invalid_source",
                    message: "Could not parse the remote folder path.",
                    retryable: false,
                };
            case "destination":
                return {
                    code: "destination_error",
                    message: "Could not prepare the destination folder.",
                    retryable: true,
                };
            case "start":
                return {
                    code: "transfer_start_failed",
                    message: "Could not start the folder transfer.",
                    retryable: true,
                };
            case "exit":
                return {
                    code: "transfer_failed",
                    message: "Folder transfer failed.",
                    retryable: true,
                };
            case "canceled":
                return {
                    code: "download_canceled",
                    message: "Folder download canceled.",
                    retryable: true,
                };
        }
    })();
    return detail ? { ...base, detail } : base;
}

function showFolderDownloadError(error: FolderDownloadError) {
    console.error(error.message, error.detail ?? "");
    electron.dialog.showErrorBox(
        "Download Folder Failed",
        `${error.message}${error.detail ? `\n\n${error.detail}` : ""}`
    );
}

export function registerDownloadFolderHandler() {
    electron.ipcMain.on("download-folder", async (event, payload: { filePath?: string }) => {
        const senderWindow = electron.BrowserWindow.fromWebContents(event.sender);
        const remoteUri = payload?.filePath;
        let folderName = "download";
        try {
            const parsed = parseWshRemoteUri(remoteUri);
            folderName = getRemotePathBaseName(parsed.remotePath);
        } catch (err) {
            showFolderDownloadError(mapFolderDownloadError("parse", err));
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
            showFolderDownloadError(mapFolderDownloadError("destination", err));
            return;
        }

        const jobInput = buildFolderDownloadTransferJobInput(
            remoteUri,
            result.filePath,
            createDownloadTransferJobId("folder-download")
        );
        downloadTransferTracker.enqueue(jobInput);
        startTrackedFolderDownload(jobInput.id, remoteUri, result.filePath);
    });
}

export function startTrackedFolderDownload(jobId: string, remoteUri: string, destinationPath: string) {
    const plan = buildFolderDownloadPlan(remoteUri, destinationPath);
    downloadTransferTracker.start(jobId);
    const command = plan.transport === "rsync" ? getRsyncPath() : "scp";
    const child = child_process.spawn(command, plan.args, { cwd: plan.cwd, windowsHide: true });
    let stderr = "";
    let settled = false;
    registerTransferCancelHandle(jobId, () => {
        child.kill();
    });

    const failTransfer = (kind: FolderDownloadFailureKind, err: unknown) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTransferCancelHandle(jobId);
        const error = mapFolderDownloadError(kind, err);
        downloadTransferTracker.fail(jobId, error);
        showFolderDownloadError(error);
    };

    child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
    });
    child.on("error", (err) => {
        if (plan.transport === "scp" && (err as NodeJS.ErrnoException).code === "ENOENT") {
            failTransfer("start", new Error("Windows OpenSSH Client (scp.exe) is required for folder downloads."));
            return;
        }
        failTransfer("start", err);
    });
    child.on("close", (code, signal) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTransferCancelHandle(jobId);
        if (signal) {
            downloadTransferTracker.cancel(jobId);
            return;
        }
        if (code === 0) {
            downloadTransferTracker.complete(jobId);
            new electron.Notification({
                title: "Folder Download Complete",
                body: path.basename(destinationPath),
            }).show();
            return;
        }
        const detail = stderr.trim() || `${plan.transport} exited with code ${code}.`;
        const error = mapFolderDownloadError("exit", new Error(detail));
        downloadTransferTracker.fail(jobId, error);
        showFolderDownloadError(error);
    });
}
