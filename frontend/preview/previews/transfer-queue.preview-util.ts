import type { TransferJob, TransferQueue } from "@/util/transferqueue";

const PreviewNow = 1_806_000_000_000;

function makePreviewJob(overrides: Partial<TransferJob>): TransferJob {
    return {
        id: "preview-transfer",
        operation: "download",
        itemType: "folder",
        transport: "rsync",
        source: "wsh://devbox/~/workspace",
        destination: "file:///Users/me/Downloads/workspace",
        label: "workspace",
        attempt: 1,
        createdAt: PreviewNow,
        updatedAt: PreviewNow,
        status: "queued",
        progress: { bytesTransferred: 0 },
        failureHistory: [],
        ...overrides,
    };
}

export function makeTransferQueuePreviewState(): TransferQueue {
    return {
        jobs: [
            makePreviewJob({
                id: "preview-queued",
                label: "release-notes",
                itemType: "folder",
                status: "queued",
                updatedAt: PreviewNow + 100,
            }),
            makePreviewJob({
                id: "preview-running",
                label: "dataset.csv",
                itemType: "file",
                transport: "wsh",
                status: "running",
                progress: {
                    bytesTransferred: 3_670_016,
                    totalBytes: 9_175_040,
                    percent: 40,
                    message: "Receiving dataset.csv",
                },
                startedAt: PreviewNow + 200,
                updatedAt: PreviewNow + 300,
            }),
            makePreviewJob({
                id: "preview-completed",
                label: "screenshots",
                itemType: "folder",
                status: "completed",
                progress: { bytesTransferred: 9_175_040, totalBytes: 9_175_040, percent: 100 },
                startedAt: PreviewNow + 400,
                completedAt: PreviewNow + 500,
                updatedAt: PreviewNow + 500,
            }),
            makePreviewJob({
                id: "preview-failed",
                label: "logs",
                itemType: "folder",
                status: "failed",
                lastError: {
                    code: "transfer_failed",
                    message: "Folder transfer failed.",
                    detail: "rsync exited with code 23.",
                    retryable: true,
                },
                failedAt: PreviewNow + 600,
                updatedAt: PreviewNow + 600,
            }),
            makePreviewJob({
                id: "preview-canceled",
                label: "archive.zip",
                itemType: "file",
                status: "canceled",
                canceledAt: PreviewNow + 700,
                updatedAt: PreviewNow + 700,
            }),
        ],
    };
}
