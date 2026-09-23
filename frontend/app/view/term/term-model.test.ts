// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/view/term/term", () => ({
    TermClaudeIcon: () => null,
    TerminalView: () => null,
}));

vi.mock("@/app/view/vdom/vdom-model", () => ({
    VDomModel: class {},
}));

import { globalStore } from "@/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import * as jotai from "jotai";
import { TermCompletionModel } from "./completion/completion-model";
import type { CompletionContext, CompletionItem } from "./completion/types";
import { TermViewModel } from "./term-model";

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "cd GenieTerm/",
        cursorIndex: 13,
        tokens: [{ text: "cd", start: 0, end: 2 }],
        searchTerm: "",
        tokenIndex: 1,
        tokenType: "argument",
        cwd: "~",
        connId: "",
        shellType: "zsh",
        env: {},
        recentCommands: [],
        requestKind: "auto",
        ...overrides,
    };
}

function makeItem(overrides: Partial<CompletionItem> = {}): CompletionItem {
    return {
        label: "Movies/",
        insertText: "Movies/",
        kind: "folder",
        ...overrides,
    };
}

function makeKeydownEvent(key: string): KeyboardEvent {
    return {
        type: "keydown",
        key,
        code: key,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
        location: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
}

function makeTermModel(): TermViewModel {
    const model = Object.create(TermViewModel.prototype) as TermViewModel;
    model.blockId = "block-1";
    model.termRef = { current: null };
    model.completionModel = new TermCompletionModel();
    model.shellProcStatus = jotai.atom("running");
    model.keyDownHandler = vi.fn(() => false);
    model.shouldHandleCtrlVPaste = vi.fn(() => false);
    model.acceptCompletionSelected = vi.fn();
    model.inputQueue = Promise.resolve();
    return model;
}

describe("TermViewModel completion key handling", () => {
    it("delivers rapid terminal input to the controller in keystroke order", async () => {
        const pending: Array<() => void> = [];
        const send = vi.spyOn(RpcApi, "ControllerInputCommand").mockImplementation(
            () => new Promise<void>((resolve) => pending.push(resolve))
        );
        try {
            const model = makeTermModel();
            model.sendDataToController("a");
            model.sendDataToController(" ");
            model.sendDataToController("b");

            await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
            pending.shift()();
            await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
            pending.shift()();
            await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
            pending.shift()();
            await model.inputQueue;
            expect(send.mock.calls.map(([, data]) => data.inputdata64)).toEqual(["YQ==", "IA==", "Yg=="]);
        } finally {
            send.mockRestore();
        }
    });

    it("lets Enter submit the terminal input instead of accepting an auto completion", () => {
        const model = makeTermModel();
        globalStore.set(model.completionModel.itemsAtom, [makeItem()]);
        globalStore.set(model.completionModel.contextAtom, makeContext({ requestKind: "auto" }));
        globalStore.set(model.completionModel.openAtom, true);
        const event = makeKeydownEvent("Enter");

        const handled = model.handleTerminalKeydown(event);

        expect(handled).toBe(true);
        expect(model.acceptCompletionSelected).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(globalStore.get(model.completionModel.openAtom)).toBe(false);
    });

    it("lets Tab fall through instead of accepting an auto completion before explicit selection", () => {
        const model = makeTermModel();
        globalStore.set(model.completionModel.itemsAtom, [makeItem()]);
        globalStore.set(model.completionModel.contextAtom, makeContext({ requestKind: "auto" }));
        globalStore.set(model.completionModel.openAtom, true);
        const event = makeKeydownEvent("Tab");

        const handled = model.handleTerminalKeydown(event);

        expect(handled).toBe(true);
        expect(model.acceptCompletionSelected).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(globalStore.get(model.completionModel.openAtom)).toBe(false);
    });

    it("keeps Tab as the explicit accept key after selecting a completion", () => {
        const model = makeTermModel();
        globalStore.set(model.completionModel.itemsAtom, [makeItem()]);
        globalStore.set(model.completionModel.contextAtom, makeContext({ requestKind: "auto" }));
        globalStore.set(model.completionModel.openAtom, true);
        model.completionModel.moveSelection(1);
        const event = makeKeydownEvent("Tab");

        const handled = model.handleTerminalKeydown(event);

        expect(handled).toBe(false);
        expect(model.acceptCompletionSelected).toHaveBeenCalledOnce();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
    });

    it("accepts the highlighted history completion with ArrowRight without submitting", () => {
        const model = makeTermModel();
        globalStore.set(model.completionModel.itemsAtom, [
            makeItem({ label: "lsblk", insertText: "lsblk", kind: "history" }),
        ]);
        globalStore.set(model.completionModel.contextAtom, makeContext({ requestKind: "auto" }));
        globalStore.set(model.completionModel.openAtom, true);
        const event = makeKeydownEvent("ArrowRight");

        const handled = model.handleTerminalKeydown(event);

        expect(handled).toBe(false);
        expect(model.acceptCompletionSelected).toHaveBeenCalledOnce();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
    });
});
