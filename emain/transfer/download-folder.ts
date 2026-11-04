// Copyright 2026, GenieTerm. Apache-2.0.

import * as electron from "electron";
import fs from "fs";
import * as path from "path";
import { formatTransferBytes } from "../../frontend/util/transferdisplay";
import type { TransferError, TransferJobInput } from "../../frontend/util/transferqueue";
import {
    getRemotePathBaseName,
    isWslConnection,
    parseSshConnection,
    parseWshRemoteUri,
} from "../../frontend/util/transferutil";
import {
    buildLocalFileUri,
    createDownloadTransferJobId,
    downloadTransferTracker,
    runTransferUpdate,
} from "./download-transfer";
import { clearTransferCancelHandle, registerTransferCancelHandle } from "./transfer-handles";

type ExistsFn = (candidate: string) => boolean;
export type FolderDownloadRunner = (
    data: CommandFileDownloadDirectoryData
) => AsyncGenerator<FileTransferProgress, void, boolean>;
export type FolderDownloadFailureKind = "parse" | "unsupported" | "destination" | "start" | "exit" | "canceled";
export type FolderDownloadError = TransferError & { detail?: string };
export type FolderDestinationState = "missing" | "empty-folder" | "non-empty-folder" | "not-folder";

let runFolderDownload: FolderDownloadRunner;

export function buildFolderDownloadTransferJobInput(
    remoteUri: string,
    destinationPath: string,
    id: string
): TransferJobInput {
    const parsed = parseWshRemoteUri(remoteUri);
    return {
        id,
        operation: "download",
        itemType: "folder",
        transport: "wsh",
        source: remoteUri,
        destination: buildLocalFileUri(destinationPath),
        label: getRemotePathBaseName(parsed.remotePath),
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
            case "unsupported":
                return {
                    code: "unsupported_connection",
                    message: "Folder download is not available for this connection.",
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

export function inspectFolderDestination(destinationPath: string, fsApi: typeof fs = fs): FolderDestinationState {
    let stat: fs.Stats;
    try {
        stat = fsApi.statSync(destinationPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return "missing";
        }
        throw err;
    }
    if (!stat.isDirectory()) {
        return "not-folder";
    }
    return fsApi.readdirSync(destinationPath).length === 0 ? "empty-folder" : "non-empty-folder";
}

export function getUniqueDestinationPath(destinationPath: string, existsFn: ExistsFn = fs.existsSync): string {
    const parsed = path.parse(destinationPath);
    for (let index = 1; index < 10000; index++) {
        const candidate = path.join(parsed.dir, `${parsed.base} (${index})`);
        if (!existsFn(candidate)) {
            return candidate;
        }
    }
    throw new Error(`Could not find a free folder name next to ${destinationPath}`);
}

function showFolderDownloadError(error: FolderDownloadError) {
    console.error(error.message, error.detail ?? "");
    electron.dialog.showErrorBox(
        "Download Folder Failed",
        `${error.message}${error.detail ? `\n\n${error.detail}` : ""}`
    );
}

async function confirmFolderDestination(
    senderWindow: electron.BrowserWindow,
    destinationPath: string
): Promise<string | null> {
    const state = inspectFolderDestination(destinationPath);
    if (state === "not-folder") {
        throw new Error(`Destination exists and is not a folder: ${destinationPath}`);
    }
    if (state !== "non-empty-folder") {
        return destinationPath;
    }
    const uniquePath = getUniqueDestinationPath(destinationPath);
    const options: electron.MessageBoxOptions = {
        type: "question",
        title: "Folder Already Exists",
        message: `"${path.basename(destinationPath)}" already exists and is not empty.`,
        detail: "Merging copies the remote folder into it and overwrites files that have the same name.",
        buttons: [`Download as "${path.basename(uniquePath)}"`, "Merge and Overwrite", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
    };
    const { response } =
        senderWindow != null
            ? await electron.dialog.showMessageBox(senderWindow, options)
            : await electron.dialog.showMessageBox(options);
    if (response === 0) {
        return uniquePath;
    }
    if (response === 1) {
        return destinationPath;
    }
    return null;
}

async function handleDownloadFolderRequest(sender: electron.WebContents, remoteUri: string) {
    const senderWindow = electron.BrowserWindow.fromWebContents(sender);
    let folderName = "download";
    try {
        const parsed = parseWshRemoteUri(remoteUri);
        if (isWslConnection(parsed.connection)) {
            showFolderDownloadError(
                mapFolderDownloadError(
                    "unsupported",
                    new Error("WSL folders can be copied from File Explorer at \\\\wsl$\\<distro>.")
                )
            );
            return;
        }
        parseSshConnection(parsed.connection);
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

    let destinationPath: string;
    try {
        destinationPath = await confirmFolderDestination(senderWindow, result.filePath);
        if (destinationPath == null) {
            return;
        }
    } catch (err) {
        showFolderDownloadError(mapFolderDownloadError("destination", err));
        return;
    }

    const jobInput = buildFolderDownloadTransferJobInput(
        remoteUri,
        destinationPath,
        createDownloadTransferJobId("folder-download")
    );
    downloadTransferTracker.enqueue(jobInput);
    await startTrackedFolderDownload(jobInput.id, remoteUri, destinationPath);
}

export function registerDownloadFolderHandler(options: { run: FolderDownloadRunner }) {
    runFolderDownload = options.run;
    electron.ipcMain.on("download-folder", (event, payload: { filePath?: string }) => {
        handleDownloadFolderRequest(event.sender, payload?.filePath).catch((err) => {
            showFolderDownloadError(mapFolderDownloadError("start", err));
        });
    });
}

function failFolderDownload(jobId: string, error: FolderDownloadError) {
    runTransferUpdate("fail folder download", () => downloadTransferTracker.fail(jobId, error));
    showFolderDownloadError(error);
}

// Expects a queued job (fresh or retried); it only becomes "running" once the transfer starts.
export async function startTrackedFolderDownload(
    jobId: string,
    remoteUri: string,
    destinationPath: string,
    run: FolderDownloadRunner = runFolderDownload
) {
    const job = downloadTransferTracker.findJob(jobId);
    if (job?.status !== "queued") return;
    const attempt = job.attempt;
    const isCurrent = () => downloadTransferTracker.findJob(jobId)?.attempt === attempt;
    let cancelRequested = false;
    let stream: AsyncGenerator<FileTransferProgress, void, boolean>;
    try {
        downloadTransferTracker.start(jobId);
        stream = run({ srcuri: remoteUri, destpath: destinationPath });
        registerTransferCancelHandle(jobId, () => {
            cancelRequested = true;
        });
        while (true) {
            const next = await stream.next();
            if (next.done === true) throw new Error("Folder transfer ended without a completion response.");
            if (!isCurrent()) {
                await stream.next(true);
                return;
            }
            const progress = next.value;
            downloadTransferTracker.updateProgress(jobId, {
                bytesTransferred: progress.bytestransferred,
                message: `${formatTransferBytes(progress.bytestransferred)} · ${progress.filescompleted} files copied${progress.filesskipped ? ` · ${progress.filesskipped} links or special files skipped` : ""}`,
            });
            if (progress.done) {
                downloadTransferTracker.complete(jobId);
                runTransferUpdate("folder download notification", () => {
                    if (electron.Notification.isSupported()) {
                        new electron.Notification({
                            title: "Folder Download Complete",
                            body: path.basename(destinationPath),
                        }).show();
                    }
                });
                return;
            }
            if (cancelRequested) {
                await stream.next(true);
                runTransferUpdate("cancel folder download", () => downloadTransferTracker.cancel(jobId));
                return;
            }
        }
    } catch (error) {
        if (!isCurrent()) return;
        if (cancelRequested) {
            runTransferUpdate("cancel folder download", () => downloadTransferTracker.cancel(jobId));
        } else {
            failFolderDownload(jobId, mapFolderDownloadError("exit", error));
        }
    } finally {
        if (isCurrent()) clearTransferCancelHandle(jobId);
        await stream?.return();
    }
}
