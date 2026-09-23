import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    NativeDownloadDestination,
    buildFileDownloadTransferJobInput,
    createDownloadTransferTracker,
    mapNativeDownloadState,
    makeTransferQueuePersistence,
    readTransferQueueSnapshot,
    writeTransferQueueSnapshot,
} from "./download-transfer";

describe("download-transfer helpers", () => {
    it("coalesces burst updates and flushes the final queue on quit", () => {
        vi.useFakeTimers();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genieterm-transfer-burst-"));
        try {
            const snapshotPath = path.join(dir, "transfers.json");
            const persistence = makeTransferQueuePersistence(snapshotPath, 100);
            const tracker = createDownloadTransferTracker(() => 1000);
            for (let index = 0; index < 100; index++) {
                tracker.enqueue(buildFileDownloadTransferJobInput("wsh://host/~/out.txt", `job-${index}`));
                persistence.update(tracker.getQueue());
            }
            expect(fs.existsSync(snapshotPath)).toBe(false);
            vi.advanceTimersByTime(100);
            expect(readTransferQueueSnapshot(snapshotPath, 2000).jobs).toHaveLength(100);
            tracker.start("job-0");
            tracker.complete("job-0");
            persistence.update(tracker.getQueue());
            persistence.flush();
            expect(readTransferQueueSnapshot(snapshotPath, 2000).jobs[0].status).toBe("completed");
        } finally {
            vi.useRealTimers();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("persists a transfer queue and recovers a running job after restart", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genieterm-transfer-test-"));
        try {
            const tracker = createDownloadTransferTracker(() => 1000);
            tracker.enqueue(buildFileDownloadTransferJobInput("wsh://host/~/out.txt", "job-1"));
            tracker.start("job-1");
            const snapshotPath = path.join(dir, "transfers.json");
            writeTransferQueueSnapshot(snapshotPath, tracker.getQueue());
            const recovered = readTransferQueueSnapshot(snapshotPath, 2000);
            expect(recovered.jobs[0]).toMatchObject({
                id: "job-1",
                status: "failed",
                lastError: { code: "transfer_interrupted", retryable: true },
            });
            expect(fs.statSync(snapshotPath).mode & 0o777).toBe(0o600);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("builds file download jobs for the native Electron download flow", () => {
        expect(buildFileDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/out.txt", "file-job-1")).toEqual({
            id: "file-job-1",
            operation: "download",
            itemType: "file",
            transport: "wsh",
            source: "wsh://paw-5090-ws/~/projects/out.txt",
            destination: NativeDownloadDestination,
            label: "out.txt",
        });
        expect(buildFileDownloadTransferJobInput("genie://paw-5090-ws/~/projects/out.txt", "file-job-2")).toEqual({
            id: "file-job-2",
            operation: "download",
            itemType: "file",
            transport: "wsh",
            source: "genie://paw-5090-ws/~/projects/out.txt",
            destination: NativeDownloadDestination,
            label: "out.txt",
        });
    });

    it("tracks download queue lifecycle for Electron transfer handlers", () => {
        const tracker = createDownloadTransferTracker(() => 1000);
        const queued = tracker.enqueue(
            buildFileDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/out.txt", "file-job-1")
        );

        expect(queued).toMatchObject({ id: "file-job-1", status: "queued", createdAt: 1000 });

        const running = tracker.start("file-job-1");
        expect(running).toMatchObject({ id: "file-job-1", status: "running", startedAt: 1000 });

        const failed = tracker.fail("file-job-1", {
            code: "native_download_failed",
            message: "Native download failed",
            retryable: true,
        });
        expect(failed).toMatchObject({
            id: "file-job-1",
            status: "failed",
            failureHistory: [
                {
                    attempt: 1,
                    failedAt: 1000,
                    error: {
                        code: "native_download_failed",
                        message: "Native download failed",
                        retryable: true,
                    },
                },
            ],
        });
    });

    it("notifies subscribers with queue snapshots after lifecycle changes", () => {
        const tracker = createDownloadTransferTracker(() => 1000);
        const snapshots: string[][] = [];
        const unsubscribe = tracker.subscribe((queue) => {
            snapshots.push(queue.jobs.map((job) => `${job.id}:${job.status}`));
        });

        tracker.enqueue(buildFileDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/out.txt", "file-job-1"));
        tracker.start("file-job-1");
        tracker.complete("file-job-1");
        unsubscribe();

        tracker.enqueue(buildFileDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/ignored.txt", "file-job-2"));

        expect(snapshots).toEqual([[], ["file-job-1:queued"], ["file-job-1:running"], ["file-job-1:completed"]]);
    });

    it("clears inactive jobs and notifies subscribers", () => {
        const tracker = createDownloadTransferTracker(() => 1000);
        const snapshots: string[][] = [];
        tracker.subscribe((queue) => {
            snapshots.push(queue.jobs.map((job) => `${job.id}:${job.status}`));
        });

        tracker.enqueue(buildFileDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/active.txt", "active"));
        tracker.start("active");
        tracker.enqueue(buildFileDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/done.txt", "done"));
        tracker.start("done");
        tracker.complete("done");
        tracker.clearInactive();

        expect(tracker.getQueue().jobs.map((job) => `${job.id}:${job.status}`)).toEqual(["active:running"]);
        expect(snapshots[snapshots.length - 1]).toEqual(["active:running"]);
    });

    it("maps native Electron download completion states to transfer outcomes", () => {
        expect(mapNativeDownloadState("completed")).toEqual({ status: "completed" });
        expect(mapNativeDownloadState("cancelled")).toEqual({
            status: "canceled",
            error: { code: "download_canceled", message: "Download canceled", retryable: true },
        });
        expect(mapNativeDownloadState("interrupted")).toEqual({
            status: "failed",
            error: { code: "native_download_failed", message: "Native download interrupted", retryable: true },
        });
    });
});
