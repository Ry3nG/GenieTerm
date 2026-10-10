import { describe, expect, it } from "vitest";

import {
    buildLocalUploadTransferPlans,
    createUploadTransferGroupId,
    createUploadTransferJobId,
} from "./transferupload";

describe("transferupload", () => {
    it("builds a file upload plan that preserves local basename and remote directory semantics", () => {
        const plans = buildLocalUploadTransferPlans(
            [{ path: "/home/me/Project Notes/report final.txt", itemType: "file" }],
            "wsh://devbox/~/workspace/uploads",
            { createId: () => "upload-job-1" }
        );

        expect(plans).toEqual([
            {
                srcuri: "file:///home/me/Project%20Notes/report%20final.txt",
                desturi: "wsh://devbox/~/workspace/uploads",
                jobInput: {
                    id: "upload-job-1",
                    operation: "upload",
                    itemType: "file",
                    transport: "wsh",
                    source: "file:///home/me/Project%20Notes/report%20final.txt",
                    destination: "wsh://devbox/~/workspace/uploads/report final.txt",
                    label: "report final.txt",
                },
            },
        ]);
    });

    it("uses a shared group id for multi-item upload plans", () => {
        const plans = buildLocalUploadTransferPlans(
            [
                { path: "/home/me/screenshots", itemType: "folder" },
                { path: "/home/me/logs/app.log", itemType: "file" },
            ],
            "wsh://devbox//var/tmp",
            {
                createId: (_item, index) => `upload-job-${index + 1}`,
                groupId: "upload-group-1",
            }
        );

        expect(plans.map((plan) => plan.jobInput.groupId)).toEqual(["upload-group-1", "upload-group-1"]);
        expect(plans.map((plan) => plan.jobInput.destination)).toEqual([
            "wsh://devbox//var/tmp/screenshots",
            "wsh://devbox//var/tmp/app.log",
        ]);
        expect(plans.map((plan) => plan.jobInput.itemType)).toEqual(["folder", "file"]);
    });

    it("preserves genie upload destination aliases in queued job destinations", () => {
        const plans = buildLocalUploadTransferPlans(
            [{ path: "/home/me/report.txt", itemType: "file" }],
            "genie://devbox/~/workspace/uploads",
            { createId: () => "upload-job-1" }
        );

        expect(plans[0].jobInput.destination).toBe("genie://devbox/~/workspace/uploads/report.txt");
    });

    it("rejects non-remote upload destinations", () => {
        expect(() =>
            buildLocalUploadTransferPlans([{ path: "/home/me/report.txt" }], "file:///tmp/uploads", {
                createId: () => "upload-job-1",
            })
        ).toThrow("Upload destination must be a remote genie:// or wsh:// directory");
    });

    it("rejects root paths from drops instead of building file root upload sources", () => {
        expect(() =>
            buildLocalUploadTransferPlans(
                [{ path: "/", name: "real_exec_aligned.mp4", itemType: "file" }],
                "wsh://devbox/~/workspace/uploads",
                { createId: () => "upload-job-1" }
            )
        ).toThrow("Upload item path must be an absolute local file path");
    });

    it("builds file:///C:/ upload sources for Windows drive and UNC paths", () => {
        const plans = buildLocalUploadTransferPlans(
            [
                { path: "C:\\Users\\me\\My Files\\#1 report 100%.txt", itemType: "file" },
                { path: "\\\\fileserver\\team share\\notes.txt", itemType: "file" },
            ],
            "genie://devbox/~/uploads",
            { createId: (_item, index) => `upload-${index}`, platform: "win32" }
        );

        expect(plans.map((plan) => plan.srcuri)).toEqual([
            "file:///C:/Users/me/My%20Files/%231%20report%20100%25.txt",
            "file://fileserver/team%20share/notes.txt",
        ]);
        expect(plans.map((plan) => plan.jobInput.label)).toEqual(["#1 report 100%.txt", "notes.txt"]);
        expect(plans[0].jobInput.destination).toBe("genie://devbox/~/uploads/#1 report 100%.txt");
    });

    it("percent-encodes characters that would otherwise be read as URI syntax on POSIX", () => {
        const plans = buildLocalUploadTransferPlans(
            [{ path: "/home/me/a#b/100% done?.txt", itemType: "file" }],
            "genie://devbox/~/uploads",
            { createId: () => "upload-1", platform: "linux" }
        );

        expect(plans[0].srcuri).toBe("file:///home/me/a%23b/100%25%20done%3F.txt");
    });

    it("creates stable upload ids and group ids with requested prefixes", () => {
        expect(createUploadTransferJobId("drop-upload")).toMatch(/^drop-upload-\d+-\d+$/);
        expect(createUploadTransferGroupId("multi-upload")).toMatch(/^multi-upload-\d+-\d+$/);
    });
});
