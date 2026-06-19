// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { applyPromptInputData, emptyPromptInputBuffer } from "./input-mirror";

describe("applyPromptInputData", () => {
    it("inserts printable text at the cursor", () => {
        expect(applyPromptInputData(emptyPromptInputBuffer(), "git status")).toEqual({
            text: "git status",
            cursorIndex: 10,
        });
    });

    it("supports cursor movement and middle insertion", () => {
        let buffer = applyPromptInputData(emptyPromptInputBuffer(), "git status");
        buffer = applyPromptInputData(buffer, "\x1b[D\x1b[D\x1b[D\x1b[D");
        buffer = applyPromptInputData(buffer, " --short");
        expect(buffer).toEqual({
            text: "git st --shortatus",
            cursorIndex: 14,
        });
    });

    it("handles backspace, delete, and word deletion", () => {
        let buffer = applyPromptInputData(emptyPromptInputBuffer(), "git checkout main");
        buffer = applyPromptInputData(buffer, "\x17");
        expect(buffer).toEqual({ text: "git checkout ", cursorIndex: 13 });
        buffer = applyPromptInputData(buffer, "dev");
        buffer = applyPromptInputData(buffer, "\x1bb\x1b[3~");
        expect(buffer).toEqual({ text: "git checkout ev", cursorIndex: 13 });
    });

    it("counts multibyte input by JS string index while moving by code point", () => {
        let buffer = applyPromptInputData(emptyPromptInputBuffer(), "echo 你好");
        expect(buffer).toEqual({ text: "echo 你好", cursorIndex: 7 });
        buffer = applyPromptInputData(buffer, "\x1b[D\x7f");
        expect(buffer).toEqual({ text: "echo 好", cursorIndex: 5 });
    });

    it("strips bracketed paste wrappers and resets on pasted newlines", () => {
        expect(applyPromptInputData(emptyPromptInputBuffer(), "\x1b[200~src/index.ts\x1b[201~")).toEqual({
            text: "src/index.ts",
            cursorIndex: 12,
        });
        expect(applyPromptInputData(emptyPromptInputBuffer(), "\x1b[200~echo one\necho two\x1b[201~")).toEqual({
            text: "",
            cursorIndex: 0,
        });
    });

    it("returns null when shell-side editing may have changed the line invisibly", () => {
        expect(applyPromptInputData(emptyPromptInputBuffer(), "\t")).toBeNull();
        expect(applyPromptInputData(emptyPromptInputBuffer(), "\x1b[A")).toBeNull();
    });

    it("resets on enter, ctrl-c, and ctrl-u", () => {
        expect(applyPromptInputData({ text: "git", cursorIndex: 3 }, "\r")).toEqual({ text: "", cursorIndex: 0 });
        expect(applyPromptInputData({ text: "git", cursorIndex: 3 }, "\x03")).toEqual({ text: "", cursorIndex: 0 });
        expect(applyPromptInputData({ text: "git", cursorIndex: 3 }, "\x15")).toEqual({ text: "", cursorIndex: 0 });
    });
});
