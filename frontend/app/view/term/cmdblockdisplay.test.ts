// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    formatCmdBlockDuration,
    getCmdBlockStatus,
    getCmdBlockTitle,
    getCommandRunBlockedReason,
} from "./cmdblockdisplay";
import type { CmdBlock } from "./cmdblocks";

function makeBlock(overrides: Partial<CmdBlock>): CmdBlock {
    return {
        id: 1,
        startMarker: { line: 10, dispose: () => {} } as any,
        endMarker: null,
        command: "npm test",
        exitCode: null,
        state: "running",
        startTs: 1_000,
        doneTs: null,
        cwd: "~/work",
        ...overrides,
    };
}

describe("cmdblockdisplay", () => {
    it("formats running and completed durations", () => {
        expect(formatCmdBlockDuration(makeBlock({ startTs: 1_000, doneTs: null }), 2_250)).toBe("1.3s");
        expect(formatCmdBlockDuration(makeBlock({ startTs: 1_000, doneTs: 66_000 }), 80_000)).toBe("1m 5s");
    });

    it("maps block status to stable labels and tones", () => {
        expect(getCmdBlockStatus(makeBlock({ state: "running", exitCode: null }))).toEqual({
            label: "Running",
            tone: "running",
            iconClass: "fa-solid fa-spinner fa-spin",
        });
        expect(getCmdBlockStatus(makeBlock({ state: "done", exitCode: 0 }))).toEqual({
            label: "OK",
            tone: "success",
            iconClass: "fa-solid fa-check",
        });
        expect(getCmdBlockStatus(makeBlock({ state: "done", exitCode: 2 }))).toEqual({
            label: "Exit 2",
            tone: "error",
            iconClass: "fa-solid fa-xmark",
        });
    });

    it("shows blocks that ended without an exit code as interrupted/unknown, not as an error", () => {
        expect(getCmdBlockStatus(makeBlock({ state: "done", exitCode: null, interrupted: true }))).toMatchObject({
            label: "Interrupted",
            tone: "unknown",
        });
        expect(getCmdBlockStatus(makeBlock({ state: "done", exitCode: null }))).toMatchObject({ tone: "unknown" });
        expect(getCmdBlockStatus(makeBlock({ state: "done", exitCode: null })).label).not.toContain("?");
    });

    it("hides the duration of a finished block whose end time is unknown", () => {
        expect(formatCmdBlockDuration(makeBlock({ state: "done", startTs: 1_000, doneTs: null }), 90_000)).toBe("");
        expect(formatCmdBlockDuration(makeBlock({ state: "running", startTs: 0 }), 90_000)).toBe("");
    });

    it("only allows re-running a recorded command at an idle prompt", () => {
        const ready = { shellIntegrationStatus: "ready" as const, altScreenActive: false };
        expect(getCommandRunBlockedReason("npm test", ready)).toBeNull();
        expect(
            getCommandRunBlockedReason("npm test", { ...ready, shellIntegrationStatus: "running-command" })
        ).not.toBeNull();
        expect(getCommandRunBlockedReason("npm test", { ...ready, shellIntegrationStatus: null })).not.toBeNull();
        expect(getCommandRunBlockedReason("npm test", { ...ready, altScreenActive: true })).not.toBeNull();
        expect(getCommandRunBlockedReason("# command too large (9000 bytes)", ready)).not.toBeNull();
        expect(getCommandRunBlockedReason("  ", ready)).not.toBeNull();
    });

    it("builds concise titles with command, status, duration, and cwd", () => {
        expect(getCmdBlockTitle(makeBlock({ state: "done", exitCode: 0, doneTs: 2_500 }), 3_000)).toBe(
            "npm test - OK - 1.5s - ~/work"
        );
    });
});

describe("cmdblockdisplay interrupts", () => {
    it("shows a Ctrl-C exit as interrupted rather than an error", () => {
        const status = getCmdBlockStatus(makeBlock({ state: "done", exitCode: 130, doneTs: 2_000 }));
        expect(status).toMatchObject({ label: "Interrupted", tone: "unknown" });
        expect(getCmdBlockStatus(makeBlock({ state: "done", exitCode: 1, doneTs: 2_000 })).tone).toBe("error");
    });
});
