import { describe, expect, it } from "vitest";

import { buildLocalUploadTransferPlans, createUploadTransferJobId, createUploadTransferGroupId } from "./transferupload";

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

    it("rejects non-remote upload destinations", () => {
        expect(() =>
            buildLocalUploadTransferPlans([{ path: "/home/me/report.txt" }], "file:///tmp/uploads", {
                createId: () => "upload-job-1",
            })
        ).toThrow("Upload destination must be a remote wsh:// directory");
    });

    it("creates stable upload ids and group ids with requested prefixes", () => {
        expect(createUploadTransferJobId("drop-upload")).toMatch(/^drop-upload-\d+-\d+$/);
        expect(createUploadTransferGroupId("multi-upload")).toMatch(/^multi-upload-\d+-\d+$/);
    });
});
