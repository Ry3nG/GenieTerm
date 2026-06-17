import {
    cancelTransferJob,
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
    getJob(jobId: string): TransferJob;
    getQueue(): TransferQueue;
};

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

    return {
        enqueue(input) {
            queue = enqueueTransferJob(queue, input, nowFn());
            return getTransferJob(queue, input.id);
        },
        start(jobId) {
            queue = startTransferJob(queue, jobId, nowFn());
            return getTransferJob(queue, jobId);
        },
        complete(jobId) {
            queue = completeTransferJob(queue, jobId, nowFn());
            return getTransferJob(queue, jobId);
        },
        fail(jobId, error) {
            queue = failTransferJob(queue, jobId, error, nowFn());
            return getTransferJob(queue, jobId);
        },
        cancel(jobId) {
            queue = cancelTransferJob(queue, jobId, nowFn());
            return getTransferJob(queue, jobId);
        },
        getJob(jobId) {
            return getTransferJob(queue, jobId);
        },
        getQueue() {
            return queue;
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
