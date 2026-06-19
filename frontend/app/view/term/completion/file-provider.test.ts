// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { makeFileCompletionProvider } from "./file-provider";
import type { CompletionContext } from "./types";

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "cat sr",
        cursorIndex: 6,
        tokens: [
            { text: "cat", start: 0, end: 3 },
            { text: "sr", start: 4, end: 6 },
        ],
        searchTerm: "sr",
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

function file(name: string, isdir = false): FileInfo {
    return { path: `/repo/${name}`, dir: "/repo", name, isdir };
}

describe("makeFileCompletionProvider", () => {
    it("lists cwd for a plain relative token and appends slash to directories", async () => {
        const listDirectory = vi.fn(async () => [file("src", true), file("scripts", true), file("README.md")]);
        const provider = makeFileCompletionProvider(listDirectory);

        const items = await provider.provideCompletions(makeContext({ searchTerm: "s" }));

        expect(listDirectory).toHaveBeenCalledWith("/repo", expect.objectContaining({ cwd: "/repo" }));
        expect(items).toEqual([
            { label: "scripts/", insertText: "scripts/", kind: "folder", detail: "Folder", score: 900 },
            { label: "src/", insertText: "src/", kind: "folder", detail: "Folder", score: 899 },
        ]);
    });

    it("lists the typed relative directory and preserves the replacement prefix", async () => {
        const listDirectory = vi.fn(async () => [
            { path: "/repo/src/util", dir: "/repo/src", name: "util", isdir: true },
            { path: "/repo/src/view.ts", dir: "/repo/src", name: "view.ts" },
        ]);
        const provider = makeFileCompletionProvider(listDirectory);

        const items = await provider.provideCompletions(makeContext({ searchTerm: "src/u" }));

        expect(listDirectory).toHaveBeenCalledWith("/repo/src", expect.anything());
        expect(items).toEqual([
            { label: "util/", insertText: "src/util/", kind: "folder", detail: "Folder", score: 900 },
        ]);
    });

    it("lists absolute directories without prefixing cwd", async () => {
        const listDirectory = vi.fn(async () => [
            { path: "/etc/hosts", dir: "/etc", name: "hosts" },
            { path: "/etc/hostname", dir: "/etc", name: "hostname" },
        ]);
        const provider = makeFileCompletionProvider(listDirectory);

        const items = await provider.provideCompletions(makeContext({ searchTerm: "/etc/host" }));

        expect(listDirectory).toHaveBeenCalledWith("/etc", expect.anything());
        expect(items.map((item) => item.insertText)).toEqual(["/etc/hostname", "/etc/hosts"]);
    });

    it("hides dotfiles unless the prefix starts with a dot", async () => {
        const listDirectory = vi.fn(async () => [file(".env"), file("src", true)]);
        const provider = makeFileCompletionProvider(listDirectory);

        const plainItems = await provider.provideCompletions(makeContext({ searchTerm: "" }));
        const dotItems = await provider.provideCompletions(makeContext({ searchTerm: "." }));

        expect(plainItems.map((item) => item.label)).toEqual(["src/"]);
        expect(dotItems.map((item) => item.label)).toEqual([".env"]);
    });

    it("does not list cwd while completing a normal command name", async () => {
        const listDirectory = vi.fn(async () => [file("git", true)]);
        const provider = makeFileCompletionProvider(listDirectory);

        const items = await provider.provideCompletions(
            makeContext({
                inputText: "gi",
                cursorIndex: 2,
                tokens: [{ text: "gi", start: 0, end: 2 }],
                searchTerm: "gi",
                tokenIndex: 0,
                tokenType: "command",
            })
        );

        expect(items).toEqual([]);
        expect(listDirectory).not.toHaveBeenCalled();
    });
});
