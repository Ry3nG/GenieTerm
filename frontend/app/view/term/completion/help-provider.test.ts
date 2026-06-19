// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { makeHelpFallbackCompletionProvider, parseHelpFlags } from "./help-provider";
import type { CompletionContext } from "./types";

const SAMPLE_HELP = `Usage: nvidia-smi [OPTION]...

    -h,   --help                    Print usage information and exit.
    -L,   --list-gpus               Display a list of GPUs connected to the system.
    -i,   --id=ID                   Target a specific GPU.
          --query-gpu=GPU           Information about GPU to query.
          --format=FORMAT           Specify the output format.
`;

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "nvidia-smi --q",
        cursorIndex: 14,
        tokens: [
            { text: "nvidia-smi", start: 0, end: 10 },
            { text: "--q", start: 11, end: 14 },
        ],
        searchTerm: "--q",
        tokenIndex: 1,
        tokenType: "option",
        cwd: "/home/u",
        connId: "help-spec",
        shellType: "zsh",
        env: {},
        recentCommands: [],
        ...overrides,
    };
}

describe("parseHelpFlags", () => {
    it("extracts flags and descriptions from --help output", () => {
        const flags = parseHelpFlags(SAMPLE_HELP);
        const labels = flags.map((flag) => flag.label);
        expect(labels).toContain("-h");
        expect(labels).toContain("--help");
        expect(labels).toContain("--query-gpu");
        expect(labels).toContain("--format");
        expect(flags.find((flag) => flag.label === "-h")?.detail).toContain("Print usage");
    });
});

describe("makeHelpFallbackCompletionProvider", () => {
    it("runs `<cmd> --help` for spec-less commands and suggests matching flags", async () => {
        const runGenerator = vi.fn(async () => ({ stdout: SAMPLE_HELP, supported: true }));
        const provider = makeHelpFallbackCompletionProvider(runGenerator, () => false);

        const items = await provider.provideCompletions(makeContext({ connId: "help-nvidia" }));

        expect(runGenerator).toHaveBeenCalledWith({
            command: "nvidia-smi",
            args: ["--help"],
            cwd: "/home/u",
            connId: "help-nvidia",
        });
        expect(items.map((item) => item.label)).toEqual(["--query-gpu"]);
    });

    it("stays out of the way for commands that already have a Fig spec", async () => {
        const runGenerator = vi.fn(async () => ({ stdout: SAMPLE_HELP, supported: true }));
        const provider = makeHelpFallbackCompletionProvider(runGenerator, () => true);

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "git --q",
                tokens: [
                    { text: "git", start: 0, end: 3 },
                    { text: "--q", start: 4, end: 7 },
                ],
                cursorIndex: 7,
                connId: "help-git",
            })
        );

        expect(runGenerator).not.toHaveBeenCalled();
        expect(items).toEqual([]);
    });

    it("only triggers when completing a flag", async () => {
        const runGenerator = vi.fn(async () => ({ stdout: SAMPLE_HELP, supported: true }));
        const provider = makeHelpFallbackCompletionProvider(runGenerator, () => false);

        const items = await provider.provideCompletions(
            makeContext({ searchTerm: "foo", tokenType: "argument", connId: "help-arg" })
        );

        expect(runGenerator).not.toHaveBeenCalled();
        expect(items).toEqual([]);
    });
});
