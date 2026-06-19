// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { makeFigStaticCompletionProvider } from "./fig-static-provider";
import type { CompletionContext } from "./types";

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "git ch",
        cursorIndex: 6,
        tokens: [
            { text: "git", start: 0, end: 3 },
            { text: "ch", start: 4, end: 6 },
        ],
        searchTerm: "ch",
        tokenIndex: 1,
        tokenType: "subcommand",
        cwd: "/repo",
        connId: "",
        shellType: "zsh",
        env: {},
        recentCommands: [],
        ...overrides,
    };
}

describe("makeFigStaticCompletionProvider", () => {
    it("suggests command names at the command position", async () => {
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["git", "grep", "npm"],
            loadSpec: vi.fn(),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "g",
                cursorIndex: 1,
                tokens: [{ text: "g", start: 0, end: 1 }],
                searchTerm: "g",
                tokenIndex: 0,
                tokenType: "command",
            })
        );

        expect(items.map((item) => item.label)).toEqual(["git", "grep"]);
    });

    it("suggests root subcommands from a Fig spec", async () => {
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["git"],
            loadSpec: async () => ({
                name: "git",
                subcommands: [
                    { name: "checkout", description: "Switch branches" },
                    { name: "status", description: "Show status" },
                ],
            }),
        });

        const items = await provider.provideCompletions(makeContext());

        expect(items).toEqual([
            {
                label: "checkout",
                insertText: "checkout",
                kind: "subcommand",
                detail: "Switch branches",
                score: 700,
            },
        ]);
    });

    it("suggests options for the current command or subcommand", async () => {
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["df"],
            loadSpec: async () => ({
                name: "df",
                options: [
                    { name: "-a", description: "Show all mount points" },
                    { name: ["-h", "--human-readable"], description: "Human readable" },
                ],
            }),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "df -",
                cursorIndex: 4,
                tokens: [
                    { text: "df", start: 0, end: 2 },
                    { text: "-", start: 3, end: 4 },
                ],
                searchTerm: "-",
                tokenIndex: 1,
                tokenType: "option",
            })
        );

        expect(items.map((item) => item.label)).toEqual(["-a", "-h", "--human-readable"]);
        expect(items[1]).toMatchObject({ insertText: "-h", kind: "flag", detail: "Human readable" });
    });

    it("suggests static Fig argument suggestions for an option that expects an argument", async () => {
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["git"],
            loadSpec: async () => ({
                name: "git",
                subcommands: [
                    {
                        name: "commit",
                        options: [
                            {
                                name: "--cleanup",
                                args: {
                                    name: "mode",
                                    suggestions: [
                                        { name: "strip", description: "Strip comments and whitespace" },
                                        "verbatim",
                                    ],
                                },
                            },
                        ],
                    },
                ],
            }),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "git commit --cleanup ",
                cursorIndex: 21,
                tokens: [
                    { text: "git", start: 0, end: 3 },
                    { text: "commit", start: 4, end: 10 },
                    { text: "--cleanup", start: 11, end: 20 },
                ],
                searchTerm: "",
                tokenIndex: 3,
                tokenType: "argument",
            })
        );

        expect(items).toEqual([
            {
                label: "strip",
                insertText: "strip",
                kind: "argument",
                detail: "Strip comments and whitespace",
                score: 700,
            },
            {
                label: "verbatim",
                insertText: "verbatim",
                kind: "argument",
                detail: "mode",
                score: 699,
            },
        ]);
    });

    it("walks nested subcommands before suggesting the active level", async () => {
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["docker"],
            loadSpec: async () => ({
                name: "docker",
                subcommands: [
                    {
                        name: "compose",
                        subcommands: [
                            { name: "up", description: "Create and start containers" },
                            { name: "logs", description: "View output" },
                        ],
                    },
                ],
            }),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "docker compose u",
                cursorIndex: 16,
                tokens: [
                    { text: "docker", start: 0, end: 6 },
                    { text: "compose", start: 7, end: 14 },
                    { text: "u", start: 15, end: 16 },
                ],
                searchTerm: "u",
                tokenIndex: 2,
                tokenType: "argument",
            })
        );

        expect(items).toEqual([
            {
                label: "up",
                insertText: "up",
                kind: "subcommand",
                detail: "Create and start containers",
                score: 700,
            },
        ]);
    });

    it("loads real packaged Fig specs through the default loader", async () => {
        const provider = makeFigStaticCompletionProvider();

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "df -",
                cursorIndex: 4,
                tokens: [
                    { text: "df", start: 0, end: 2 },
                    { text: "-", start: 3, end: 4 },
                ],
                searchTerm: "-h",
                tokenIndex: 1,
                tokenType: "option",
            })
        );

        expect(items).toContainEqual(
            expect.objectContaining({
                label: "-h",
                insertText: "-h",
                kind: "flag",
                detail: '"Human-readable" output, uses base 2 unit suffixes',
            })
        );
    });

    it("runs argument generators and post-processes their output into live suggestions", async () => {
        const runGenerator = vi.fn(async () => ({
            stdout: "  main\n  feature/login\n* develop\n",
            supported: true,
        }));
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["git"],
            runGenerator,
            loadSpec: async () => ({
                name: "git",
                subcommands: [
                    {
                        name: "checkout",
                        args: {
                            name: "branch",
                            generators: {
                                script: ["git", "branch", "--no-color"],
                                postProcess: (out: string) =>
                                    out
                                        .split("\n")
                                        .map((line) => line.replace(/^[*\s]+/, "").trim())
                                        .filter(Boolean)
                                        .map((name) => ({ name })),
                            },
                        },
                    },
                ],
            }),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "git checkout fe",
                cursorIndex: 15,
                tokens: [
                    { text: "git", start: 0, end: 3 },
                    { text: "checkout", start: 4, end: 12 },
                    { text: "fe", start: 13, end: 15 },
                ],
                searchTerm: "fe",
                tokenIndex: 2,
                tokenType: "argument",
                cwd: "/repo-branches",
            })
        );

        expect(runGenerator).toHaveBeenCalledWith({
            command: "git",
            args: ["branch", "--no-color"],
            cwd: "/repo-branches",
            connId: "",
        });
        expect(items.map((item) => item.label)).toEqual(["feature/login"]);
        expect(items[0]).toMatchObject({ insertText: "feature/login", kind: "argument" });
    });

    it("returns no generator items when the connection cannot run generators", async () => {
        const runGenerator = vi.fn(async () => ({ stdout: "", supported: false }));
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["git"],
            runGenerator,
            loadSpec: async () => ({
                name: "git",
                subcommands: [{ name: "checkout", args: { name: "branch", generators: { script: "git branch" } } }],
            }),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "git checkout ",
                cursorIndex: 13,
                tokens: [
                    { text: "git", start: 0, end: 3 },
                    { text: "checkout", start: 4, end: 12 },
                ],
                searchTerm: "",
                tokenIndex: 2,
                tokenType: "argument",
                cwd: "/repo-remote",
            })
        );

        expect(runGenerator).toHaveBeenCalled();
        expect(items).toEqual([]);
    });

    it("follows isCommand wrapper args (sudo) into the wrapped command's spec", async () => {
        const sudoSpec = { name: "sudo", args: { name: "command", isCommand: true } };
        const gitSpec = {
            name: "git",
            subcommands: [
                { name: "checkout", description: "Switch branches" },
                { name: "cherry-pick", description: "Apply commits" },
            ],
        };
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["sudo", "git"],
            loadSpec: async (cmd: string) => (cmd === "sudo" ? sudoSpec : cmd === "git" ? gitSpec : null),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "sudo git ch",
                cursorIndex: 11,
                tokens: [
                    { text: "sudo", start: 0, end: 4 },
                    { text: "git", start: 5, end: 8 },
                    { text: "ch", start: 9, end: 11 },
                ],
                searchTerm: "ch",
                tokenIndex: 2,
                tokenType: "subcommand",
            })
        );

        expect(items.map((item) => item.label)).toEqual(["checkout", "cherry-pick"]);
    });

    it("suggests command names for a command-wrapper arg position (sudo <cmd>)", async () => {
        const sudoSpec = { name: "sudo", args: { name: "command", isCommand: true } };
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["git", "grep", "npm"],
            loadSpec: async (cmd: string) => (cmd === "sudo" ? sudoSpec : null),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "sudo g",
                cursorIndex: 6,
                tokens: [
                    { text: "sudo", start: 0, end: 4 },
                    { text: "g", start: 5, end: 6 },
                ],
                searchTerm: "g",
                tokenIndex: 1,
                tokenType: "argument",
            })
        );

        expect(items.map((item) => item.label)).toEqual(["git", "grep"]);
        expect(items[0]).toMatchObject({ kind: "command" });
    });

    it("does not re-suggest options already present on the line", async () => {
        const provider = makeFigStaticCompletionProvider({
            commandNames: ["df"],
            loadSpec: async () => ({
                name: "df",
                options: [
                    { name: "-a", description: "all" },
                    { name: "-h", description: "human" },
                ],
            }),
        });

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "df -a -",
                cursorIndex: 7,
                tokens: [
                    { text: "df", start: 0, end: 2 },
                    { text: "-a", start: 3, end: 5 },
                    { text: "-", start: 6, end: 7 },
                ],
                searchTerm: "-",
                tokenIndex: 2,
                tokenType: "option",
            })
        );

        expect(items.map((item) => item.label)).toEqual(["-h"]);
    });
});
