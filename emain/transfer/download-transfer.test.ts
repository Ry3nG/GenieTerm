import { describe, expect, it } from "vitest";

import {
    NativeDownloadDestination,
    buildFileDownloadTransferJobInput,
    createDownloadTransferTracker,
    mapNativeDownloadState,
} from "./download-transfer";

describe("download-transfer helpers", () => {
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
