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

import { RpcApi } from "@/app/store/wshclientapi";
import { globalStore, registerBlockComponentModel, unregisterBlockComponentModel } from "@/store/global";
import * as jotai from "jotai";
import { TermCompletionModel } from "./completion/completion-model";
import type { CompletionContext, CompletionItem, TermInputBuffer } from "./completion/types";
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

function makeTermModel(input: TermInputBuffer = { text: "cd GenieTerm/", cursorIndex: 13 }): TermViewModel {
    const model = Object.create(TermViewModel.prototype) as TermViewModel;
    model.blockId = "block-1";
    model.tabModel = { tabId: "tab-1", isActiveAtom: jotai.atom(true) } as any;
    model.termRef = {
        current: { currentInputBufferAtom: jotai.atom(input), scheduleCmdDecorationSync: vi.fn() } as any,
    };
    model.completionModel = new TermCompletionModel();
    model.shellProcStatus = jotai.atom("running");
    model.keyDownHandler = vi.fn(() => false);
    model.shouldHandleCtrlVPaste = vi.fn(() => false);
    model.acceptCompletionSelected = vi.fn(() => true);
    model.inputQueue = Promise.resolve();
    return model;
}

describe("TermViewModel connection recovery", () => {
    function conn(overrides: Partial<ConnStatus> = {}): ConnStatus {
        return {
            connection: "saved-ssh-host",
            status: "disconnected",
            connected: false,
            wshenabled: false,
            hasconnected: true,
            activeconnnum: 1,
            ...overrides,
        };
    }

    function setup(initial: ConnStatus) {
        const model = makeTermModel();
        const statusAtom = jotai.atom(initial);
        model.connStatus = statusAtom;
        model.lastConnStatus = initial;
        const resync = vi.fn().mockResolvedValue(undefined);
        Object.assign(model.termRef.current, { hasResized: true, resyncController: resync });
        const unsubscribe = globalStore.sub(statusAtom, () =>
            model.handleConnStatusChange(globalStore.get(statusAtom))
        );
        return { model, resync, unsubscribe, publish: (status: ConnStatus) => globalStore.set(statusAtom, status) };
    }

    it("retries after a background helper upgrade becomes ready on an already connected SSH session", () => {
        const { resync, publish, unsubscribe } = setup(conn());
        try {
            const installing = conn({
                status: "connected",
                connected: true,
                nowshreason: "installing wsh in background",
            });
            publish(installing);
            expect(resync).toHaveBeenCalledOnce();
            publish({ ...installing, wshinstallpct: 50 });
            publish({ ...installing, wshinstallpct: 100 });
            expect(resync).toHaveBeenCalledOnce();

            publish({ ...installing, wshenabled: true, nowshreason: "", wshversion: "1.5.1" });
            expect(resync).toHaveBeenCalledTimes(2);
            expect(resync).toHaveBeenLastCalledWith("resync handler");
            publish({ ...installing, wshenabled: true, wshversion: "1.5.1", connhealthstatus: "healthy" });
            expect(resync).toHaveBeenCalledTimes(2);
        } finally {
            unsubscribe();
        }
    });

    it("does not restart for helper progress or metadata, but retries when helper availability recovers", () => {
        const ready = conn({ status: "connected", connected: true, wshenabled: true });
        const { model, resync, publish, unsubscribe } = setup(ready);
        try {
            model.handleConnStatusChange(ready);
            publish({ ...ready, wshversion: "1.5.1", wshinstallpct: 100 });
            publish({ ...ready, wshenabled: false, wsherror: "helper restarting" });
            expect(resync).not.toHaveBeenCalled();
            publish(ready);
            expect(resync).toHaveBeenCalledOnce();
        } finally {
            unsubscribe();
        }
    });

    it("preserves disconnect and connection-switch resync without reacting to disconnected helper metadata", () => {
        const { resync, publish, unsubscribe } = setup(
            conn({ status: "connected", connected: true, wshenabled: true })
        );
        try {
            publish(conn());
            expect(resync).toHaveBeenCalledOnce();
            publish(conn({ wshenabled: true }));
            expect(resync).toHaveBeenCalledOnce();
            publish(conn({ connection: "another-ssh-host" }));
            expect(resync).toHaveBeenCalledTimes(2);
            publish(conn({ connection: "another-ssh-host", status: "connected", connected: true, wshenabled: true }));
            expect(resync).toHaveBeenCalledTimes(3);
        } finally {
            unsubscribe();
        }
    });

    it("does not resync before the terminal has its initial fitted size", () => {
        const { model, resync, publish, unsubscribe } = setup(conn());
        try {
            model.termRef.current.hasResized = false;
            const ready = conn({ status: "connected", connected: true, wshenabled: true });
            publish(ready);
            expect(resync).not.toHaveBeenCalled();
            model.termRef.current.hasResized = true;
            publish({ ...ready, connhealthstatus: "healthy" });
            expect(resync).toHaveBeenCalledOnce();
        } finally {
            unsubscribe();
        }
    });
});

describe("TermViewModel completion key handling", () => {
    it("broadcasts only to basic terminals owned by the active source tab", () => {
        const source = makeTermModel();
        const sameTab = makeTermModel();
        const otherTab = makeTermModel();
        otherTab.tabModel = { tabId: "tab-2", isActiveAtom: jotai.atom(false) } as any;
        const command = makeTermModel();
        const models = [source, sameTab, otherTab, command];
        models.forEach((model, index) => {
            model.viewType = "term";
            model.isBasicTerm = () => model !== command;
            model.sendDataToController = vi.fn();
            registerBlockComponentModel(`multi-${index}`, { viewModel: model });
        });
        try {
            source.multiInputHandler("hello");
            expect(sameTab.sendDataToController).toHaveBeenCalledWith("hello");
            expect(source.sendDataToController).not.toHaveBeenCalled();
            expect(otherTab.sendDataToController).not.toHaveBeenCalled();
            expect(command.sendDataToController).not.toHaveBeenCalled();
            otherTab.multiInputHandler("hidden");
            expect(source.sendDataToController).not.toHaveBeenCalled();
            expect(sameTab.sendDataToController).toHaveBeenCalledOnce();
        } finally {
            models.forEach((_, index) => unregisterBlockComponentModel(`multi-${index}`));
        }
    });

    it("delivers rapid terminal input to the controller in keystroke order", async () => {
        const pending: Array<() => void> = [];
        const send = vi
            .spyOn(RpcApi, "ControllerInputCommand")
            .mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
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

    it("passes ArrowRight through as cursor movement when the cursor is mid-line", () => {
        const model = makeTermModel({ text: "cd GenieTerm/", cursorIndex: 5 });
        globalStore.set(model.completionModel.itemsAtom, [
            makeItem({ label: "lsblk", insertText: "lsblk", kind: "history" }),
        ]);
        globalStore.set(
            model.completionModel.contextAtom,
            makeContext({ requestKind: "auto", cursorIndex: 5, inputText: "cd GenieTerm/" })
        );
        globalStore.set(model.completionModel.openAtom, true);
        const event = makeKeydownEvent("ArrowRight");

        const handled = model.handleTerminalKeydown(event);

        expect(handled).toBe(true);
        expect(model.acceptCompletionSelected).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(globalStore.get(model.completionModel.openAtom)).toBe(false);
    });

    it("passes the key through when the popup is stale relative to the current input", () => {
        const model = makeTermModel({ text: "cd GenieTerm/M", cursorIndex: 14 });
        globalStore.set(model.completionModel.itemsAtom, [makeItem()]);
        globalStore.set(model.completionModel.contextAtom, makeContext({ requestKind: "auto" }));
        globalStore.set(model.completionModel.openAtom, true);
        const event = makeKeydownEvent("ArrowRight");

        expect(model.handleTerminalKeydown(event)).toBe(true);
        expect(model.acceptCompletionSelected).not.toHaveBeenCalled();
    });
});
