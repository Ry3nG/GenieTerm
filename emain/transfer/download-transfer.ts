import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
    cancelTransferJob,
    clearInactiveTransferJobs,
    completeTransferJob,
    createTransferQueue,
    enqueueTransferJob,
    failTransferJob,
    findTransferJob,
    getTransferJob,
    recoverTransferQueue,
    requestTransferJobCancel,
    retryTransferJob,
    startTransferJob,
    updateTransferProgress,
    type TransferError,
    type TransferJob,
    type TransferJobInput,
    type TransferProgress,
    type TransferQueue,
} from "../../frontend/util/transferqueue";
import { getRemotePathBaseName, parseTransferPath } from "../../frontend/util/transferutil";

export const NativeDownloadDestination = "electron://native-download";
export const ProgressNotifyIntervalMs = 250;

type NowFn = () => number;

export type NativeDownloadStateResult =
    | { status: "completed" }
    | { status: "canceled"; error: TransferError }
    | { status: "failed"; error: TransferError };

export type DownloadTransferTracker = {
    enqueue(input: TransferJobInput): TransferJob;
    start(jobId: string): TransferJob;
    complete(jobId: string): TransferJob;
    fail(jobId: string, error: TransferError): TransferJob;
    cancel(jobId: string): TransferJob;
    requestCancel(jobId: string): TransferJob;
    retry(jobId: string): TransferJob;
    updateProgress(jobId: string, progress: Partial<TransferProgress>): TransferJob | undefined;
    clearInactive(): TransferQueue;
    getJob(jobId: string): TransferJob;
    findJob(jobId: string): TransferJob | undefined;
    getQueue(): TransferQueue;
    hydrate(queue: TransferQueue): TransferQueue;
    subscribe(listener: TransferQueueListener): () => void;
};

export type TransferQueueListener = (queue: TransferQueue) => void;

let nextDownloadTransferSeq = 0;

export function createDownloadTransferJobId(prefix = "download"): string {
    nextDownloadTransferSeq += 1;
    return `${prefix}-${Date.now()}-${nextDownloadTransferSeq}`;
}

export function buildLocalFileUri(localPath: string): string {
    return pathToFileURL(localPath).href;
}

export function buildFileDownloadTransferJobInput(source: string, id: string): TransferJobInput {
    return {
        id,
        operation: "download",
        itemType: "file",
        transport: "wsh",
        source,
        destination: NativeDownloadDestination,
        label: getTransferLabel(source),
    };
}

export function createDownloadTransferTracker(
    nowFn: NowFn = () => Date.now(),
    progressIntervalMs = ProgressNotifyIntervalMs
): DownloadTransferTracker {
    let queue = createTransferQueue();
    const listeners = new Set<TransferQueueListener>();
    let progressTimer: ReturnType<typeof setTimeout> = null;
    let lastNotifyAt = Number.NEGATIVE_INFINITY;

    function notify() {
        if (progressTimer != null) {
            clearTimeout(progressTimer);
            progressTimer = null;
        }
        lastNotifyAt = nowFn();
        for (const listener of listeners) {
            callListener(listener);
        }
    }

    function callListener(listener: TransferQueueListener) {
        try {
            listener(queue);
        } catch (error) {
            console.error("transfer queue listener failed", error);
        }
    }

    function scheduleProgressNotify() {
        if (progressTimer != null) {
            return;
        }
        const waitMs = lastNotifyAt + progressIntervalMs - nowFn();
        if (waitMs <= 0) {
            notify();
            return;
        }
        progressTimer = setTimeout(notify, waitMs);
    }

    function commit(nextQueue: TransferQueue): TransferQueue {
        queue = nextQueue;
        notify();
        return queue;
    }

    return {
        enqueue(input) {
            commit(enqueueTransferJob(queue, input, nowFn()));
            return getTransferJob(queue, input.id);
        },
        start(jobId) {
            commit(startTransferJob(queue, jobId, nowFn()));
            return getTransferJob(queue, jobId);
        },
        complete(jobId) {
            commit(completeTransferJob(queue, jobId, nowFn()));
            return getTransferJob(queue, jobId);
        },
        fail(jobId, error) {
            commit(failTransferJob(queue, jobId, error, nowFn()));
            return getTransferJob(queue, jobId);
        },
        cancel(jobId) {
            commit(cancelTransferJob(queue, jobId, nowFn()));
            return getTransferJob(queue, jobId);
        },
        requestCancel(jobId) {
            commit(requestTransferJobCancel(queue, jobId, nowFn()));
            return getTransferJob(queue, jobId);
        },
        retry(jobId) {
            commit(retryTransferJob(queue, jobId, nowFn()));
            return getTransferJob(queue, jobId);
        },
        updateProgress(jobId, progress) {
            const job = findTransferJob(queue, jobId);
            if (job?.status !== "running") {
                return job;
            }
            queue = updateTransferProgress(queue, jobId, progress, nowFn());
            scheduleProgressNotify();
            return getTransferJob(queue, jobId);
        },
        clearInactive() {
            return commit(clearInactiveTransferJobs(queue));
        },
        getJob(jobId) {
            return getTransferJob(queue, jobId);
        },
        findJob(jobId) {
            return findTransferJob(queue, jobId);
        },
        getQueue() {
            return queue;
        },
        hydrate(nextQueue) {
            return commit(nextQueue);
        },
        subscribe(listener) {
            listeners.add(listener);
            callListener(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

// Transfer state changes are driven from Electron event listeners (child "close", DownloadItem "done", ...).
// A throw there becomes an uncaughtException that quits the app, so callers route transitions through this guard.
export function runTransferUpdate<T>(label: string, update: () => T): T | undefined {
    try {
        return update();
    } catch (error) {
        console.error(`transfer update failed (${label})`, error);
        return undefined;
    }
}

export const downloadTransferTracker = createDownloadTransferTracker();

let transferPersistenceConfigured = false;
let flushConfiguredTransferQueue = () => {};

export function readTransferQueueSnapshot(filePath: string, now: number): TransferQueue {
    try {
        return recoverTransferQueue(JSON.parse(fs.readFileSync(filePath, "utf8")), now);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return createTransferQueue();
        }
        throw error;
    }
}

export function writeTransferQueueSnapshot(filePath: string, queue: TransferQueue): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(queue), { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
}

export function makeTransferQueuePersistence(filePath: string, delayMs = ProgressNotifyIntervalMs) {
    let pendingQueue: TransferQueue | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
        if (timer != null) {
            clearTimeout(timer);
            timer = null;
        }
        if (pendingQueue == null) {
            return;
        }
        const queue = pendingQueue;
        pendingQueue = null;
        try {
            writeTransferQueueSnapshot(filePath, queue);
        } catch (error) {
            console.error("Could not save transfer queue", error);
        }
    };
    const update = (queue: TransferQueue) => {
        pendingQueue = queue;
        if (timer == null) {
            timer = setTimeout(flush, delayMs);
        }
    };
    return { update, flush };
}

export function flushDownloadTransferPersistence(): void {
    flushConfiguredTransferQueue();
}

export function configureDownloadTransferPersistence(filePath: string): void {
    if (transferPersistenceConfigured) {
        return;
    }
    transferPersistenceConfigured = true;
    try {
        downloadTransferTracker.hydrate(readTransferQueueSnapshot(filePath, Date.now()));
    } catch (error) {
        console.error("Could not restore transfer queue", error);
    }
    const persistence = makeTransferQueuePersistence(filePath);
    flushConfiguredTransferQueue = persistence.flush;
    downloadTransferTracker.subscribe(persistence.update);
}

export function mapNativeDownloadState(state: string): NativeDownloadStateResult {
    if (state === "completed") {
        return { status: "completed" };
    }
    if (state === "cancelled") {
        return {
            status: "canceled",
            error: { code: "download_canceled", message: "Download canceled", retryable: true },
        };
    }
    return {
        status: "failed",
        error: {
            code: "native_download_failed",
            message: `Native download ${state || "failed"}`,
            retryable: true,
        },
    };
}

function getTransferLabel(source: string): string {
    try {
        return parseTransferPath(source).basename;
    } catch {
        return getRemotePathBaseName(source);
    }
}
