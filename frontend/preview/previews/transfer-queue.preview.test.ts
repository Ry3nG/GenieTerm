import { describe, expect, it } from "vitest";

import { makeTransferQueuePreviewState } from "./transfer-queue.preview-util";

describe("transfer queue preview state", () => {
    it("includes the visible lifecycle states used by the Files preview surface", () => {
        const queue = makeTransferQueuePreviewState();

        expect(queue.jobs.map((job) => job.status)).toEqual(["queued", "running", "completed", "failed", "canceled"]);
        expect(queue.jobs.find((job) => job.status === "failed")?.lastError?.message).toBe("Folder transfer failed.");
    });
});
