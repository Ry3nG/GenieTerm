export type TransferOperation = "download" | "upload";
export type TransferItemType = "file" | "folder";
export type TransferTransport = "wsh" | "rsync" | "scp" | "sftp";
export type TransferJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type TransferProgress = {
    bytesTransferred: number;
    totalBytes?: number;
    percent?: number;
    message?: string;
};

export type TransferError = {
    code: string;
    message: string;
    retryable?: boolean;
};

export type TransferFailureRecord = {
    attempt: number;
    failedAt: number;
    error: TransferError;
};

export type TransferJobInput = {
    id: string;
    operation: TransferOperation;
    itemType: TransferItemType;
    transport: TransferTransport;
    source: string;
    destination: string;
    label: string;
    groupId?: string;
};

export type TransferJob = TransferJobInput & {
    attempt: number;
    createdAt: number;
    updatedAt: number;
    status: TransferJobStatus;
    progress: TransferProgress;
    failureHistory: TransferFailureRecord[];
    startedAt?: number;
    completedAt?: number;
    failedAt?: number;
    canceledAt?: number;
    lastError?: TransferError;
};

export type TransferQueue = {
    jobs: TransferJob[];
};

export function createTransferQueue(): TransferQueue {
    return { jobs: [] };
}

export function getTransferJob(queue: TransferQueue, jobId: string): TransferJob {
    const job = queue.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
        throw new Error(`Unknown transfer job: ${jobId}`);
    }
    return job;
}

export function enqueueTransferJob(queue: TransferQueue, input: TransferJobInput, now: number): TransferQueue {
    if (queue.jobs.some((job) => job.id === input.id)) {
        throw new Error(`Duplicate transfer job: ${input.id}`);
    }
    const job: TransferJob = {
        ...input,
        attempt: 1,
        createdAt: now,
        updatedAt: now,
        status: "queued",
        progress: { bytesTransferred: 0 },
        failureHistory: [],
    };
    return {
        ...queue,
        jobs: [...queue.jobs, job],
    };
}

export function startTransferJob(queue: TransferQueue, jobId: string, now: number): TransferQueue {
    return updateJob(queue, jobId, (job) => {
        assertStatus(job, ["queued"], "start");
        return {
            ...job,
            status: "running",
            startedAt: now,
            updatedAt: now,
        };
    });
}

export function updateTransferProgress(
    queue: TransferQueue,
    jobId: string,
    progress: Partial<TransferProgress>,
    now: number
): TransferQueue {
    return updateJob(queue, jobId, (job) => {
        assertStatus(job, ["running"], "update progress for");
        const nextProgress = clampProgress({
            ...job.progress,
            ...progress,
        });
        return {
            ...job,
            progress: nextProgress,
            updatedAt: now,
        };
    });
}

export function completeTransferJob(queue: TransferQueue, jobId: string, now: number): TransferQueue {
    return updateJob(queue, jobId, (job) => {
        assertStatus(job, ["running"], "complete");
        const completedProgress = clampProgress({
            ...job.progress,
            bytesTransferred: job.progress.totalBytes ?? job.progress.bytesTransferred,
            percent: 100,
        });
        return {
            ...job,
            status: "completed",
            progress: completedProgress,
            completedAt: now,
            updatedAt: now,
        };
    });
}

export function failTransferJob(queue: TransferQueue, jobId: string, error: TransferError, now: number): TransferQueue {
    return updateJob(queue, jobId, (job) => {
        assertStatus(job, ["running"], "fail");
        const failureRecord: TransferFailureRecord = {
            attempt: job.attempt,
            failedAt: now,
            error,
        };
        return {
            ...job,
            status: "failed",
            failedAt: now,
            updatedAt: now,
            lastError: error,
            failureHistory: [...job.failureHistory, failureRecord],
        };
    });
}

export function retryTransferJob(queue: TransferQueue, jobId: string, now: number): TransferQueue {
    return updateJob(queue, jobId, (job) => {
        assertStatus(job, ["failed"], "retry");
        if (job.lastError?.retryable === false) {
            throw new Error(`Cannot retry non-retryable transfer job: ${jobId}`);
        }
        const {
            startedAt: _startedAt,
            completedAt: _completedAt,
            failedAt: _failedAt,
            canceledAt: _canceledAt,
            lastError: _lastError,
            ...rest
        } = job;
        return {
            ...rest,
            attempt: job.attempt + 1,
            status: "queued",
            progress: { bytesTransferred: 0 },
            updatedAt: now,
        };
    });
}

export function cancelTransferJob(queue: TransferQueue, jobId: string, now: number): TransferQueue {
    return updateJob(queue, jobId, (job) => {
        assertStatus(job, ["queued", "running"], "cancel");
        return {
            ...job,
            status: "canceled",
            canceledAt: now,
            updatedAt: now,
        };
    });
}

function updateJob(queue: TransferQueue, jobId: string, update: (job: TransferJob) => TransferJob): TransferQueue {
    let found = false;
    const jobs = queue.jobs.map((job) => {
        if (job.id !== jobId) {
            return job;
        }
        found = true;
        return update(job);
    });
    if (!found) {
        throw new Error(`Unknown transfer job: ${jobId}`);
    }
    return {
        ...queue,
        jobs,
    };
}

function assertStatus(job: TransferJob, allowed: TransferJobStatus[], action: string) {
    if (!allowed.includes(job.status)) {
        throw new Error(`Cannot ${action} ${job.status} transfer job: ${job.id}`);
    }
}

function clampProgress(progress: TransferProgress): TransferProgress {
    const next: TransferProgress = {
        ...progress,
        bytesTransferred: Math.max(0, progress.bytesTransferred ?? 0),
    };
    if (next.totalBytes != null) {
        next.totalBytes = Math.max(0, next.totalBytes);
        next.bytesTransferred = Math.min(next.bytesTransferred, next.totalBytes);
        next.percent = next.totalBytes === 0 ? 100 : Math.round((next.bytesTransferred / next.totalBytes) * 100);
    } else if (next.percent != null) {
        next.percent = Math.max(0, Math.min(100, next.percent));
    }
    return next;
}
