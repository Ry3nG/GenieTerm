import {
    cancelTransferJob,
    clearInactiveTransferJobs,
    completeTransferJob,
    createTransferQueue,
    enqueueTransferJob,
    failTransferJob,
    getTransferJob,
    startTransferJob,
    type TransferError,
    type TransferJob,
    type TransferJobInput,
    type TransferQueue,
} from "../../frontend/util/transferqueue";
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
    clearInactive(): TransferQueue;
    getJob(jobId: string): TransferJob;
    getQueue(): TransferQueue;
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
        clearInactive() {
            return commit(clearInactiveTransferJobs(queue));
        },
        getJob(jobId) {
            return getTransferJob(queue, jobId);
        },
        getQueue() {
            return queue;
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
