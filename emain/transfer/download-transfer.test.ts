import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
    NativeDownloadDestination,
    buildFileDownloadTransferJobInput,
    createDownloadTransferTracker,
    makeTransferQueuePersistence,
    mapNativeDownloadState,
    readTransferQueueSnapshot,
    runTransferUpdate,
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
            if (process.platform !== "win32") {
                expect(fs.statSync(snapshotPath).mode & 0o777).toBe(0o600);
            }
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

    it("ignores late cancel/fail/complete events after a job is already terminal", () => {
        const tracker = createDownloadTransferTracker(() => 1000);
        tracker.enqueue(buildFileDownloadTransferJobInput("wsh://host/~/out.txt", "job-1"));
        tracker.start("job-1");
        tracker.cancel("job-1");

        expect(() => tracker.cancel("job-1")).not.toThrow();
        expect(() => tracker.fail("job-1", { code: "exit", message: "rsync exited" })).not.toThrow();
        expect(() => tracker.complete("job-1")).not.toThrow();
        expect(tracker.getJob("job-1").status).toBe("canceled");
        expect(tracker.updateProgress("job-1", { bytesTransferred: 5 })?.status).toBe("canceled");
        expect(tracker.updateProgress("missing", { bytesTransferred: 5 })).toBeUndefined();
    });

    it("guards transitions run from event listeners so they never throw", () => {
        const tracker = createDownloadTransferTracker(() => 1000);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect(runTransferUpdate("late close", () => tracker.complete("cleared-job"))).toBeUndefined();
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });

    it("keeps notifying other listeners when one listener throws", () => {
        const tracker = createDownloadTransferTracker(() => 1000);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const seen: number[] = [];
        try {
            tracker.subscribe(() => {
                throw new Error("renderer gone");
            });
            tracker.subscribe((queue) => seen.push(queue.jobs.length));
            tracker.enqueue(buildFileDownloadTransferJobInput("wsh://host/~/out.txt", "job-1"));
            expect(seen).toEqual([0, 1]);
        } finally {
            errorSpy.mockRestore();
        }
    });

    it("throttles progress notifications while state transitions notify immediately", () => {
        vi.useFakeTimers();
        try {
            let now = 1000;
            const tracker = createDownloadTransferTracker(() => now, 250);
            const notified: number[] = [];
            tracker.enqueue(buildFileDownloadTransferJobInput("wsh://host/~/big.bin", "job-1"));
            tracker.start("job-1");
            tracker.subscribe((queue) => notified.push(queue.jobs[0].progress.bytesTransferred));
            notified.length = 0;

            for (let index = 1; index <= 10; index++) {
                now += 10;
                tracker.updateProgress("job-1", { bytesTransferred: index * 100, totalBytes: 1000 });
            }
            expect(notified).toEqual([]);
            expect(tracker.getJob("job-1").progress).toMatchObject({ bytesTransferred: 1000, percent: 100 });

            now += 250;
            vi.advanceTimersByTime(250);
            expect(notified).toEqual([1000]);

            tracker.updateProgress("job-1", { bytesTransferred: 1000 });
            tracker.complete("job-1");
            expect(notified).toHaveLength(2);
            vi.advanceTimersByTime(1000);
            expect(notified).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("records cancel requests for running renderer-driven jobs", () => {
        const tracker = createDownloadTransferTracker(() => 1000);
        tracker.enqueue({ ...buildFileDownloadTransferJobInput("wsh://host/~/up.txt", "up-1"), operation: "upload" });
        tracker.start("up-1");
        expect(tracker.requestCancel("up-1")).toMatchObject({ status: "running", cancelRequestedAt: 1000 });
        expect(tracker.complete("up-1").status).toBe("completed");
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
