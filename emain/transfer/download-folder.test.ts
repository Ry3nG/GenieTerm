import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
    buildFolderDownloadPlan,
    buildFolderDownloadTransferJobInput,
    getRsyncPath,
    mapFolderDownloadError,
} from "./download-folder";

describe("download-folder helpers", () => {
    it("builds a folder download plan", () => {
        expect(buildFolderDownloadPlan("wsh://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out", "darwin")).toEqual({
            folderName: "out",
            transport: "rsync",
            args: ["-az", "paw-5090-ws:~/projects/out/", "/Users/me/Desktop/out/"],
        });
        expect(
            buildFolderDownloadPlan("genie://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out", "darwin")
        ).toEqual({
            folderName: "out",
            transport: "rsync",
            args: ["-az", "paw-5090-ws:~/projects/out/", "/Users/me/Desktop/out/"],
        });
    });

    it("uses Windows OpenSSH without treating a drive letter as an scp host", () => {
        expect(
            buildFolderDownloadPlan("genie://paw-5090-ws/~/projects/out", "C:\\Users\\me\\Desktop\\out", "win32")
        ).toEqual({
            folderName: "out",
            transport: "scp",
            args: ["-r", "paw-5090-ws:~/projects/out/.", "out"],
            cwd: "C:\\Users\\me\\Desktop",
        });
    });

    it("passes an explicit SSH port to Windows scp", () => {
        expect(
            buildFolderDownloadPlan("genie://zrgong@server.example:2222/~/out", "C:\\Downloads\\out", "win32").args
        ).toEqual(["-P", "2222", "-r", "zrgong@server.example:~/out/.", "out"]);
    });

    it("selects the first existing rsync candidate", () => {
        const selected = getRsyncPath((candidate) => candidate === "/usr/local/bin/rsync");
        expect(selected).toBe("/usr/local/bin/rsync");
    });

    it("falls back to PATH rsync when no known absolute path exists", () => {
        const selected = getRsyncPath(() => false);
        expect(selected).toBe("rsync");
    });

    it("builds a queued transfer job for folder downloads after destination selection", () => {
        const destinationPath = path.join(tmpdir(), "genieterm", "out");
        expect(
            buildFolderDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/out", destinationPath, "folder-job-1")
        ).toEqual({
            id: "folder-job-1",
            operation: "download",
            itemType: "folder",
            transport: process.platform === "win32" ? "scp" : "rsync",
            source: "wsh://paw-5090-ws/~/projects/out",
            destination: pathToFileURL(destinationPath).href,
            label: "out",
        });
        expect(
            buildFolderDownloadTransferJobInput(
                "genie://paw-5090-ws/~/projects/out",
                "C:\\Users\\me\\Desktop\\out",
                "folder-job-2",
                "win32"
            ).transport
        ).toBe("scp");
    });

    it("maps folder download failures to stable queue error codes and user messages", () => {
        expect(mapFolderDownloadError("parse", new Error("bad path"))).toEqual({
            code: "invalid_source",
            message: "Could not parse the remote folder path.",
            retryable: false,
            detail: "bad path",
        });
        expect(mapFolderDownloadError("destination", new Error("exists as a file"))).toEqual({
            code: "destination_error",
            message: "Could not prepare the destination folder.",
            retryable: true,
            detail: "exists as a file",
        });
        expect(mapFolderDownloadError("start", new Error("ENOENT"))).toEqual({
            code: "transfer_start_failed",
            message: "Could not start the folder transfer.",
            retryable: true,
            detail: "ENOENT",
        });
        expect(mapFolderDownloadError("exit", new Error("permission denied"))).toEqual({
            code: "transfer_failed",
            message: "Folder transfer failed.",
            retryable: true,
            detail: "permission denied",
        });
        expect(mapFolderDownloadError("canceled")).toEqual({
            code: "download_canceled",
            message: "Folder download canceled.",
            retryable: true,
        });
    });
});
