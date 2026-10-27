// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { globalStore } from "@/store/global";
import { TermCompletionModel } from "./completion-model";
import { TermCompletionService } from "./completion-service";
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
    afterEach(() => vi.useRealTimers());

    it.each(["cancel", "new input"])("does not reopen a cold PowerShell result after %s", async (action) => {
        vi.useFakeTimers();
        const model = new TermCompletionModel();
        const service = new TermCompletionService([
            {
                id: "cold-command",
                provideCompletions: () => new Promise((resolve) => setTimeout(() => resolve([item("checkout")]), 2300)),
            },
        ]);
        const pending = model.requestCompletions(service, makeContext({ shellType: "pwsh" }));
        await vi.advanceTimersByTimeAsync(1800);
        expect(globalStore.get(model.statusAtom)).toBe("loading");

        model.invalidate();
        if (action === "new input") {
            await model.requestCompletions(
                new TermCompletionService([{ id: "new", provideCompletions: async () => [item("cherry-pick")] }]),
                makeContext({ shellType: "pwsh", inputText: "git che", cursorIndex: 7, searchTerm: "che" })
            );
        }
        await vi.advanceTimersByTimeAsync(500);
        await pending;

        expect(globalStore.get(model.openAtom)).toBe(action === "new input");
        expect(globalStore.get(model.itemsAtom).map((entry) => entry.label)).toEqual(
            action === "new input" ? ["cherry-pick"] : []
        );
    });

    it("opens with requested completions and stores the matching context", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout")]) };
        const ctx = makeContext();

        await model.requestCompletions(service, ctx);

        expect(globalStore.get(model.openAtom)).toBe(true);
        expect(globalStore.get(model.itemsAtom)).toEqual([item("checkout")]);
        expect(globalStore.get(model.selectedIndexAtom)).toBe(0);
        expect(model.shouldAcceptSelectedFromKey()).toBe(false);
        expect(globalStore.get(model.contextAtom)).toBe(ctx);
        expect(globalStore.get(model.statusAtom)).toBe("ready");
    });

    it("allows key acceptance immediately for manual completion requests", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout")]) };

        await model.requestCompletions(service, makeContext({ requestKind: "manual" }));

        expect(model.shouldAcceptSelectedFromKey()).toBe(true);
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
        expect(model.shouldAcceptSelectedFromKey()).toBe(true);

        model.moveSelection(1);
        expect(globalStore.get(model.selectedIndexAtom)).toBe(0);
    });

    it("resets explicit selection state on dismiss", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout"), item("cherry-pick")]) };
        await model.requestCompletions(service, makeContext());
        model.moveSelection(1);

        model.dismiss();

        expect(model.shouldAcceptSelectedFromKey()).toBe(false);
    });

    it("accepts the selected item through the provided send function", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout")]) };
        const sendData = vi.fn();
        await model.requestCompletions(service, makeContext());

        expect(model.acceptSelected(sendData, { text: "git ch", cursorIndex: 6 })).toBe(true);

        expect(sendData).toHaveBeenCalledWith("\x7f\x7fcheckout");
        expect(globalStore.get(model.openAtom)).toBe(false);
    });

    it("refuses to accept against input that changed since the completions were computed", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout")]) };
        const sendData = vi.fn();
        await model.requestCompletions(service, makeContext());

        expect(model.acceptSelected(sendData, { text: "git che", cursorIndex: 7 })).toBe(false);
        expect(sendData).not.toHaveBeenCalled();
        expect(globalStore.get(model.openAtom)).toBe(false);

        await model.requestCompletions(service, makeContext());
        expect(model.acceptSelected(sendData, null)).toBe(false);
        expect(sendData).not.toHaveBeenCalled();
    });

    it("drops results of a request that was invalidated by an input change", async () => {
        const model = new TermCompletionModel();
        let resolve: (items: CompletionItem[]) => void = null;
        const service = {
            provideCompletions: vi.fn(() => new Promise<CompletionItem[]>((presolve) => (resolve = presolve))),
        };
        const pending = model.requestCompletions(service, makeContext());

        model.invalidate();
        resolve([item("checkout")]);
        await pending;

        expect(globalStore.get(model.openAtom)).toBe(false);
        expect(globalStore.get(model.itemsAtom)).toEqual([]);
    });

    it("only lets ArrowRight accept at the end of the line when the item extends the typed text", async () => {
        const model = new TermCompletionModel();
        const service = { provideCompletions: vi.fn(async () => [item("checkout")]) };
        await model.requestCompletions(service, makeContext());

        expect(model.canAcceptWithArrowRight({ text: "git ch", cursorIndex: 6 })).toBe(true);
        expect(model.canAcceptWithArrowRight({ text: "git ch", cursorIndex: 5 })).toBe(false);
        expect(model.canAcceptWithArrowRight(null)).toBe(false);

        await model.requestCompletions(
            service,
            makeContext({ inputText: "git ch main", cursorIndex: 6, tokens: makeContext().tokens })
        );
        expect(model.canAcceptWithArrowRight({ text: "git ch main", cursorIndex: 6 })).toBe(false);

        const fuzzyService = { provideCompletions: vi.fn(async () => [item("cherry-pick")]) };
        await model.requestCompletions(fuzzyService, makeContext({ searchTerm: "ry" }));
        expect(model.canAcceptWithArrowRight({ text: "git ch", cursorIndex: 6 })).toBe(false);
    });
});
