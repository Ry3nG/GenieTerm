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
            detail: "Downloading folder - 50%",
            subdetail: "copying files",
            tone: "active",
            iconClass: "fa-solid fa-spinner",
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
            detail: "Download failed",
            errorText: "Folder transfer failed. rsync exited with code 23.",
            tone: "danger",
            iconClass: "fa-solid fa-circle-exclamation",
        });
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
        expect(summary.hiddenCount).toBe(2);
        expect(summary.jobs.map((display) => display.id)).toEqual(["running", "queued", "failed-new"]);
    });
});
