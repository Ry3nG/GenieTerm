// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { expandHomePath } from "@/util/filepath";
import * as electron from "electron";
import { FastAverageColor } from "fast-average-color";
import fs from "fs";
import * as child_process from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "path";
import { PNG } from "pngjs";
import { Readable } from "stream";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import type { CommandLibraryChange } from "../frontend/util/commandlibrary";
import { getWebServerEndpoint } from "../frontend/util/endpoints";
import * as keyutil from "../frontend/util/keyutil";
import {
    isInactiveTransferStatus,
    type TransferError,
    type TransferJob,
    type TransferJobInput,
} from "../frontend/util/transferqueue";
import { fireAndForget, parseDataUrl } from "../frontend/util/util";
import { applyDockIconVariant, getAppIconPath, normalizeAppIconVariant, type AppIconVariant } from "./app-icon";
import { makeCommandLibraryStore } from "./command-library";
import {} from "./emain-activity";
import { callWithOriginalXdgCurrentDesktopAsync, getWaveDataDir, unamePlatform } from "./emain-platform";
import { clearTabCache, getWaveTabViewByWebContentsId } from "./emain-tabview";
import { decreaseZoomLevel, handleCtrlShiftState, increaseZoomLevel, resetZoomLevel } from "./emain-util";
import { getWaveVersion } from "./emain-wavesrv";
import {
    createNewWaveWindow,
    getAllWaveWindows,
    getWaveWindowByWebContentsId,
    relaunchBrowserWindows,
} from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import { safeOpenExternal } from "./safe-open";
import { downloadDestinationExists, planBatchDownloads, type BatchDownloadItem } from "./transfer/download-batch";
import {
    buildFolderDownloadTransferJobInput,
    registerDownloadFolderHandler,
    startTrackedFolderDownload,
} from "./transfer/download-folder";
import {
    buildFileDownloadTransferJobInput,
    buildLocalFileUri,
    configureDownloadTransferPersistence,
    createDownloadTransferJobId,
    downloadTransferTracker,
    flushDownloadTransferPersistence,
    mapNativeDownloadState,
    NativeDownloadDestination,
    runTransferUpdate,
} from "./transfer/download-transfer";
import {
    clearTransferCancelHandle,
    invokeTransferCancelHandle,
    registerTransferCancelHandle,
} from "./transfer/transfer-handles";
import { updater } from "./updater";

const electronApp = electron.app;

let webviewFocusId: number = null;
let webviewKeys: string[] = [];
const TransferQueueGetChannel = "transfer-queue:get";
const TransferQueueUpdateChannel = "transfer-queue:update";
const TransferQueueClearChannel = "transfer-queue:clear";
const TransferQueueCancelChannel = "transfer-queue:cancel";
const TransferQueueRetryChannel = "transfer-queue:retry";
const TransferJobEnqueueChannel = "transfer-job:enqueue";
const TransferJobBeginChannel = "transfer-job:begin";
const TransferJobFinishChannel = "transfer-job:finish";
const transferQueueSubscribers = new Map<number, electron.WebContents>();
const rendererTransferJobOwners = new Map<string, number>();
const rendererTransferOwnerIds = new Set<number>();
const nativeDownloadSessions = new WeakSet<electron.Session>();
const pendingNativeDownloads = new Map<string, string>();
let transferQueueBridgeRegistered = false;

type RendererTransferJobOutcome =
    | { status: "completed" }
    | { status: "failed"; error: TransferError }
    | { status: "canceled"; error?: TransferError };

type UrlInSessionResult = {
    stream: Readable;
    mimeType: string;
    fileName: string;
};

function getSingleHeaderVal(headers: Record<string, string | string[]>, key: string): string {
    const val = headers[key];
    if (val == null) {
        return null;
    }
    if (Array.isArray(val)) {
        return val[0];
    }
    return val;
}

function cleanMimeType(mimeType: string): string {
    if (mimeType == null) {
        return null;
    }
    const parts = mimeType.split(";");
    return parts[0].trim();
}

function getFileNameFromUrl(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const filename = pathname.substring(pathname.lastIndexOf("/") + 1);
        return filename;
    } catch (e) {
        return null;
    }
}

function getUrlInSession(session: Electron.Session, url: string): Promise<UrlInSessionResult> {
    return new Promise((resolve, reject) => {
        if (url.startsWith("data:")) {
            try {
                const parsed = parseDataUrl(url);
                const buffer = Buffer.from(parsed.buffer);
                const readable = Readable.from(buffer);
                resolve({ stream: readable, mimeType: parsed.mimeType, fileName: "image" });
            } catch (err) {
                return reject(err);
            }
            return;
        }
        const request = electron.net.request({
            url,
            method: "GET",
            session,
        });
        const readable = new Readable({
            read() {},
        });
        request.on("response", (response) => {
            const statusCode = response.statusCode;
            if (statusCode < 200 || statusCode >= 300) {
                readable.destroy();
                request.abort();
                reject(new Error(`HTTP request failed with status ${statusCode}: ${response.statusMessage || ""}`));
                return;
            }

            const mimeType = cleanMimeType(getSingleHeaderVal(response.headers, "content-type"));
            const fileName = getFileNameFromUrl(url) || "image";
            response.on("data", (chunk) => {
                readable.push(chunk);
            });
            response.on("end", () => {
                readable.push(null);
                resolve({ stream: readable, mimeType, fileName });
            });
            response.on("error", (err) => {
                readable.destroy(err);
                reject(err);
            });
        });
        request.on("error", (err) => {
            readable.destroy(err);
            reject(err);
        });
        request.end();
    });
}

function saveImageFileWithNativeDialog(
    sender: electron.WebContents,
    defaultFileName: string,
    mimeType: string,
    readStream: Readable
) {
    if (defaultFileName == null || defaultFileName == "") {
        defaultFileName = "image";
    }
    const ww = electron.BrowserWindow.fromWebContents(sender);
    if (ww == null) {
        readStream.destroy();
        return;
    }
    const mimeToExtension: { [key: string]: string } = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
        "image/heic": "heic",
        "image/svg+xml": "svg",
    };
    function addExtensionIfNeeded(fileName: string, mimeType: string): string {
        const extension = mimeToExtension[mimeType];
        if (!path.extname(fileName) && extension) {
            return `${fileName}.${extension}`;
        }
        return fileName;
    }
    defaultFileName = addExtensionIfNeeded(defaultFileName, mimeType);
    electron.dialog
        .showSaveDialog(ww, {
            title: "Save Image",
            defaultPath: defaultFileName,
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "heic"] }],
        })
        .then((file) => {
            if (file.canceled) {
                readStream.destroy();
                return;
            }
            const writeStream = fs.createWriteStream(file.filePath);
            readStream.pipe(writeStream);
            writeStream.on("finish", () => {
                console.log("saved file", file.filePath);
            });
            writeStream.on("error", (err) => {
                console.log("error saving file (writeStream)", err);
                readStream.destroy();
            });
            readStream.on("error", (err) => {
                console.error("error saving file (readStream)", err);
                writeStream.destroy();
            });
        })
        .catch((err) => {
            console.log("error trying to save file", err);
        });
}

function registerTransferQueueSubscriber(webContents: electron.WebContents) {
    transferQueueSubscribers.set(webContents.id, webContents);
    webContents.once("destroyed", () => {
        transferQueueSubscribers.delete(webContents.id);
    });
}

function broadcastTransferQueue(queue: ReturnType<typeof downloadTransferTracker.getQueue>) {
    for (const [webContentsId, webContents] of transferQueueSubscribers) {
        if (webContents.isDestroyed()) {
            transferQueueSubscribers.delete(webContentsId);
            continue;
        }
        webContents.send(TransferQueueUpdateChannel, queue);
    }
}

// Renderer-driven jobs (uploads) only make progress while their renderer is alive, so they are failed as
// interrupted when it goes away instead of staying "running" forever.
function setRendererTransferJobOwner(jobId: string, webContents: electron.WebContents) {
    rendererTransferJobOwners.set(jobId, webContents.id);
    if (rendererTransferOwnerIds.has(webContents.id)) {
        return;
    }
    const webContentsId = webContents.id;
    rendererTransferOwnerIds.add(webContentsId);
    webContents.once("destroyed", () => {
        rendererTransferOwnerIds.delete(webContentsId);
        failRendererTransferJobs(webContentsId);
    });
}

function failRendererTransferJobs(webContentsId: number) {
    for (const [jobId, ownerId] of rendererTransferJobOwners) {
        if (ownerId !== webContentsId) {
            continue;
        }
        rendererTransferJobOwners.delete(jobId);
        const job = downloadTransferTracker.findJob(jobId);
        if (job == null || isInactiveTransferStatus(job.status)) {
            continue;
        }
        runTransferUpdate("fail interrupted renderer transfer", () =>
            downloadTransferTracker.fail(jobId, {
                code: "transfer_interrupted",
                message: "Transfer was interrupted because its window closed.",
                retryable: true,
            })
        );
    }
}

function ensureNativeDownloadListener(session: electron.Session) {
    if (nativeDownloadSessions.has(session)) {
        return;
    }
    nativeDownloadSessions.add(session);
    session.on("will-download", (_event, item) => {
        const jobId = pendingNativeDownloads.get(item.getURL());
        if (jobId == null) {
            return;
        }
        pendingNativeDownloads.delete(item.getURL());
        runTransferUpdate("attach native download", () => attachNativeDownloadItem(jobId, item));
    });
}

function attachNativeDownloadItem(jobId: string, item: electron.DownloadItem) {
    if (downloadTransferTracker.findJob(jobId)?.status !== "running") {
        item.cancel();
        return;
    }
    const destination = downloadTransferTracker.findJob(jobId)?.destination;
    if (destination?.startsWith("file://")) item.setSavePath(fileURLToPath(destination));
    registerTransferCancelHandle(jobId, () => item.cancel());
    item.on("updated", () => {
        runTransferUpdate("native download progress", () => {
            const totalBytes = item.getTotalBytes();
            downloadTransferTracker.updateProgress(jobId, {
                bytesTransferred: item.getReceivedBytes(),
                ...(totalBytes > 0 ? { totalBytes } : {}),
            });
        });
    });
    item.once("done", (_doneEvent, state) => {
        clearTransferCancelHandle(jobId);
        runTransferUpdate("finish native download", () => {
            const result = mapNativeDownloadState(state);
            if (result.status === "completed") {
                downloadTransferTracker.complete(jobId);
            } else if (result.status === "canceled") {
                downloadTransferTracker.cancel(jobId);
            } else {
                downloadTransferTracker.fail(jobId, result.error);
            }
        });
    });
}

// Each attempt gets its own URL token so concurrent downloads of the same file each claim their own DownloadItem.
function startTrackedFileDownload(jobId: string, filePath: string, sender: electron.WebContents): void {
    const attempt = downloadTransferTracker.findJob(jobId)?.attempt ?? 1;
    const baseName = encodeURIComponent(path.basename(filePath));
    const streamingUrl =
        getWebServerEndpoint() +
        "/wave/stream-file/" +
        baseName +
        "?path=" +
        encodeURIComponent(filePath) +
        "&transferjob=" +
        encodeURIComponent(`${jobId}.${attempt}`);
    downloadTransferTracker.start(jobId);
    try {
        ensureNativeDownloadListener(sender.session);
        pendingNativeDownloads.set(streamingUrl, jobId);
        sender.downloadURL(streamingUrl);
    } catch (error) {
        pendingNativeDownloads.delete(streamingUrl);
        downloadTransferTracker.fail(jobId, {
            code: "native_download_failed",
            message: "Could not start native download.",
            detail: String(error),
            retryable: true,
        });
    }
}

function startRetriedTransferJob(job: TransferJob, sender: electron.WebContents) {
    if ((job.transport === "rsync" || job.transport === "scp") && job.destination.startsWith("file://")) {
        void startTrackedFolderDownload(job.id, job.source, fileURLToPath(job.destination));
        return;
    }
    if (
        job.operation === "download" &&
        job.transport === "wsh" &&
        (job.destination === NativeDownloadDestination || job.destination.startsWith("file://"))
    ) {
        startTrackedFileDownload(job.id, job.source, sender);
        return;
    }
    if (job.operation === "upload" || job.operation === "copy") {
        // The renderer that asked for the retry re-runs the copy and reports back via begin/finish.
        setRendererTransferJobOwner(job.id, sender);
        return;
    }
    throw new Error(`No retry handler for ${job.operation} via ${job.transport}`);
}

function registerTransferQueueBridge() {
    if (transferQueueBridgeRegistered) {
        return;
    }
    transferQueueBridgeRegistered = true;
    configureDownloadTransferPersistence(path.join(getWaveDataDir(), "transfers.json"));
    electronApp.on("before-quit", flushDownloadTransferPersistence);

    electron.ipcMain.handle(TransferQueueGetChannel, (event) => {
        registerTransferQueueSubscriber(event.sender);
        return downloadTransferTracker.getQueue();
    });
    electron.ipcMain.handle(TransferQueueClearChannel, () => {
        return downloadTransferTracker.clearInactive();
    });
    electron.ipcMain.handle(TransferQueueCancelChannel, (_event, jobId: string) => {
        const job = downloadTransferTracker.findJob(jobId);
        if (job == null || isInactiveTransferStatus(job.status)) {
            return downloadTransferTracker.getQueue();
        }
        if (invokeTransferCancelHandle(jobId)) {
            downloadTransferTracker.cancel(jobId);
        } else if (job.status === "running" && (job.operation === "upload" || job.operation === "copy")) {
            // In-flight RPC copies cannot be interrupted; the renderer skips remaining work and reports the
            // real outcome of the current copy when it finishes.
            downloadTransferTracker.requestCancel(jobId);
        } else {
            downloadTransferTracker.cancel(jobId);
        }
        return downloadTransferTracker.getQueue();
    });
    electron.ipcMain.handle(TransferQueueRetryChannel, (event, jobId: string) => {
        const retried = downloadTransferTracker.retry(jobId);
        try {
            startRetriedTransferJob(retried, event.sender);
        } catch (err) {
            console.error("retry transfer failed", err);
            runTransferUpdate("fail retried transfer", () =>
                downloadTransferTracker.fail(jobId, {
                    code: "transfer_retry_failed",
                    message: "Could not retry the transfer.",
                    detail: err instanceof Error ? err.message : String(err),
                    retryable: false,
                })
            );
            throw err;
        }
        return downloadTransferTracker.getQueue();
    });
    electron.ipcMain.handle(TransferJobEnqueueChannel, (event, inputs: TransferJobInput[]) => {
        for (const input of inputs ?? []) {
            downloadTransferTracker.enqueue(input);
            setRendererTransferJobOwner(input.id, event.sender);
        }
    });
    electron.ipcMain.handle(TransferJobBeginChannel, (event, jobId: string) => {
        if (downloadTransferTracker.findJob(jobId)?.status !== "queued") {
            return false;
        }
        downloadTransferTracker.start(jobId);
        setRendererTransferJobOwner(jobId, event.sender);
        return true;
    });
    electron.ipcMain.handle(TransferJobFinishChannel, (_event, jobId: string, outcome: RendererTransferJobOutcome) => {
        rendererTransferJobOwners.delete(jobId);
        const job = downloadTransferTracker.findJob(jobId);
        if (job == null || isInactiveTransferStatus(job.status)) {
            return;
        }
        if (outcome?.status === "completed") {
            downloadTransferTracker.complete(jobId);
            return;
        }
        if (outcome?.status === "canceled") {
            downloadTransferTracker.cancel(jobId);
            return;
        }
        downloadTransferTracker.fail(
            jobId,
            outcome?.error ?? { code: "transfer_failed", message: "Transfer failed.", retryable: true }
        );
    });
    downloadTransferTracker.subscribe((queue) => {
        broadcastTransferQueue(queue);
    });
}

function registerCommandLibraryBridge() {
    const store = makeCommandLibraryStore(path.join(getWaveDataDir(), "command-library.json"));
    const subscribers = new Map<number, electron.WebContents>();
    electron.ipcMain.handle("command-library:get", (event) => {
        if (!getWaveTabViewByWebContentsId(event.sender.id)) {
            throw new Error("No terminal tab found.");
        }
        if (!subscribers.has(event.sender.id)) {
            subscribers.set(event.sender.id, event.sender);
            event.sender.once("destroyed", () => subscribers.delete(event.sender.id));
        }
        return store.get();
    });
    electron.ipcMain.handle("command-library:change", (event, change: CommandLibraryChange) => {
        if (!getWaveTabViewByWebContentsId(event.sender.id)) {
            throw new Error("No terminal tab found.");
        }
        store.update(change);
    });
    store.subscribe((library) => {
        for (const contents of subscribers.values()) {
            if (!contents.isDestroyed()) {
                contents.send("command-library:changed", library.revision);
            }
        }
    });
    electronApp.on("before-quit", () => {
        try {
            store.flush();
        } catch (error) {
            console.error("Could not save command library", error);
        }
    });
}

export function initIpcHandlers() {
    registerTransferQueueBridge();
    registerCommandLibraryBridge();

    electron.ipcMain.on("open-external", (event, url) => {
        if (url && typeof url === "string") {
            fireAndForget(() =>
                safeOpenExternal(url).catch((err) => {
                    console.error(`Failed to open URL ${url}:`, err);
                })
            );
        } else {
            console.error("Invalid URL received in open-external event:", url);
        }
    });

    electron.ipcMain.on("webview-image-contextmenu", (event: electron.IpcMainEvent, payload: { src: string }) => {
        const menu = new electron.Menu();
        const win = getWaveWindowByWebContentsId(event.sender.hostWebContents?.id);
        if (win == null) {
            return;
        }
        menu.append(
            new electron.MenuItem({
                label: "Save Image",
                click: () => {
                    const resultP = getUrlInSession(event.sender.session, payload.src);
                    resultP
                        .then((result) => {
                            saveImageFileWithNativeDialog(
                                event.sender.hostWebContents,
                                result.fileName,
                                result.mimeType,
                                result.stream
                            );
                        })
                        .catch((e) => {
                            console.log("error getting image", e);
                        });
                },
            })
        );
        menu.popup();
    });

    electron.ipcMain.on("webview-mouse-navigate", (event: electron.IpcMainEvent, direction: string) => {
        if (direction === "back") {
            event.sender.navigationHistory.goBack();
        } else if (direction === "forward") {
            event.sender.navigationHistory.goForward();
        }
    });

    electron.ipcMain.on("download", (event, payload) => {
        const jobInput = buildFileDownloadTransferJobInput(
            payload.filePath,
            createDownloadTransferJobId("file-download")
        );
        runTransferUpdate("start native download", () => {
            downloadTransferTracker.enqueue(jobInput);
            startTrackedFileDownload(jobInput.id, jobInput.source, event.sender);
        });
    });
    electron.ipcMain.handle("download-files", async (event, items: BatchDownloadItem[]) => {
        planBatchDownloads(items, "", "keep", () => false);
        const senderWindow = electron.BrowserWindow.fromWebContents(event.sender);
        const options: electron.OpenDialogOptions = {
            title: "Download selected items",
            buttonLabel: "Download here",
            properties: ["openDirectory", "createDirectory"],
        };
        try {
            options.defaultPath = electronApp.getPath("downloads");
        } catch {
            // Windows profiles without a Downloads known folder can still use the native picker.
        }
        const destination = senderWindow
            ? await electron.dialog.showOpenDialog(senderWindow, options)
            : await electron.dialog.showOpenDialog(options);
        if (destination.canceled || !destination.filePaths[0]) return false;
        const folder = destination.filePaths[0];
        let plans = planBatchDownloads(items, folder, "keep", downloadDestinationExists);
        const conflicts = plans.filter((plan) => path.basename(plan.destination) !== plan.label).length;
        if (conflicts > 0) {
            const confirmation: electron.MessageBoxOptions = {
                type: "question",
                title: "Some names already exist",
                message: `${conflicts} selected items have a name conflict.`,
                detail: "Keep both adds a number to each conflicting name. Skip existing leaves those destination items unchanged.",
                buttons: ["Keep both", "Skip existing", "Cancel"],
                defaultId: 0,
                cancelId: 2,
                noLink: true,
            };
            const choice = senderWindow
                ? await electron.dialog.showMessageBox(senderWindow, confirmation)
                : await electron.dialog.showMessageBox(confirmation);
            if (choice.response === 2) return false;
            plans = planBatchDownloads(
                items,
                folder,
                choice.response === 1 ? "skip" : "keep",
                downloadDestinationExists
            );
        }
        const groupId = createDownloadTransferJobId("batch");
        const jobs = plans.map((plan) => ({
            ...(plan.isdir
                ? buildFolderDownloadTransferJobInput(
                      plan.path,
                      plan.destination,
                      createDownloadTransferJobId("folder-download")
                  )
                : {
                      ...buildFileDownloadTransferJobInput(plan.path, createDownloadTransferJobId("file-download")),
                      destination: buildLocalFileUri(plan.destination),
                  }),
            groupId,
        }));
        jobs.forEach((job) => downloadTransferTracker.enqueue(job));
        let next = 0;
        const worker = async () => {
            while (next < jobs.length) {
                const job = jobs[next++];
                if (downloadTransferTracker.findJob(job.id)?.status !== "queued") continue;
                if (event.sender.isDestroyed()) {
                    downloadTransferTracker.cancel(job.id);
                    continue;
                }
                try {
                    if (downloadDestinationExists(fileURLToPath(job.destination))) {
                        downloadTransferTracker.fail(job.id, {
                            code: "destination_changed",
                            message:
                                "The destination appeared while this download was queued. Choose a new destination.",
                            retryable: false,
                        });
                        continue;
                    }
                    if (job.itemType === "folder") {
                        await fs.promises.mkdir(fileURLToPath(job.destination), { recursive: true });
                        await startTrackedFolderDownload(job.id, job.source, fileURLToPath(job.destination));
                    } else startTrackedFileDownload(job.id, job.source, event.sender);
                    if (!isInactiveTransferStatus(downloadTransferTracker.findJob(job.id)?.status))
                        await new Promise<void>((resolve) => {
                            let settled = false;
                            let unsubscribe = () => {};
                            unsubscribe = downloadTransferTracker.subscribe((queue) => {
                                const current = queue.jobs.find((candidate) => candidate.id === job.id);
                                if (current && !isInactiveTransferStatus(current.status)) return;
                                settled = true;
                                unsubscribe();
                                resolve();
                            });
                            if (settled) unsubscribe();
                        });
                } catch (error) {
                    runTransferUpdate("fail batch download", () =>
                        downloadTransferTracker.fail(job.id, {
                            code: "download_failed",
                            message: "Download failed.",
                            detail: String(error),
                            retryable: true,
                        })
                    );
                }
            }
        };
        void Promise.all([worker(), worker(), worker()]).catch((error) =>
            console.error("Batch download failed", error)
        );
        return true;
    });
    registerDownloadFolderHandler({
        resolveConnKeywords: async (connection) => {
            const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
            return fullConfig?.connections?.[connection];
        },
    });

    electron.ipcMain.on("get-cursor-point", (event) => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (tabView == null) {
            event.returnValue = null;
            return;
        }
        const screenPoint = electron.screen.getCursorScreenPoint();
        const windowRect = tabView.getBounds();
        const retVal: Electron.Point = {
            x: screenPoint.x - windowRect.x,
            y: screenPoint.y - windowRect.y,
        };
        event.returnValue = retVal;
    });

    electron.ipcMain.on("get-env", (event, varName) => {
        event.returnValue = process.env[varName] ?? null;
    });

    electron.ipcMain.on("get-about-modal-details", (event) => {
        event.returnValue = getWaveVersion() as AboutModalDetails;
    });

    electron.ipcMain.on("get-zoom-factor", (event) => {
        event.returnValue = event.sender.getZoomFactor();
    });

    const hasBeforeInputRegisteredMap = new Map<number, boolean>();

    electron.ipcMain.on("webview-focus", (event: Electron.IpcMainEvent, focusedId: number) => {
        webviewFocusId = focusedId;
        console.log("webview-focus", focusedId);
        if (focusedId == null) {
            return;
        }
        const parentWc = event.sender;
        const webviewWc = electron.webContents.fromId(focusedId);
        if (webviewWc == null) {
            webviewFocusId = null;
            return;
        }
        if (!hasBeforeInputRegisteredMap.get(focusedId)) {
            hasBeforeInputRegisteredMap.set(focusedId, true);
            webviewWc.on("before-input-event", (e, input) => {
                let waveEvent = keyutil.adaptFromElectronKeyEvent(input);
                handleCtrlShiftState(parentWc, waveEvent);
                if (webviewFocusId != focusedId) {
                    return;
                }
                if (input.type != "keyDown") {
                    return;
                }
                for (let keyDesc of webviewKeys) {
                    if (keyutil.checkKeyPressed(waveEvent, keyDesc)) {
                        e.preventDefault();
                        parentWc.send("reinject-key", waveEvent);
                        console.log("webview reinject-key", keyDesc);
                        return;
                    }
                }
            });
            webviewWc.on("destroyed", () => {
                hasBeforeInputRegisteredMap.delete(focusedId);
            });
        }
    });

    electron.ipcMain.on("register-global-webview-keys", (event, keys: string[]) => {
        webviewKeys = keys ?? [];
    });

    electron.ipcMain.on("set-keyboard-chord-mode", (event) => {
        event.returnValue = null;
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        tabView?.setKeyboardChordMode(true);
    });

    electron.ipcMain.handle("set-is-active", () => {});

    const fac = new FastAverageColor();
    electron.ipcMain.on("update-window-controls-overlay", async (event, rect: Dimensions) => {
        if (unamePlatform === "darwin") return;
        try {
            const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
            if (fullConfig?.settings?.["window:nativetitlebar"] && unamePlatform !== "win32") return;

            const zoomFactor = event.sender.getZoomFactor();
            const electronRect: Electron.Rectangle = {
                x: rect.left * zoomFactor,
                y: rect.top * zoomFactor,
                height: rect.height * zoomFactor,
                width: rect.width * zoomFactor,
            };
            const overlay = await event.sender.capturePage(electronRect);
            const overlayBuffer = overlay.toPNG();
            const png = PNG.sync.read(overlayBuffer);
            const color = fac.prepareResult(fac.getColorFromArray4(png.data));
            const ww = getWaveWindowByWebContentsId(event.sender.id);
            if (ww == null) return;
            ww.setTitleBarOverlay({
                color: unamePlatform === "linux" ? color.rgba : "#00000000",
                symbolColor: color.isDark ? "white" : "black",
            });
        } catch (e) {
            console.error("Error updating window controls overlay:", e);
        }
    });

    electron.ipcMain.on("quicklook", (event, filePath: string) => {
        if (unamePlatform !== "darwin") return;
        child_process.execFile("/usr/bin/qlmanage", ["-p", filePath], (error, stdout, stderr) => {
            if (error) {
                console.error(`Error opening Quick Look: ${error}`);
            }
        });
    });

    electron.ipcMain.handle("clear-webview-storage", async (event, webContentsId: number) => {
        try {
            const wc = electron.webContents.fromId(webContentsId);
            if (
                wc == null ||
                wc.isDestroyed() ||
                wc.getType() !== "webview" ||
                wc.hostWebContents?.id !== event.sender.id
            ) {
                throw new Error("Cannot clear storage for an unrelated webview");
            }
            await wc.session.clearStorageData();
            console.log("Cleared cookies and storage for webContentsId:", webContentsId);
        } catch (e) {
            console.error("Failed to clear cookies and storage:", e);
            throw e;
        }
    });

    electron.ipcMain.on("open-native-path", (event, filePath: string) => {
        console.log("open-native-path", filePath);
        filePath = expandHomePath(filePath, electronApp.getPath("home"), unamePlatform === "win32");
        fireAndForget(() =>
            callWithOriginalXdgCurrentDesktopAsync(() =>
                electron.shell.openPath(filePath).then((excuse) => {
                    if (excuse) console.error(`Failed to open ${filePath} in native application: ${excuse}`);
                })
            )
        );
    });

    electron.ipcMain.on("set-window-init-status", (event, status: "ready" | "wave-ready") => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (tabView != null && tabView.initResolve != null) {
            if (status === "ready") {
                tabView.initResolve();
                if (tabView.savedInitOpts) {
                    console.log("savedInitOpts calling wave-init", tabView.waveTabId);
                    tabView.webContents.send("wave-init", tabView.savedInitOpts);
                }
            } else if (status === "wave-ready") {
                tabView.waveReadyResolve();
                const ww = getWaveWindowByWebContentsId(event.sender.id);
                if (ww != null) {
                    tabView.webContents.send("fullscreen-change", ww.isFullScreen());
                }
            }
            return;
        }

        console.log("set-window-init-status: no window found for webContentsId", event.sender.id);
    });

    electron.ipcMain.on("fe-log", (event, logStr: string) => {
        console.log("fe-log", logStr);
    });

    electron.ipcMain.on("native-paste", (event) => {
        event.sender.paste();
    });

    electron.ipcMain.on("open-new-window", () => fireAndForget(createNewWaveWindow));

    electron.ipcMain.on("do-refresh", (event) => {
        event.sender.reloadIgnoringCache();
    });

    electron.ipcMain.on("app-toggle-devtools", (event) => {
        event.sender.toggleDevTools();
    });

    electron.ipcMain.on("app-reset-zoom", (event) => {
        resetZoomLevel(event.sender);
    });

    electron.ipcMain.on("app-zoom-in", (event) => {
        increaseZoomLevel(event.sender);
    });

    electron.ipcMain.on("app-zoom-out", (event) => {
        decreaseZoomLevel(event.sender);
    });

    electron.ipcMain.on("app-toggle-fullscreen", (event) => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        ww?.setFullScreen(!ww.isFullScreen());
    });

    electron.ipcMain.on("app-clear-tab-cache", () => {
        clearTabCache();
    });

    electron.ipcMain.on("app-relaunch-all-windows", () => {
        fireAndForget(relaunchBrowserWindows);
    });

    electron.ipcMain.on("app-check-for-updates", () => {
        fireAndForget(() => updater?.checkForUpdates(true));
    });

    electron.ipcMain.on("set-app-icon-variant", (_event, variant: AppIconVariant) => {
        const normalized = normalizeAppIconVariant(variant);
        const iconPath = getAppIconPath(normalized);
        applyDockIconVariant(normalized);
        for (const win of getAllWaveWindows()) {
            if (!win.isDestroyed()) {
                win.setIcon(iconPath);
            }
        }
    });

    electron.ipcMain.handle("save-text-file", async (event, fileName: string, content: string) => {
        const ww = electron.BrowserWindow.fromWebContents(event.sender);
        if (ww == null) {
            return false;
        }
        const result = await electron.dialog.showSaveDialog(ww, {
            title: "Save Scrollback",
            defaultPath: fileName || "session.log",
            filters: [{ name: "Text Files", extensions: ["txt", "log"] }],
        });
        if (result.canceled || !result.filePath) {
            return false;
        }
        try {
            await fs.promises.writeFile(result.filePath, content, "utf-8");
            console.log("saved scrollback to", result.filePath);
            return true;
        } catch (err) {
            console.error("error saving scrollback file", err);
            return false;
        }
    });
}
