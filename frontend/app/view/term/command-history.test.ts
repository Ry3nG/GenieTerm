// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { CmdBlock } from "./cmdblocks";
import { makeCommandHistoryEntry, matchesRetainedCommand } from "./command-history";

const Context = { blockid: "block", tabid: "tab", connection: "remote", cwd: "/work", shell: "bash" };
function command(overrides: Partial<CmdBlock> = {}): CmdBlock {
    return {
        id: 1,
        command: "echo hello",
        cwd: "/project",
        state: "done",
        startTs: 1000,
        doneTs: 1200,
        exitCode: 0,
        startMarker: { isDisposed: false, line: 4 } as CmdBlock["startMarker"],
        endMarker: null,
        ...overrides,
    };
}
describe("command history terminal identity", () => {
    it("stores bounded semantic metadata with no terminal buffer and preserves unknown results", () => {
        const saved = makeCommandHistoryEntry(Context, command());
        expect(saved).toMatchObject({ id: "block:1:1000", cwd: "/project", status: "success", commandblockid: 1 });
        expect(saved).not.toHaveProperty("startMarker");
        expect(makeCommandHistoryEntry(Context, command({ interrupted: true, exitCode: null }))?.status).toBe(
            "unknown"
        );
        expect(makeCommandHistoryEntry(Context, command({ startTs: 0 }))).toBeNull();
        expect(makeCommandHistoryEntry(Context, command({ command: "# command too large (5000 bytes)" }))).toBeNull();
    });
    it("never jumps to a recycled block id or disposed marker", () => {
        const saved = makeCommandHistoryEntry(Context, command());
        expect(matchesRetainedCommand(saved, "block", command())).toBe(true);
        expect(matchesRetainedCommand(saved, "other", command())).toBe(false);
        expect(matchesRetainedCommand(saved, "block", command({ startTs: 2000 }))).toBe(false);
        expect(matchesRetainedCommand(saved, "block", command({ command: "other" }))).toBe(false);
        expect(
            matchesRetainedCommand(
                saved,
                "block",
                command({ startMarker: { isDisposed: true } as CmdBlock["startMarker"] })
            )
        ).toBe(false);
    });
});
