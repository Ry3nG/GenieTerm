// Copyright 2026, GenieTerm. Apache-2.0.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
    execFile: vi.fn(),
    showErrorBox: vi.fn(),
}));

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

vi.mock("node:child_process", () => ({
    spawn: mocks.spawn,
    execFile: mocks.execFile,
}));

import { startTrackedFolderDownload } from "./download-folder";
import { downloadTransferTracker } from "./download-transfer";
import { invokeTransferCancelHandle } from "./transfer-handles";

type FakeChild = EventEmitter & { stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };

function makeFakeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    return child;
}

let jobSeq = 0;

function enqueueFolderJob(): string {
    jobSeq += 1;
    const id = `folder-run-${jobSeq}`;
    downloadTransferTracker.enqueue({
        id,
        operation: "download",
        itemType: "folder",
        transport: process.platform === "win32" ? "scp" : "rsync",
        source: "genie://me@host:2222/~/out",
        destination: "file:///tmp/out",
        label: "out",
    });
    return id;
}

// Native tests cover rsync on macOS/Linux and scp on Windows.
describe("startTrackedFolderDownload", () => {
    let child: FakeChild;
    let uncaught: unknown[];
    const onUncaught = (err: unknown) => uncaught.push(err);

    beforeEach(() => {
        uncaught = [];
        process.on("uncaughtException", onUncaught);
        child = makeFakeChild();
        mocks.spawn.mockReset().mockReturnValue(child);
        mocks.execFile.mockReset().mockImplementation((_cmd, _args, _opts, cb) => {
            cb(
                null,
                process.platform === "win32"
                    ? "OpenSSH_for_Windows_8.1p1, LibreSSL 3.0.2"
                    : "openrsync: protocol version 29\nrsync version 2.6.9 compatible",
                ""
            );
        });
        mocks.showErrorBox.mockReset();
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        process.off("uncaughtException", onUncaught);
        vi.restoreAllMocks();
    });

    it("cancels without throwing when the killed process closes afterwards", async () => {
        const jobId = enqueueFolderJob();
        await startTrackedFolderDownload(jobId, "genie://me@host:2222/~/My Docs", "/tmp/My Docs");
        expect(downloadTransferTracker.getJob(jobId).status).toBe("running");
        const [, args] = mocks.spawn.mock.calls[0];
        if (process.platform === "win32") {
            expect(args).toContain("-P");
            expect(args).toContain("2222");
            expect(args).toContain("me@host:'My Docs/.'");
        } else {
            expect(args).toContain("ssh -o BatchMode=yes -o ConnectTimeout=15 -p 2222");
            expect(args).toContain("me@host:'My Docs/'");
        }

        expect(invokeTransferCancelHandle(jobId)).toBe(true);
        downloadTransferTracker.cancel(jobId);
        expect(child.kill).toHaveBeenCalled();

        expect(() => child.emit("close", null, "SIGTERM")).not.toThrow();
        expect(() => child.emit("close", 1, null)).not.toThrow();
        expect(downloadTransferTracker.getJob(jobId).status).toBe("canceled");
        expect(mocks.showErrorBox).not.toHaveBeenCalled();
        expect(uncaught).toEqual([]);
    });

    it("tolerates a close event for a job that was already cleared from the queue", async () => {
        const jobId = enqueueFolderJob();
        await startTrackedFolderDownload(jobId, "genie://me@host:2222/~/out", "/tmp/out");
        downloadTransferTracker.cancel(jobId);
        downloadTransferTracker.clearInactive();

        expect(() => child.emit("close", 0, null)).not.toThrow();
        expect(downloadTransferTracker.findJob(jobId)).toBeUndefined();
    });

    it("does not spawn when the job was canceled while the plan was being prepared", async () => {
        const jobId = enqueueFolderJob();
        const started = startTrackedFolderDownload(jobId, "genie://me@host/~/out", "/tmp/out");
        downloadTransferTracker.cancel(jobId);
        await started;
        expect(mocks.spawn).not.toHaveBeenCalled();
        expect(downloadTransferTracker.getJob(jobId).status).toBe("canceled");
    });

    it("fails with an actionable message when batch-mode ssh cannot authenticate", async () => {
        const jobId = enqueueFolderJob();
        await startTrackedFolderDownload(jobId, "genie://me@host/~/out", "/tmp/out");
        child.stderr.emit("data", Buffer.from("me@host: Permission denied (publickey).\n"));
        child.emit("close", 255, null);

        const job = downloadTransferTracker.getJob(jobId);
        expect(job.status).toBe("failed");
        expect(job.lastError.detail).toContain("ssh-agent");
        expect(mocks.showErrorBox).toHaveBeenCalledTimes(1);
    });

    it.skipIf(process.platform === "win32")("uses -s instead of shell quoting with rsync 3", async () => {
        mocks.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
            cb(null, "rsync  version 3.4.1  protocol version 32", "");
        });
        vi.resetModules();
        const folder = await import("./download-folder");
        const transfer = await import("./download-transfer");
        transfer.downloadTransferTracker.enqueue({
            id: "rsync3-job",
            operation: "download",
            itemType: "folder",
            transport: "rsync",
            source: "genie://host/~/My Docs",
            destination: "file:///tmp/My%20Docs",
            label: "My Docs",
        });
        await folder.startTrackedFolderDownload("rsync3-job", "genie://host/~/My Docs", "/tmp/My Docs");
        const [, args] = mocks.spawn.mock.calls[0];
        expect(args.slice(3)).toEqual(["-s", "--", "host:My Docs/", "/tmp/My Docs/"]);
    });

    it("retries a failed transfer and completes only the retried attempt", async () => {
        const jobId = enqueueFolderJob();
        await startTrackedFolderDownload(jobId, "genie://me@host/~/out", "/tmp/out");
        child.emit("close", 255, null);
        expect(downloadTransferTracker.getJob(jobId).status).toBe("failed");

        downloadTransferTracker.retry(jobId);
        const retryChild = makeFakeChild();
        mocks.spawn.mockReturnValue(retryChild);
        await startTrackedFolderDownload(jobId, "genie://me@host/~/out", "/tmp/out");
        child.emit("close", 0, null);
        expect(downloadTransferTracker.getJob(jobId).status).toBe("running");
        retryChild.emit("close", 0, null);
        expect(downloadTransferTracker.getJob(jobId).status).toBe("completed");
        expect(invokeTransferCancelHandle(jobId)).toBe(false);
    });

    it.skipIf(process.platform !== "win32")("explains a missing Windows OpenSSH client", async () => {
        const jobId = enqueueFolderJob();
        await startTrackedFolderDownload(jobId, "genie://me@host/~/out", "C:\\Downloads\\out");
        child.emit("error", Object.assign(new Error("spawn scp ENOENT"), { code: "ENOENT" }));
        child.emit("close", -1, null);

        expect(downloadTransferTracker.getJob(jobId).status).toBe("failed");
        expect(downloadTransferTracker.getJob(jobId).lastError.detail).toContain("Windows OpenSSH Client");
        expect(mocks.showErrorBox).toHaveBeenCalledTimes(1);
        expect(invokeTransferCancelHandle(jobId)).toBe(false);
    });

    it.skipIf(process.platform !== "win32")("uses unquoted SFTP paths with Windows OpenSSH 9", async () => {
        mocks.execFile.mockImplementation((_cmd, _args, _opts, cb) => {
            cb(null, "", "OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2");
        });
        vi.resetModules();
        const folder = await import("./download-folder");
        const transfer = await import("./download-transfer");
        transfer.downloadTransferTracker.enqueue({
            id: "windows-sftp-job",
            operation: "download",
            itemType: "folder",
            transport: "scp",
            source: "genie://host/~/My Docs",
            destination: "file:///C:/Downloads/My%20Docs",
            label: "My Docs",
        });
        await folder.startTrackedFolderDownload("windows-sftp-job", "genie://host/~/My Docs", "C:\\Downloads\\My Docs");
        const [command, args, options] = mocks.spawn.mock.calls[0];
        expect(command).toBe("scp");
        expect(args.slice(-3)).toEqual(["--", "host:My Docs/.", "My Docs"]);
        expect(options).toEqual({ cwd: "C:\\Downloads", windowsHide: true });
        child.emit("close", 0, null);
        expect(transfer.downloadTransferTracker.getJob("windows-sftp-job").status).toBe("completed");
    });
});
