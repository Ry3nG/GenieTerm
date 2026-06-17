import { describe, expect, it } from "vitest";

import {
    cancelTransferJob,
    completeTransferJob,
    createTransferQueue,
    enqueueTransferJob,
    failTransferJob,
    getTransferJob,
    retryTransferJob,
    startTransferJob,
    updateTransferProgress,
    type TransferJobInput,
} from "./transferqueue";

const baseJobInput: TransferJobInput = {
    id: "job-1",
    operation: "download",
    itemType: "folder",
    transport: "rsync",
    source: "wsh://paw-5090-ws/~/projects/out",
    destination: "file:///tmp/out",
    label: "out",
};

describe("transferqueue", () => {
    it("enqueues transfer jobs without mutating the previous queue", () => {
        const empty = createTransferQueue();
        const queued = enqueueTransferJob(empty, baseJobInput, 1000);
        const job = getTransferJob(queued, "job-1");

        expect(empty.jobs).toEqual([]);
        expect(job).toMatchObject({
            id: "job-1",
            attempt: 1,
            createdAt: 1000,
            updatedAt: 1000,
            status: "queued",
            progress: { bytesTransferred: 0 },
        });
    });

    it("tracks running progress and completion", () => {
        const queued = enqueueTransferJob(createTransferQueue(), baseJobInput, 1000);
        const running = startTransferJob(queued, "job-1", 1100);
        const progressed = updateTransferProgress(
            running,
            "job-1",
            { bytesTransferred: 512, totalBytes: 1024, message: "halfway" },
            1200
        );
        const completed = completeTransferJob(progressed, "job-1", 1300);
        const job = getTransferJob(completed, "job-1");

        expect(job).toMatchObject({
            status: "completed",
            startedAt: 1100,
            completedAt: 1300,
            updatedAt: 1300,
            progress: {
                bytesTransferred: 1024,
                totalBytes: 1024,
                percent: 100,
                message: "halfway",
            },
        });
    });

    it("records failure history and retries as the next queued attempt", () => {
        const queued = enqueueTransferJob(createTransferQueue(), baseJobInput, 1000);
        const running = startTransferJob(queued, "job-1", 1100);
        const failed = failTransferJob(
            running,
            "job-1",
            { code: "permission_denied", message: "Permission denied", retryable: true },
            1200
        );
        const failedJob = getTransferJob(failed, "job-1");

        expect(failedJob).toMatchObject({
            status: "failed",
            failedAt: 1200,
            lastError: { code: "permission_denied", message: "Permission denied", retryable: true },
            failureHistory: [
                {
                    attempt: 1,
                    failedAt: 1200,
                    error: { code: "permission_denied", message: "Permission denied", retryable: true },
                },
            ],
        });

        const retried = retryTransferJob(failed, "job-1", 1300);
        const retriedJob = getTransferJob(retried, "job-1");

        expect(retriedJob).toMatchObject({
            status: "queued",
            attempt: 2,
            updatedAt: 1300,
            progress: { bytesTransferred: 0 },
            failureHistory: failedJob.failureHistory,
        });
        expect(retriedJob.lastError).toBeUndefined();
        expect(retriedJob.startedAt).toBeUndefined();
        expect(retriedJob.failedAt).toBeUndefined();
    });

    it("cancels queued and running jobs but rejects cancel after completion", () => {
        const queued = enqueueTransferJob(createTransferQueue(), baseJobInput, 1000);
        const canceledQueued = cancelTransferJob(queued, "job-1", 1100);

        expect(getTransferJob(canceledQueued, "job-1")).toMatchObject({
            status: "canceled",
            canceledAt: 1100,
            updatedAt: 1100,
        });

        const running = startTransferJob(enqueueTransferJob(createTransferQueue(), baseJobInput, 2000), "job-1", 2100);
        const canceledRunning = cancelTransferJob(running, "job-1", 2200);

        expect(getTransferJob(canceledRunning, "job-1")).toMatchObject({
            status: "canceled",
            startedAt: 2100,
            canceledAt: 2200,
        });

        const completed = completeTransferJob(running, "job-1", 2300);
        expect(() => cancelTransferJob(completed, "job-1", 2400)).toThrow("Cannot cancel completed transfer job");
    });

    it("rejects invalid transitions and unknown jobs", () => {
        const queued = enqueueTransferJob(createTransferQueue(), baseJobInput, 1000);
        const completed = completeTransferJob(startTransferJob(queued, "job-1", 1100), "job-1", 1200);

        expect(() => startTransferJob(completed, "job-1", 1300)).toThrow("Cannot start completed transfer job");
        expect(() => completeTransferJob(queued, "job-1", 1300)).toThrow("Cannot complete queued transfer job");
        expect(() => failTransferJob(queued, "missing", { code: "missing", message: "Missing job" }, 1300)).toThrow(
            "Unknown transfer job"
        );
    });
});
