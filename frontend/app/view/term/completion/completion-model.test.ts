// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { globalStore } from "@/store/global";
import { TermCompletionModel } from "./completion-model";
import type { CompletionContext, CompletionItem } from "./types";

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

function item(label: string): CompletionItem {
    return { label, insertText: label, kind: "subcommand" };
}

describe("TermCompletionModel", () => {
    it("opens with requested completions and stores the matching context", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout")]) };
        const ctx = makeContext();

        await model.requestCompletions(service, ctx);

        expect(globalStore.get(model.openAtom)).toBe(true);
        expect(globalStore.get(model.itemsAtom)).toEqual([item("checkout")]);
        expect(globalStore.get(model.selectedIndexAtom)).toBe(0);
        expect(globalStore.get(model.contextAtom)).toBe(ctx);
        expect(globalStore.get(model.statusAtom)).toBe("ready");
    });

    it("dismisses when providers return no items", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => []) };

        await model.requestCompletions(service, makeContext());

        expect(globalStore.get(model.openAtom)).toBe(false);
        expect(globalStore.get(model.itemsAtom)).toEqual([]);
        expect(globalStore.get(model.statusAtom)).toBe("idle");
    });

    it("wraps selection movement", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout"), item("cherry-pick")]) };
        await model.requestCompletions(service, makeContext());

        model.moveSelection(-1);
        expect(globalStore.get(model.selectedIndexAtom)).toBe(1);

        model.moveSelection(1);
        expect(globalStore.get(model.selectedIndexAtom)).toBe(0);
    });

    it("accepts the selected item through the provided send function", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout")]) };
        const sendData = vi.fn();
        await model.requestCompletions(service, makeContext());

        expect(model.acceptSelected(sendData)).toBe(true);

        expect(sendData).toHaveBeenCalledWith("\x7f\x7fcheckout");
        expect(globalStore.get(model.openAtom)).toBe(false);
    });
});
