// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { formatCmdBlockDuration, getCmdBlockStatus, getCmdBlockTitle } from "./cmdblockdisplay";
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

    it("builds concise titles with command, status, duration, and cwd", () => {
        expect(getCmdBlockTitle(makeBlock({ state: "done", exitCode: 0, doneTs: 2_500 }), 3_000)).toBe(
            "npm test - OK - 1.5s - ~/work"
        );
    });
});
