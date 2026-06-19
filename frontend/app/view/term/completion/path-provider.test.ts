// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { makePathCommandCompletionProvider, parsePathExecutables } from "./path-provider";
import type { CompletionContext } from "./types";

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "nvidia",
        cursorIndex: 6,
        tokens: [{ text: "nvidia", start: 0, end: 6 }],
        searchTerm: "nvidia",
        tokenIndex: 0,
        tokenType: "command",
        cwd: "/home/u",
        connId: "path-spec",
        shellType: "zsh",
        env: {},
        recentCommands: [],
        ...overrides,
    };
}

describe("parsePathExecutables", () => {
    it("trims and dedupes executable names", () => {
        expect(parsePathExecutables("git\nnvidia-smi\ngit\n\n  ls  \n")).toEqual(["git", "nvidia-smi", "ls"]);
    });
});

describe("makePathCommandCompletionProvider", () => {
    it("lists PATH executables matching the command prefix (e.g. nvidia-*)", async () => {
        const runGenerator = vi.fn(async () => ({
            stdout: "nvidia-smi\nnvidia-detector\nnvidia-bug-report.sh\nls\ngit\n",
            supported: true,
        }));
        const provider = makePathCommandCompletionProvider(runGenerator);

        const items = await provider.provideCompletions(makeContext({ connId: "path-nvidia" }));

        expect(runGenerator).toHaveBeenCalledWith({
            command: "sh",
            args: ["-c", expect.stringContaining("$PATH")],
            cwd: "/home/u",
            connId: "path-nvidia",
        });
        expect(items.map((item) => item.label)).toEqual(["nvidia-smi", "nvidia-detector", "nvidia-bug-report.sh"]);
        expect(items[0]).toMatchObject({ kind: "command", source: "path" });
    });

    it("does not run except at the command position", async () => {
        const runGenerator = vi.fn(async () => ({ stdout: "", supported: true }));
        const provider = makePathCommandCompletionProvider(runGenerator);

        const items = await provider.provideCompletions(
            makeContext({ tokenIndex: 1, searchTerm: "foo", connId: "path-noop" })
        );

        expect(runGenerator).not.toHaveBeenCalled();
        expect(items).toEqual([]);
    });
});
