// Copyright 2026, GenieTerm. Apache-2.0.

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ showErrorBox: vi.fn() }));
vi.mock("electron", () => ({
    dialog: { showErrorBox: mocks.showErrorBox },
    Notification: class {
        static isSupported() {
            return false;
        }
        show() {}
    },
    ipcMain: { on: vi.fn() },
    BrowserWindow: { fromWebContents: vi.fn() },
}));

import { startTrackedFolderDownload } from "./download-folder";
import { downloadTransferTracker } from "./download-transfer";
import { invokeTransferCancelHandle } from "./transfer-handles";

let jobSeq = 0;
function enqueueFolderJob() {
    const id = `folder-run-${++jobSeq}`;
    downloadTransferTracker.enqueue({
        id,
        operation: "download",
        itemType: "folder",
        transport: "wsh",
        source: "genie://me@host:2222/~/out",
        destination: "file:///tmp/out",
        label: "out",
    });
    return id;
}

function makeStream() {
    let send: (value: IteratorResult<FileTransferProgress, void>) => void;
    let fail: (error: Error) => void;
    const stream = {
        next: vi.fn((cancel?: boolean) => {
            if (cancel) return Promise.resolve({ done: true, value: undefined });
            return new Promise<IteratorResult<FileTransferProgress, void>>((resolve, reject) => {
                send = resolve;
                fail = reject;
            });
        }),
        return: vi.fn(async () => ({ done: true, value: undefined })),
    };
    return {
        stream: stream as unknown as AsyncGenerator<FileTransferProgress, void, boolean>,
        next: stream.next,
        async progress(data: Partial<FileTransferProgress>) {
            send({ done: false, value: { bytestransferred: 0, filescompleted: 0, filesskipped: 0, ...data } });
            await Promise.resolve();
        },
        async error() {
            fail(new Error("SSH connection closed"));
            await Promise.resolve();
        },
    };
}

afterEach(() => {
    mocks.showErrorBox.mockReset();
    vi.restoreAllMocks();
});

// Native tests cover the same authenticated RPC on macOS, Linux and Windows.
describe("startTrackedFolderDownload", () => {
    it("reports byte/file progress without a fabricated percentage", async () => {
        const jobId = enqueueFolderJob();
        const transfer = makeStream();
        const run = vi.fn(() => transfer.stream);
        const finished = startTrackedFolderDownload(jobId, "genie://me@host/~/My Docs", "/tmp/My Docs", run);
        expect(run).toHaveBeenCalledWith({ srcuri: "genie://me@host/~/My Docs", destpath: "/tmp/My Docs" });
        await transfer.progress({ bytestransferred: 4096, filescompleted: 2, filesskipped: 1 });
        expect(downloadTransferTracker.getJob(jobId).progress).toEqual({
            bytesTransferred: 4096,
            message: "4.0 KB · 2 files copied · 1 links or special files skipped",
        });
        await transfer.progress({ bytestransferred: 8192, filescompleted: 3, done: true });
        await finished;
        expect(downloadTransferTracker.getJob(jobId).status).toBe("completed");
        expect(invokeTransferCancelHandle(jobId)).toBe(false);
    });

    it("uses the next heartbeat to cancel an otherwise idle stream", async () => {
        const jobId = enqueueFolderJob();
        const transfer = makeStream();
        const finished = startTrackedFolderDownload(jobId, "genie://host/~/out", "/tmp/out", () => transfer.stream);
        expect(invokeTransferCancelHandle(jobId)).toBe(true);
        downloadTransferTracker.requestCancel(jobId);
        expect(downloadTransferTracker.getJob(jobId).status).toBe("running");
        await transfer.progress({});
        await finished;
        expect(transfer.next).toHaveBeenCalledWith(true);
        expect(downloadTransferTracker.getJob(jobId).status).toBe("canceled");
        expect(mocks.showErrorBox).not.toHaveBeenCalled();
    });

    it("reports completion when the copy finished before cancellation took effect", async () => {
        const jobId = enqueueFolderJob();
        const transfer = makeStream();
        const finished = startTrackedFolderDownload(jobId, "genie://host/~/out", "/tmp/out", () => transfer.stream);
        invokeTransferCancelHandle(jobId);
        downloadTransferTracker.requestCancel(jobId);
        await transfer.progress({ done: true });
        await finished;
        expect(downloadTransferTracker.getJob(jobId).status).toBe("completed");
        expect(transfer.next).not.toHaveBeenCalledWith(true);
    });

    it("does not start a queued job that was canceled", async () => {
        const jobId = enqueueFolderJob();
        downloadTransferTracker.cancel(jobId);
        const run = vi.fn();
        await startTrackedFolderDownload(jobId, "genie://host/~/out", "/tmp/out", run);
        expect(run).not.toHaveBeenCalled();
    });

    it("fails on disconnect and allows the existing retry action", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const jobId = enqueueFolderJob();
        const transfer = makeStream();
        const finished = startTrackedFolderDownload(jobId, "genie://host/~/out", "/tmp/out", () => transfer.stream);
        await transfer.error();
        await finished;
        expect(downloadTransferTracker.getJob(jobId).status).toBe("failed");
        expect(downloadTransferTracker.getJob(jobId).lastError.detail).toBe("SSH connection closed");
        downloadTransferTracker.retry(jobId);
        const retried = makeStream();
        const retryFinished = startTrackedFolderDownload(jobId, "genie://host/~/out", "/tmp/out", () => retried.stream);
        await retried.progress({ done: true });
        await retryFinished;
        expect(downloadTransferTracker.getJob(jobId)).toMatchObject({ status: "completed", attempt: 2 });
    });

    it("does not let an obsolete attempt mutate a retried transfer", async () => {
        const jobId = enqueueFolderJob();
        const old = makeStream();
        const finished = startTrackedFolderDownload(jobId, "genie://host/~/out", "/tmp/out", () => old.stream);
        downloadTransferTracker.cancel(jobId);
        downloadTransferTracker.retry(jobId);
        const next = makeStream();
        const retryFinished = startTrackedFolderDownload(jobId, "genie://host/~/out", "/tmp/out", () => next.stream);
        await old.progress({ done: true });
        await finished;
        expect(downloadTransferTracker.getJob(jobId).status).toBe("running");
        expect(invokeTransferCancelHandle(jobId)).toBe(true);
        await next.progress({});
        await retryFinished;
        expect(downloadTransferTracker.getJob(jobId).status).toBe("canceled");
    });
});
