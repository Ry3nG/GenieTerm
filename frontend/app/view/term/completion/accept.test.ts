// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { makeCompletionAcceptSequence } from "./accept";
import type { CompletionContext, CompletionItem } from "./types";

function makeItem(insertText: string): CompletionItem {
    return { label: insertText, insertText, kind: "subcommand" };
}

function makeContext(overrides: Partial<CompletionContext>): CompletionContext {
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

describe("makeCompletionAcceptSequence", () => {
    it("replaces the current token prefix with the completion text", () => {
        expect(makeCompletionAcceptSequence(makeContext({}), makeItem("checkout"))).toBe("\x7f\x7fcheckout");
    });

    it("deletes token suffix before replacing a mid-token completion", () => {
        expect(
            makeCompletionAcceptSequence(
                makeContext({
                    inputText: "git chekout",
                    cursorIndex: 6,
                    tokens: [
                        { text: "git", start: 0, end: 3 },
                        { text: "chekout", start: 4, end: 11 },
                    ],
                    searchTerm: "ch",
                }),
                makeItem("checkout")
            )
        ).toBe("\x1b[3~\x1b[3~\x1b[3~\x1b[3~\x1b[3~\x7f\x7fcheckout");
    });

    it("inserts into an empty fresh token without deleting anything", () => {
        expect(
            makeCompletionAcceptSequence(
                makeContext({
                    inputText: "git ",
                    cursorIndex: 4,
                    tokens: [{ text: "git", start: 0, end: 3 }],
                    searchTerm: "",
                    tokenIndex: 1,
                }),
                makeItem("status")
            )
        ).toBe("status");
    });

    it("counts multibyte characters as one shell cursor step", () => {
        expect(
            makeCompletionAcceptSequence(
                makeContext({
                    inputText: "cat 文",
                    cursorIndex: 5,
                    tokens: [
                        { text: "cat", start: 0, end: 3 },
                        { text: "文", start: 4, end: 5 },
                    ],
                    searchTerm: "文",
                }),
                makeItem("文件.txt")
            )
        ).toBe("\x7f文件.txt");
    });

    it("can replace the full input line for AI command proposals", () => {
        expect(
            makeCompletionAcceptSequence(
                makeContext({
                    inputText: "show disk usage",
                    cursorIndex: 15,
                    tokens: [
                        { text: "show", start: 0, end: 4 },
                        { text: "disk", start: 5, end: 9 },
                        { text: "usage", start: 10, end: 15 },
                    ],
                    searchTerm: "usage",
                    tokenIndex: 2,
                    tokenType: "argument",
                }),
                { label: "df -h", insertText: "df -h", kind: "ai", replaceStart: 0, replaceEnd: 15 }
            )
        ).toBe("\x7f".repeat(15) + "df -h");
    });
});
