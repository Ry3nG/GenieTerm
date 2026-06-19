// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { makeHistoryCompletionProvider } from "./history-provider";
import type { CompletionContext } from "./types";

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "gi",
        cursorIndex: 2,
        tokens: [{ text: "gi", start: 0, end: 2 }],
        searchTerm: "gi",
        tokenIndex: 0,
        tokenType: "command",
        cwd: "/repo",
        connId: "",
        shellType: "zsh",
        env: {},
        recentCommands: [],
        ...overrides,
    };
}

describe("makeHistoryCompletionProvider", () => {
    it("suggests matching recent commands at the command position", async () => {
        const provider = makeHistoryCompletionProvider();
        const items = await provider.provideCompletions(
            makeContext({
                recentCommands: ["git status --short", "npm test", "git checkout main", "git status --short"],
            })
        );

        expect(items).toEqual([
            {
                label: "git status --short",
                insertText: "git status --short",
                kind: "history",
                detail: "History",
                score: 1000,
            },
            {
                label: "git checkout main",
                insertText: "git checkout main",
                kind: "history",
                detail: "History",
                score: 998,
            },
        ]);
    });

    it("suggests the remainder of matching history entries inside a command", async () => {
        const provider = makeHistoryCompletionProvider();
        const items = await provider.provideCompletions(
            makeContext({
                inputText: "git ch",
                cursorIndex: 6,
                tokens: [
                    { text: "git", start: 0, end: 3 },
                    { text: "ch", start: 4, end: 6 },
                ],
                searchTerm: "ch",
                tokenIndex: 1,
                tokenType: "subcommand",
                recentCommands: ["git checkout feature/terminal", "git status --short", "npm test"],
            })
        );

        expect(items).toEqual([
            {
                label: "git checkout feature/terminal",
                insertText: "checkout feature/terminal",
                kind: "history",
                detail: "History",
                score: 1000,
            },
        ]);
    });

    it("returns recent commands for an empty subcommand search under the same command", async () => {
        const provider = makeHistoryCompletionProvider();
        const items = await provider.provideCompletions(
            makeContext({
                inputText: "git ",
                cursorIndex: 4,
                tokens: [{ text: "git", start: 0, end: 3 }],
                searchTerm: "",
                tokenIndex: 1,
                tokenType: "subcommand",
                recentCommands: ["git status --short", "git checkout main", "grep TODO"],
            })
        );

        expect(items.map((item) => item.insertText)).toEqual(["status --short", "checkout main"]);
    });
});
