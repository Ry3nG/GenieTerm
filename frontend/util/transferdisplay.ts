import {
    isInactiveTransferStatus,
    type TransferJob,
    type TransferJobStatus,
    type TransferQueue,
} from "./transferqueue";

export type TransferDisplayTone = "active" | "success" | "danger" | "muted";

export type TransferJobDisplay = {
    id: string;
    label: string;
    operation: TransferJob["operation"];
    status: TransferJobStatus;
    statusLabel: string;
    // one secondary line: progress while running, the reason when it failed
    detail: string;
    detailIsError: boolean;
    // 0-100 when the transport reports progress; null while running without a known total
    percent: number | null;
    tone: TransferDisplayTone;
    iconClass: string;
    canCancel: boolean;
    canRetry: boolean;
};

export type TransferQueueDisplay = {
    jobs: TransferJobDisplay[];
    activeCount: number;
    clearableCount: number;
    hiddenCount: number;
    totalCount: number;
};

const StatusLabels: Record<TransferJobStatus, string> = {
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    canceled: "Canceled",
};

const StatusRank: Record<TransferJobStatus, number> = {
    running: 0,
    queued: 1,
    failed: 2,
    canceled: 3,
    completed: 4,
};

export function getTransferStatusLabel(status: TransferJobStatus): string {
    return StatusLabels[status];
}

export function summarizeTransferQueue(queue: TransferQueue, limit = 5): TransferQueueDisplay {
    const orderedJobs = [...(queue?.jobs ?? [])].sort((left, right) => {
        const rankDelta = StatusRank[left.status] - StatusRank[right.status];
        if (rankDelta !== 0) {
            return rankDelta;
        }
        return right.updatedAt - left.updatedAt;
    });
    const visibleJobs = limit > 0 ? orderedJobs.slice(0, limit) : [];
    return {
        jobs: visibleJobs.map(summarizeTransferJob),
        activeCount: orderedJobs.filter((job) => job.status === "queued" || job.status === "running").length,
        clearableCount: orderedJobs.filter((job) => isInactiveTransferStatus(job.status)).length,
        hiddenCount: Math.max(0, orderedJobs.length - visibleJobs.length),
        totalCount: orderedJobs.length,
    };
}

export function summarizeTransferJob(job: TransferJob): TransferJobDisplay {
    const errorText = getTransferErrorText(job);
    return {
        id: job.id,
        label: job.label || job.source,
        operation: job.operation,
        status: job.status,
        statusLabel:
            job.status === "running" && job.cancelRequestedAt != null
                ? "Canceling"
                : getTransferStatusLabel(job.status),
        detail: errorText ?? getTransferDetail(job),
        detailIsError: errorText != null && job.status === "failed",
        percent: getTransferPercent(job),
        tone: getTransferTone(job.status),
        iconClass: getTransferIconClass(job.operation),
        canCancel: isCancelableTransferJob(job),
        canRetry: isRetryableTransferJob(job),
    };
}

function getTransferPercent(job: TransferJob): number | null {
    if (job.status !== "running") {
        return null;
    }
    const percent = job.progress?.percent;
    if (percent != null && percent > 0) {
        return Math.min(100, Math.max(0, percent));
    }
    const total = job.progress?.totalBytes;
    const transferred = job.progress?.bytesTransferred;
    if (total != null && total > 0 && transferred != null) {
        return Math.min(100, Math.round((transferred / total) * 100));
    }
    return null;
}

export function isCancelableTransferJob(job: TransferJob): boolean {
    if (job.status === "queued") {
        return true;
    }
    return job.status === "running" && job.cancelRequestedAt == null;
}

export function isRetryableTransferJob(job: TransferJob): boolean {
    if (job.status !== "failed" && job.status !== "canceled") {
        return false;
    }
    return job.lastError?.retryable !== false;
}

function getTransferDetail(job: TransferJob): string {
    if (job.operation === "copy") {
        if (job.cancelRequestedAt != null && job.status === "running")
            return "Stopping after the current copy finishes";
        return {
            queued: "Waiting to copy",
            running: "Copying…",
            completed: "Copied",
            failed: "Copy failed",
            canceled: "Canceled",
        }[job.status];
    }
    const isUpload = job.operation === "upload";
    switch (job.status) {
        case "queued":
            return isUpload ? "Waiting to upload" : "Waiting to download";
        case "running":
            if (job.cancelRequestedAt != null) {
                return "Stopping after the current copy finishes";
            }
            return job.progress?.message ?? getByteProgressText(job) ?? (isUpload ? "Uploading…" : "Downloading…");
        case "completed":
            return job.progress?.message ?? (isUpload ? "Uploaded" : "Downloaded");
        case "failed":
            return isUpload ? "Upload failed" : "Download failed";
        case "canceled":
            return "Canceled";
    }
}

function getByteProgressText(job: TransferJob): string {
    const transferred = job.progress?.bytesTransferred ?? 0;
    if (transferred <= 0) {
        return undefined;
    }
    const total = job.progress?.totalBytes;
    return total != null && total > 0
        ? `${formatTransferBytes(transferred)} of ${formatTransferBytes(total)}`
        : formatTransferBytes(transferred);
}

export function formatTransferBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIdx = 0;
    while (value >= 1024 && unitIdx < units.length - 1) {
        value /= 1024;
        unitIdx += 1;
    }
    return unitIdx === 0 ? `${value} ${units[unitIdx]}` : `${value.toFixed(1)} ${units[unitIdx]}`;
}

function getTransferErrorText(job: TransferJob): string {
    if ((job.status !== "failed" && job.status !== "canceled") || !job.lastError) {
        return undefined;
    }
    return [job.lastError.message, job.lastError.detail].filter(Boolean).join(" ");
}

function getTransferTone(status: TransferJobStatus): TransferDisplayTone {
    switch (status) {
        case "queued":
        case "running":
            return "active";
        case "completed":
            return "success";
        case "failed":
            return "danger";
        case "canceled":
            return "muted";
    }
}

function getTransferIconClass(operation: TransferJob["operation"]): string {
    if (operation === "copy") return "fa-regular fa-copy";
    return operation === "upload" ? "fa-solid fa-arrow-up" : "fa-solid fa-arrow-down";
}
