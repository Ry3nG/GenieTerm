import { describe, expect, it } from "vitest";

import {
    cancelTransferJob,
    clearInactiveTransferJobs,
    completeTransferJob,
    createTransferQueue,
    enqueueTransferJob,
    enqueueTransferJobGroup,
    failTransferJob,
    getTransferGroupJobs,
    getTransferJob,
    MaxTransferJobs,
    pruneTransferQueue,
    recoverTransferQueue,
    requestTransferJobCancel,
    retryTransferJob,
    startTransferJob,
    summarizeTransferGroup,
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
    it("recovers interrupted remote copies in the existing retry queue", () => {
        const copying = startTransferJob(
            enqueueTransferJob(createTransferQueue(), { ...baseJobInput, operation: "copy", transport: "wsh" }, 1000),
            "job-1",
            1100
        );
        const recovered = recoverTransferQueue(copying, 2000);
        expect(recovered.jobs[0]).toMatchObject({
            operation: "copy",
            status: "failed",
            lastError: { retryable: true },
        });
        expect(retryTransferJob(recovered, "job-1", 3000).jobs[0]).toMatchObject({
            operation: "copy",
            status: "queued",
            attempt: 2,
        });
    });
    it("recovers interrupted downloads and uploads as retryable failures", () => {
        const download = startTransferJob(enqueueTransferJob(createTransferQueue(), baseJobInput, 1000), "job-1", 1100);
        const uploadInput = { ...baseJobInput, id: "upload-1", operation: "upload" as const };
        const withUpload = enqueueTransferJob(download, uploadInput, 1200);
        const recovered = recoverTransferQueue(withUpload, 2000);

        expect(recovered.jobs[0]).toMatchObject({
            status: "failed",
            lastError: { code: "transfer_interrupted", retryable: true },
        });
        expect(recovered.jobs[1]).toMatchObject({
            status: "failed",
            lastError: { code: "transfer_interrupted", retryable: true },
        });
        expect(recoverTransferQueue({ jobs: [{ id: 3 }] }, 2000)).toEqual(createTransferQueue());
    });

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

    it("cancels queued and running jobs and ignores cancel after completion", () => {
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
        expect(getTransferJob(cancelTransferJob(completed, "job-1", 2400), "job-1")).toEqual(
            getTransferJob(completed, "job-1")
        );
    });

    it("treats late terminal transitions on terminal jobs as no-ops", () => {
        const running = startTransferJob(enqueueTransferJob(createTransferQueue(), baseJobInput, 1000), "job-1", 1100);
        const canceled = cancelTransferJob(running, "job-1", 1200);
        const canceledJob = getTransferJob(canceled, "job-1");

        expect(getTransferJob(cancelTransferJob(canceled, "job-1", 1300), "job-1")).toEqual(canceledJob);
        expect(getTransferJob(completeTransferJob(canceled, "job-1", 1300), "job-1")).toEqual(canceledJob);
        expect(
            getTransferJob(failTransferJob(canceled, "job-1", { code: "late", message: "Late close" }, 1300), "job-1")
        ).toEqual(canceledJob);
        expect(
            getTransferJob(updateTransferProgress(canceled, "job-1", { bytesTransferred: 10 }, 1300), "job-1")
        ).toEqual(canceledJob);

        const completed = completeTransferJob(running, "job-1", 1200);
        expect(getTransferJob(failTransferJob(completed, "job-1", { code: "x", message: "x" }, 1300), "job-1")).toEqual(
            getTransferJob(completed, "job-1")
        );
    });

    it("records cancel requests on running work and reports completion honestly", () => {
        const queued = enqueueTransferJob(createTransferQueue(), baseJobInput, 1000);
        expect(getTransferJob(requestTransferJobCancel(queued, "job-1", 1050), "job-1").status).toBe("canceled");

        const running = startTransferJob(queued, "job-1", 1100);
        const requested = requestTransferJobCancel(running, "job-1", 1200);
        expect(getTransferJob(requested, "job-1")).toMatchObject({ status: "running", cancelRequestedAt: 1200 });
        expect(requestTransferJobCancel(requested, "job-1", 1300)).toBe(requested);

        const completed = completeTransferJob(requested, "job-1", 1400);
        expect(getTransferJob(completed, "job-1")).toMatchObject({
            status: "completed",
            progress: { message: "Finished before the cancel request could take effect." },
        });
        expect(requestTransferJobCancel(completed, "job-1", 1500)).toBe(completed);

        const canceledAfterRequest = cancelTransferJob(requested, "job-1", 1400);
        const retried = retryTransferJob(canceledAfterRequest, "job-1", 1500);
        expect(getTransferJob(retried, "job-1")).toMatchObject({ status: "queued", attempt: 2 });
        expect(getTransferJob(retried, "job-1").cancelRequestedAt).toBeUndefined();
    });

    it("retries canceled jobs but not completed or non-retryable ones", () => {
        const canceled = cancelTransferJob(
            enqueueTransferJob(createTransferQueue(), baseJobInput, 1000),
            "job-1",
            1100
        );
        expect(getTransferJob(retryTransferJob(canceled, "job-1", 1200), "job-1")).toMatchObject({
            status: "queued",
            attempt: 2,
        });

        const running = startTransferJob(enqueueTransferJob(createTransferQueue(), baseJobInput, 1000), "job-1", 1100);
        expect(() => retryTransferJob(completeTransferJob(running, "job-1", 1200), "job-1", 1300)).toThrow(
            "Cannot retry completed transfer job"
        );
        const nonRetryable = failTransferJob(running, "job-1", { code: "bad", message: "Bad", retryable: false }, 1200);
        expect(() => retryTransferJob(nonRetryable, "job-1", 1300)).toThrow("non-retryable");
    });

    it("fails queued jobs that never started", () => {
        const queued = enqueueTransferJob(createTransferQueue(), baseJobInput, 1000);
        expect(
            getTransferJob(
                failTransferJob(queued, "job-1", { code: "start", message: "Could not start" }, 1100),
                "job-1"
            ).status
        ).toBe("failed");
    });

    it("caps the queue by pruning the oldest terminal jobs only", () => {
        let queue = createTransferQueue();
        queue = startTransferJob(enqueueTransferJob(queue, { ...baseJobInput, id: "active" }, 1), "active", 2);
        for (let index = 0; index < MaxTransferJobs + 5; index++) {
            const id = `done-${index}`;
            queue = enqueueTransferJob(queue, { ...baseJobInput, id }, 10 + index);
            queue = cancelTransferJob(queue, id, 10 + index);
        }
        expect(queue.jobs).toHaveLength(MaxTransferJobs);
        expect(queue.jobs[0].id).toBe("active");
        expect(queue.jobs[1].id).toBe("done-6");
        expect(queue.jobs.at(-1).id).toBe(`done-${MaxTransferJobs + 4}`);

        const allActive = { jobs: queue.jobs.map((job) => ({ ...job, status: "running" as const })) };
        expect(pruneTransferQueue(allActive, 3)).toBe(allActive);
    });

    it("clears inactive transfer jobs without removing active work", () => {
        const queued = enqueueTransferJob(createTransferQueue(), { ...baseJobInput, id: "queued" }, 1000);
        const running = startTransferJob(
            enqueueTransferJob(queued, { ...baseJobInput, id: "running" }, 1100),
            "running",
            1200
        );
        const completed = completeTransferJob(
            startTransferJob(
                enqueueTransferJob(running, { ...baseJobInput, id: "completed" }, 1300),
                "completed",
                1400
            ),
            "completed",
            1500
        );
        const failed = failTransferJob(
            startTransferJob(enqueueTransferJob(completed, { ...baseJobInput, id: "failed" }, 1600), "failed", 1700),
            "failed",
            { code: "failed", message: "Failed" },
            1800
        );
        const canceled = cancelTransferJob(
            enqueueTransferJob(failed, { ...baseJobInput, id: "canceled" }, 1900),
            "canceled",
            2000
        );

        const cleared = clearInactiveTransferJobs(canceled);

        expect(cleared.jobs.map((job) => job.id)).toEqual(["queued", "running"]);
    });

    it("rejects invalid transitions and unknown jobs", () => {
        const queued = enqueueTransferJob(createTransferQueue(), baseJobInput, 1000);
        const completed = completeTransferJob(startTransferJob(queued, "job-1", 1100), "job-1", 1200);

        expect(() => startTransferJob(completed, "job-1", 1300)).toThrow("Cannot start completed transfer job");
        expect(() => completeTransferJob(queued, "job-1", 1300)).toThrow("Cannot complete queued transfer job");
        expect(() => cancelTransferJob(queued, "missing", 1300)).toThrow("Unknown transfer job");
        expect(() => failTransferJob(queued, "missing", { code: "missing", message: "Missing job" }, 1300)).toThrow(
            "Unknown transfer job"
        );
    });

    it("enqueues grouped jobs with a shared group id", () => {
        const grouped = enqueueTransferJobGroup(
            createTransferQueue(),
            [
                { ...baseJobInput, id: "job-1", label: "first.txt" },
                { ...baseJobInput, id: "job-2", label: "second.txt" },
            ],
            "group-1",
            1000
        );

        expect(getTransferGroupJobs(grouped, "group-1").map((job) => `${job.id}:${job.groupId}`)).toEqual([
            "job-1:group-1",
            "job-2:group-1",
        ]);
        expect(summarizeTransferGroup(grouped, "group-1")).toMatchObject({
            groupId: "group-1",
            totalCount: 2,
            statusCounts: {
                queued: 2,
                running: 0,
                completed: 0,
                failed: 0,
                canceled: 0,
            },
            hasPartialFailure: false,
        });
    });

    it("summarizes grouped partial failure and retry/cancel affordances per item", () => {
        const grouped = enqueueTransferJobGroup(
            createTransferQueue(),
            [
                { ...baseJobInput, id: "job-1", label: "first.txt" },
                { ...baseJobInput, id: "job-2", label: "second.txt" },
                { ...baseJobInput, id: "job-3", label: "third.txt" },
            ],
            "group-1",
            1000
        );
        const running1 = startTransferJob(grouped, "job-1", 1100);
        const failed = failTransferJob(
            running1,
            "job-1",
            { code: "copy_failed", message: "Copy failed", retryable: true },
            1200
        );
        const running2 = startTransferJob(failed, "job-2", 1300);
        const completed = completeTransferJob(running2, "job-2", 1400);

        expect(summarizeTransferGroup(completed, "group-1")).toMatchObject({
            totalCount: 3,
            statusCounts: {
                queued: 1,
                running: 0,
                completed: 1,
                failed: 1,
                canceled: 0,
            },
            hasPartialFailure: true,
            failedJobIds: ["job-1"],
            retryableFailedJobIds: ["job-1"],
            cancelableJobIds: ["job-3"],
        });

        const retried = retryTransferJob(completed, "job-1", 1500);
        expect(getTransferJob(retried, "job-1").groupId).toBe("group-1");
        expect(getTransferJob(retried, "job-1").status).toBe("queued");
    });
});
