import { describe, expect, it } from "vitest";

import { buildFolderDownloadPlan, getRsyncPath } from "./download-folder";

describe("download-folder helpers", () => {
    it("builds a folder download plan", () => {
        expect(buildFolderDownloadPlan("wsh://paw-5090-ws/~/projects/out", "/Users/me/Desktop/out")).toEqual({
            folderName: "out",
            rsyncArgs: ["-az", "paw-5090-ws:~/projects/out/", "/Users/me/Desktop/out/"],
        });
    });

    it("selects the first existing rsync candidate", () => {
        const selected = getRsyncPath((candidate) => candidate === "/usr/local/bin/rsync");
        expect(selected).toBe("/usr/local/bin/rsync");
    });

    it("falls back to PATH rsync when no known absolute path exists", () => {
        const selected = getRsyncPath(() => false);
        expect(selected).toBe("rsync");
    });
});
