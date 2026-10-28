// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    CommandHistoryLimit,
    applyCommandLibraryChange,
    emptyCommandLibrary,
    filterCommandHistory,
    normalizeHistoryEntry,
    recoverCommandLibrary,
    type CommandHistoryEntry,
} from "./commandlibrary";

function entry(id = "a", overrides: Partial<CommandHistoryEntry> = {}): CommandHistoryEntry {
    return {
        id,
        blockid: "block",
        tabid: "tab",
        commandblockid: 1,
        command: "git status",
        connection: "",
        cwd: "/project",
        shell: "bash",
        startts: 1000,
        donets: null,
        exitcode: null,
        status: "running",
        ...overrides,
    };
}

describe("bounded command history", () => {
    it("merges different renderer updates, updates completion, and retains only the newest bounded metadata", () => {
        let library = emptyCommandLibrary();
        for (let i = 0; i < CommandHistoryLimit + 10; i++) {
            library = applyCommandLibraryChange(library, {
                type: "record",
                entry: entry(String(i), { startts: i + 1 }),
            });
        }
        library = applyCommandLibraryChange(library, {
            type: "record",
            update: true,
            entry: entry("509", { startts: 510, status: "success", exitcode: 0, donets: 600 }),
        });
        expect(library.history).toHaveLength(CommandHistoryLimit);
        expect(library.history[0]).toMatchObject({ id: "509", status: "success" });
        expect(library.history.some((item) => item.id === "0")).toBe(false);
    });

    it("does not resurrect deleted or cleared running commands when they finish", () => {
        const original = applyCommandLibraryChange(emptyCommandLibrary(), { type: "record", entry: entry() });
        for (const change of [{ type: "deletehistory", id: "a" } as const, { type: "clearhistory" } as const]) {
            const removed = applyCommandLibraryChange(original, change);
            expect(
                applyCommandLibraryChange(removed, {
                    type: "record",
                    entry: entry("a", { status: "success" }),
                    update: true,
                })
            ).toBe(removed);
        }
    });

    it("keeps the original host and folder when terminal metadata changes before completion", () => {
        const original = applyCommandLibraryChange(emptyCommandLibrary(), {
            type: "record",
            entry: entry("a", { connection: "old-host", cwd: "/old" }),
        });
        const updated = applyCommandLibraryChange(original, {
            type: "record",
            update: true,
            entry: entry("a", { connection: "new-host", cwd: "/new", status: "success" }),
        });
        expect(updated.history[0]).toMatchObject({ connection: "old-host", cwd: "/old", status: "success" });
    });

    it("validates persisted data, strips extra fields, and marks stale running results unknown", () => {
        const raw = {
            version: 1,
            history: [
                { ...entry(), output: "do not save" },
                { ...entry("bad"), startts: 1e100 },
            ],
            retiredData: { ignored: true },
        };
        expect(recoverCommandLibrary(raw).history).toEqual([{ ...entry(), status: "unknown" }]);
        expect(normalizeHistoryEntry({ ...entry(), command: "a".repeat(4097) })).toBeNull();
        expect(normalizeHistoryEntry({ ...entry(), command: "echo \x1b[31m" })).toBeNull();
    });

    it("combines host, folder, status and case-insensitive word filters", () => {
        const history = [
            entry("a", { command: "pytest unit", connection: "build", status: "failed" }),
            entry("b", { command: "pytest unit", connection: "local", status: "success" }),
        ];
        expect(
            filterCommandHistory(history, {
                query: "PYTEST build",
                connection: "build",
                cwd: "proj",
                status: "failed",
            }).map((item) => item.id)
        ).toEqual(["a"]);
        expect(filterCommandHistory(history, { query: "absent" })).toEqual([]);
    });
});
