// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { buildCompletionContext, tokenizeForCompletion } from "./tokenizer";

describe("tokenizeForCompletion", () => {
    it("builds command context for a partial first word", () => {
        expect(tokenizeForCompletion("gi", 2)).toEqual({
            tokens: [{ text: "gi", start: 0, end: 2 }],
            searchTerm: "gi",
            tokenIndex: 0,
            tokenType: "command",
        });
    });

    it("builds subcommand context after a completed command", () => {
        expect(tokenizeForCompletion("git ch", 6)).toEqual({
            tokens: [
                { text: "git", start: 0, end: 3 },
                { text: "ch", start: 4, end: 6 },
            ],
            searchTerm: "ch",
            tokenIndex: 1,
            tokenType: "subcommand",
        });
    });

    it("keeps only tokens from the active pipeline segment before the cursor", () => {
        expect(tokenizeForCompletion("echo hi | git ch && npm test", 16)).toEqual({
            tokens: [
                { text: "git", start: 10, end: 13 },
                { text: "ch", start: 14, end: 16 },
            ],
            searchTerm: "ch",
            tokenIndex: 1,
            tokenType: "subcommand",
        });
    });

    it("does not include words after the cursor in the same segment", () => {
        expect(tokenizeForCompletion("git  checkout main", 3)).toEqual({
            tokens: [{ text: "git", start: 0, end: 3 }],
            searchTerm: "git",
            tokenIndex: 0,
            tokenType: "command",
        });
    });

    it("recognizes option context", () => {
        expect(tokenizeForCompletion("grep -n", 7)).toEqual({
            tokens: [
                { text: "grep", start: 0, end: 4 },
                { text: "-n", start: 5, end: 7 },
            ],
            searchTerm: "-n",
            tokenIndex: 1,
            tokenType: "option",
        });
    });

    it("keeps quoted partial file tokens as a single token", () => {
        expect(tokenizeForCompletion('cat "My Doc', 11)).toEqual({
            tokens: [
                { text: "cat", start: 0, end: 3 },
                { text: "My Doc", start: 4, end: 11 },
            ],
            searchTerm: "My Doc",
            tokenIndex: 1,
            tokenType: "subcommand",
        });
    });
});

describe("buildCompletionContext", () => {
    it("normalizes a live terminal input report into a provider context", () => {
        expect(
            buildCompletionContext(
                { text: "git st", cursorIndex: 6 },
                {
                    cwd: "/repo",
                    connId: "conn-1",
                    shellType: "zsh",
                    env: { HOME: "/Users/test" },
                    recentCommands: ["git status"],
                }
            )
        ).toMatchObject({
            inputText: "git st",
            cursorIndex: 6,
            searchTerm: "st",
            tokenIndex: 1,
            tokenType: "subcommand",
            cwd: "/repo",
            connId: "conn-1",
            shellType: "zsh",
            env: { HOME: "/Users/test" },
            recentCommands: ["git status"],
        });
    });
});
