import { isInactiveTransferStatus, type TransferJob, type TransferJobStatus, type TransferQueue } from "./transferqueue";

export type TransferDisplayTone = "active" | "success" | "danger" | "muted";

export type TransferJobDisplay = {
    id: string;
    label: string;
    status: TransferJobStatus;
    statusLabel: string;
    detail: string;
    subdetail?: string;
    errorText?: string;
    tone: TransferDisplayTone;
    iconClass: string;
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
    return {
        id: job.id,
        label: job.label || job.source,
        status: job.status,
        statusLabel: getTransferStatusLabel(job.status),
        detail: getTransferDetail(job),
        subdetail: getTransferSubdetail(job),
        errorText: getTransferErrorText(job),
        tone: getTransferTone(job.status),
        iconClass: getTransferIconClass(job.status),
    };
}

function getTransferDetail(job: TransferJob): string {
    const operation = getOperationLabel(job.operation);
    switch (job.status) {
        case "queued":
            return `${operation} queued`;
        case "running": {
            const activeOperation = job.operation === "upload" ? "Uploading" : "Downloading";
            const progress = job.progress?.percent != null ? ` - ${job.progress.percent}%` : "";
            return `${activeOperation} ${job.itemType}${progress}`;
        }
        case "completed":
            return `${operation} complete`;
        case "failed":
            return `${operation} failed`;
        case "canceled":
            return `${operation} canceled`;
    }
}

function getTransferSubdetail(job: TransferJob): string {
    if (job.status === "running") {
        return job.progress?.message;
    }
    return undefined;
}

function getTransferErrorText(job: TransferJob): string {
    if (job.status !== "failed" || !job.lastError) {
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

function getTransferIconClass(status: TransferJobStatus): string {
    switch (status) {
        case "queued":
            return "fa-solid fa-clock";
        case "running":
            return "fa-solid fa-spinner";
        case "completed":
            return "fa-solid fa-circle-check";
        case "failed":
            return "fa-solid fa-circle-exclamation";
        case "canceled":
            return "fa-solid fa-circle-xmark";
    }
}

function getOperationLabel(operation: TransferJob["operation"]): string {
    return operation === "upload" ? "Upload" : "Download";
}
