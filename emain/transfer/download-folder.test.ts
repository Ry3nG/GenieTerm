import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
    buildFolderDownloadTransferJobInput,
    getUniqueDestinationPath,
    inspectFolderDestination,
    mapFolderDownloadError,
} from "./download-folder";

describe("download-folder helpers", () => {
    it("detects existing destinations and picks a unique sibling name", () => {
        const dir = fs.mkdtempSync(path.join(tmpdir(), "genieterm-folder-dest-"));
        try {
            const target = path.join(dir, "out");
            expect(inspectFolderDestination(target)).toBe("missing");
            fs.mkdirSync(target);
            expect(inspectFolderDestination(target)).toBe("empty-folder");
            fs.writeFileSync(path.join(target, "a.txt"), "a");
            expect(inspectFolderDestination(target)).toBe("non-empty-folder");
            fs.writeFileSync(path.join(dir, "file"), "x");
            expect(inspectFolderDestination(path.join(dir, "file"))).toBe("not-folder");
            expect(getUniqueDestinationPath(target)).toBe(path.join(dir, "out (1)"));
            fs.mkdirSync(path.join(dir, "out (1)"));
            expect(getUniqueDestinationPath(target)).toBe(path.join(dir, "out (2)"));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("builds a queued transfer job for folder downloads after destination selection", () => {
        const destinationPath = path.join(tmpdir(), "genieterm", "out");
        expect(
            buildFolderDownloadTransferJobInput("wsh://paw-5090-ws/~/projects/out", destinationPath, "folder-job-1")
        ).toEqual({
            id: "folder-job-1",
            operation: "download",
            itemType: "folder",
            transport: "wsh",
            source: "wsh://paw-5090-ws/~/projects/out",
            destination: pathToFileURL(destinationPath).href,
            label: "out",
        });
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
