// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as TermTypes from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import type { CmdBlock } from "./cmdblocks";
import { captureCommandOutput, findOutputMatches, MaxOutputMatches, nextOutputMatchIndex } from "./output-inspector";

function fixture(lines: string[], overrides: Partial<CmdBlock> = {}) {
    const block = {
        id: 1,
        command: "build",
        cwd: "/repo",
        startTs: 10,
        doneTs: 20,
        state: "done",
        exitCode: 1,
        startMarker: { line: 0 },
        outputMarker: { line: 2 },
        endMarker: { line: lines.length },
        ...overrides,
    } as CmdBlock;
    const terminal = {
        buffer: {
            active: {
                length: lines.length,
                baseY: 0,
                cursorY: lines.length - 1,
                getLine: (index: number) => ({ translateToString: () => lines[index], isWrapped: false }),
            },
        },
    } as unknown as TermTypes.Terminal;
    return { block, terminal };
}

describe("command output inspection", () => {
    it("captures only output after a multiline prompt and freezes command metadata", () => {
        const { block, terminal } = fixture(["/repo", "$ build", "compiling", "failed"]);
        const snapshot = captureCommandOutput(block, terminal, "devbox");
        block.command = "another command";
        expect(snapshot).toMatchObject({
            command: "build",
            text: "compiling\nfailed",
            exitcode: 1,
            connection: "devbox",
            truncated: false,
        });
    });

    it("bounds capture to the tail before traversing a large scrollback", () => {
        const { block, terminal } = fixture(Array.from({ length: 6000 }, (_, index) => `line ${index}`));
        const snapshot = captureCommandOutput(block, terminal, "local");
        expect(snapshot.text.startsWith("line 4000\n")).toBe(true);
        expect(snapshot.text.endsWith("line 5999")).toBe(true);
        expect(snapshot.text.split("\n")).toHaveLength(2000);
        expect(snapshot.truncated).toBe(true);
    });

    it("does not return unrelated buffer data when the command was evicted", () => {
        const { block, terminal } = fixture(["other", "text"], { startMarker: { line: -1 } as TermTypes.IMarker });
        expect(captureCommandOutput(block, terminal, "local").text).toBe("");
    });

    it("searches literals, keeps original Unicode offsets, and caps dense results", () => {
        expect(findOutputMatches("İ prefix [ERROR] then [error]", "[error]")).toEqual([9, 22]);
        expect(findOutputMatches("many", "")).toEqual([]);
        expect(findOutputMatches("a".repeat(10000), "a")).toHaveLength(MaxOutputMatches);
    });

    it("starts search navigation at the first match, then wraps in both directions", () => {
        expect(nextOutputMatchIndex(-1, 3, 1)).toBe(0);
        expect(nextOutputMatchIndex(0, 3, 1)).toBe(1);
        expect(nextOutputMatchIndex(2, 3, 1)).toBe(0);
        expect(nextOutputMatchIndex(-1, 3, -1)).toBe(2);
        expect(nextOutputMatchIndex(0, 3, -1)).toBe(2);
        expect(nextOutputMatchIndex(2, 0, 1)).toBe(-1);
        expect(nextOutputMatchIndex(10, 3, 1)).toBe(0);
    });
});
