import { describe, expect, it } from "vitest";

import {
    getTransferStatusLabel,
    summarizeTransferJob,
    summarizeTransferQueue,
    type TransferJobDisplay,
} from "./transferdisplay";
import type { TransferJob, TransferQueue } from "./transferqueue";

const baseJob: TransferJob = {
    id: "job-1",
    operation: "download",
    itemType: "folder",
    transport: "rsync",
    source: "wsh://paw-5090-ws/~/projects/out",
    destination: "file:///tmp/out",
    label: "out",
    attempt: 1,
    createdAt: 1000,
    updatedAt: 1000,
    status: "queued",
    progress: { bytesTransferred: 0 },
    failureHistory: [],
};

function job(overrides: Partial<TransferJob>): TransferJob {
    return { ...baseJob, ...overrides };
}

describe("transferdisplay", () => {
    it("maps queue statuses to user-visible labels", () => {
        expect(getTransferStatusLabel("queued")).toBe("Queued");
        expect(getTransferStatusLabel("running")).toBe("Running");
        expect(getTransferStatusLabel("completed")).toBe("Completed");
        expect(getTransferStatusLabel("failed")).toBe("Failed");
        expect(getTransferStatusLabel("canceled")).toBe("Canceled");
    });

    it("summarizes running progress for compact Files UI rows", () => {
        expect(
            summarizeTransferJob(
                job({
                    status: "running",
                    progress: { bytesTransferred: 512, totalBytes: 1024, percent: 50, message: "copying files" },
                })
            )
        ).toMatchObject<Partial<TransferJobDisplay>>({
            id: "job-1",
            label: "out",
            status: "running",
            statusLabel: "Running",
            detail: "copying files",
            detailIsError: false,
            percent: 50,
            tone: "active",
            iconClass: "fa-solid fa-arrow-down",
            canCancel: true,
            canRetry: false,
        });
    });

    it("surfaces failed transfer messages and details", () => {
        const display = summarizeTransferJob(
            job({
                status: "failed",
                lastError: {
                    code: "transfer_failed",
                    message: "Folder transfer failed.",
                    detail: "rsync exited with code 23.",
                    retryable: true,
                },
            })
        );

        expect(display).toMatchObject({
            detail: "Folder transfer failed. rsync exited with code 23.",
            detailIsError: true,
            percent: null,
            tone: "danger",
            iconClass: "fa-solid fa-arrow-down",
            canCancel: false,
            canRetry: true,
        });
    });

    it("offers retry for failed or canceled jobs of every transport unless marked non-retryable", () => {
        expect(summarizeTransferJob(job({ status: "canceled" })).canRetry).toBe(true);
        expect(summarizeTransferJob(job({ status: "failed", operation: "upload", transport: "wsh" })).canRetry).toBe(
            true
        );
        expect(summarizeTransferJob(job({ status: "failed", transport: "scp" })).canRetry).toBe(true);
        expect(
            summarizeTransferJob(
                job({ status: "failed", lastError: { code: "invalid_source", message: "Bad", retryable: false } })
            ).canRetry
        ).toBe(false);
        expect(summarizeTransferJob(job({ status: "completed" })).canRetry).toBe(false);
    });

    it("shows a cancel request honestly and stops offering cancel again", () => {
        const display = summarizeTransferJob(
            job({ status: "running", operation: "upload", transport: "wsh", cancelRequestedAt: 1500 })
        );
        expect(display).toMatchObject({
            statusLabel: "Canceling",
            detail: "Stopping after the current copy finishes",
            iconClass: "fa-solid fa-arrow-up",
            canCancel: false,
            canRetry: false,
        });
        expect(
            summarizeTransferJob(
                job({
                    status: "completed",
                    progress: {
                        bytesTransferred: 10,
                        message: "Finished before the cancel request could take effect.",
                    },
                })
            ).detail
        ).toBe("Finished before the cancel request could take effect.");
    });

    it("shows byte progress for running native downloads", () => {
        expect(
            summarizeTransferJob(
                job({
                    status: "running",
                    progress: { bytesTransferred: 1536, totalBytes: 3 * 1024 * 1024, percent: 0 },
                })
            ).detail
        ).toBe("1.5 KB of 3.0 MB");
        expect(summarizeTransferJob(job({ status: "running" }))).toMatchObject({
            detail: "Downloading…",
            percent: null,
        });
        expect(
            summarizeTransferJob(job({ status: "running", progress: { bytesTransferred: 1024, totalBytes: 4096 } }))
                .percent
        ).toBe(25);
        expect(summarizeTransferJob(job({ status: "queued", operation: "upload" })).detail).toBe("Waiting to upload");
    });

    it("orders active transfers before recent terminal transfers and reports hidden rows", () => {
        const queue: TransferQueue = {
            jobs: [
                job({ id: "completed-old", status: "completed", updatedAt: 1000 }),
                job({ id: "failed-new", status: "failed", updatedAt: 5000 }),
                job({ id: "running", status: "running", updatedAt: 3000 }),
                job({ id: "queued", status: "queued", updatedAt: 2000 }),
                job({ id: "completed-new", status: "completed", updatedAt: 4000 }),
            ],
        };

        const summary = summarizeTransferQueue(queue, 3);

        expect(summary.activeCount).toBe(2);
        expect(summary.clearableCount).toBe(3);
        expect(summary.hiddenCount).toBe(2);
        expect(summary.jobs.map((display) => display.id)).toEqual(["running", "queued", "failed-new"]);
    });
});
