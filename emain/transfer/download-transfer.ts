import {
    cancelTransferJob,
    clearInactiveTransferJobs,
    completeTransferJob,
    createTransferQueue,
    enqueueTransferJob,
    failTransferJob,
    getTransferJob,
    retryTransferJob,
    recoverTransferQueue,
    startTransferJob,
    type TransferError,
    type TransferJob,
    type TransferJobInput,
    type TransferQueue,
} from "../../frontend/util/transferqueue";
import fs from "node:fs";
import path from "node:path";
import { getRemotePathBaseName, parseTransferPath } from "../../frontend/util/transferutil";

export const NativeDownloadDestination = "electron://native-download";

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
    retry(jobId: string): TransferJob;
    clearInactive(): TransferQueue;
    getJob(jobId: string): TransferJob;
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
    return encodeURI(`file://${localPath}`);
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

export function createDownloadTransferTracker(nowFn: NowFn = () => Date.now()): DownloadTransferTracker {
    let queue = createTransferQueue();
    const listeners = new Set<TransferQueueListener>();

    function notify() {
        for (const listener of listeners) {
            listener(queue);
        }
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
        retry(jobId) {
            commit(retryTransferJob(queue, jobId, nowFn()));
            return getTransferJob(queue, jobId);
        },
        clearInactive() {
            return commit(clearInactiveTransferJobs(queue));
        },
        getJob(jobId) {
            return getTransferJob(queue, jobId);
        },
        getQueue() {
            return queue;
        },
        hydrate(nextQueue) {
            return commit(nextQueue);
        },
        subscribe(listener) {
            listeners.add(listener);
            listener(queue);
            return () => {
                listeners.delete(listener);
            };
        },
    };
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

export function makeTransferQueuePersistence(filePath: string, delayMs = 100) {
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
