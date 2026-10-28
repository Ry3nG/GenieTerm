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

import { activeTabIdAtom, configureTabMode, SingleView, TabCacheCeiling } from "@/app/store/activetab";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as global from "@/store/global";
import { globalStore, registerBlockComponentModel, unregisterBlockComponentModel } from "@/store/global";
import { WorkspaceService } from "@/store/services";
import type { CommandHistoryEntry } from "@/util/commandlibrary";
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
    model.pendingInput = [];
    model.inputSending = false;
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

describe("TermViewModel command library insertion", () => {
    it.each([null, "running-command"])("rejects insertion without a confirmed idle prompt (%s)", (status) => {
        const model = makeTermModel();
        const insertCommand = vi.fn(() => true);
        Object.assign(model.termRef.current, { shellIntegrationStatusAtom: jotai.atom(status), insertCommand });
        expect(model.insertLibraryCommand("echo hello")).toBe(false);
        expect(insertCommand).not.toHaveBeenCalled();
    });
    it("inserts into a ready prompt and preserves the terminal's own refusal", () => {
        const model = makeTermModel();
        const insertCommand = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
        Object.assign(model.termRef.current, { shellIntegrationStatusAtom: jotai.atom("ready"), insertCommand });
        expect(model.insertLibraryCommand("echo hello")).toBe(true);
        expect(insertCommand).toHaveBeenCalledWith("echo hello");
        expect(model.insertLibraryCommand("echo hello\necho again")).toBe(false);
    });
});

describe("TermViewModel command history navigation", () => {
    it("activates the owning tab in the shared renderer before focusing its retained command", async () => {
        const model = makeTermModel();
        const entry: CommandHistoryEntry = {
            id: "retained-command",
            blockid: "history-block",
            tabid: "history-tab",
            commandblockid: 7,
            command: "printf hello",
            connection: "",
            cwd: "/work",
            shell: "bash",
            startts: 1000,
            donets: 1100,
            exitcode: 0,
            status: "success",
        };
        const oldMode = SingleView;
        const oldCeiling = TabCacheCeiling;
        const oldTab = globalStore.get(activeTabIdAtom);
        const events: string[] = [];
        const electronSelect = vi.fn((tabId: string) => {
            expect(globalStore.get(activeTabIdAtom)).toBe(tabId);
            events.push("renderer-tab-active");
        });
        const switchWorkspace = vi.fn();
        vi.stubGlobal("window", { api: { setActiveTab: electronSelect, switchWorkspace } });
        const mocks = [
            vi.spyOn(global, "atoms", "get").mockReturnValue({
                ...global.atoms,
                workspaceId: jotai.atom("same-workspace"),
            }),
            vi.spyOn(RpcApi, "BlockInfoCommand").mockResolvedValue({
                blockid: entry.blockid,
                tabid: entry.tabid,
                workspaceid: "same-workspace",
                block: null,
                files: [],
            }),
            vi.spyOn(WorkspaceService, "SetActiveTab").mockImplementation(async () => {
                events.push("workspace-tab-saved");
            }),
        ];
        const waitForRoute = vi.spyOn(RpcApi, "WaitForRouteCommand").mockImplementation(async (_client, data) => {
            expect(globalStore.get(activeTabIdAtom)).toBe(entry.tabid);
            events.push(`ready:${data.routeid}`);
            return true;
        });
        const focus = vi.spyOn(RpcApi, "SetBlockFocusCommand").mockImplementation(async () => {
            events.push("terminal-focused");
        });
        const retained = vi.spyOn(RpcApi, "TermCommandBlockCommand").mockImplementation(async () => {
            events.push("retained-command");
            return { retained: true };
        });
        try {
            configureTabMode(true);
            globalStore.set(activeTabIdAtom, "current-tab");
            expect(await model.openHistoryCommand(entry)).toBe(true);
            expect(globalStore.get(activeTabIdAtom)).toBe(entry.tabid);
            expect(WorkspaceService.SetActiveTab).toHaveBeenCalledWith("same-workspace", entry.tabid);
            expect(electronSelect).toHaveBeenCalledExactlyOnceWith(entry.tabid);
            expect(switchWorkspace).not.toHaveBeenCalled();
            expect(focus).toHaveBeenCalledWith(TabRpcClient, entry.blockid, { route: `tab:${entry.tabid}` });
            expect(retained).toHaveBeenCalledWith(
                TabRpcClient,
                { commandblockid: entry.commandblockid, startts: entry.startts, command: entry.command, focus: true },
                { route: makeFeBlockRouteId(entry.blockid), timeout: 5000 }
            );
            expect(events).toEqual([
                "workspace-tab-saved",
                "renderer-tab-active",
                `ready:tab:${entry.tabid}`,
                "terminal-focused",
                `ready:${makeFeBlockRouteId(entry.blockid)}`,
                "retained-command",
            ]);
        } finally {
            configureTabMode(oldMode, oldCeiling);
            globalStore.set(activeTabIdAtom, oldTab);
            [...mocks, waitForRoute, focus, retained].forEach((mock) => mock.mockRestore());
            vi.unstubAllGlobals();
        }
    });
});

describe("TermViewModel completion key handling", () => {
    it("offers manual completion at a ready prompt even when its marker is still running", () => {
        const model = makeTermModel();
        const terminal = { hasSelection: () => false, buffer: { active: { type: "normal" } }, focus: vi.fn() };
        const status = jotai.atom("ready");
        const blocks = [{ id: 1, state: "running", command: null }];
        Object.assign(model.termRef.current, {
            terminal,
            shellIntegrationStatusAtom: status,
            cmdBlocks: blocks,
            cmdBlocksAtom: jotai.atom(blocks),
        });
        model.nodeModel = { isMagnified: jotai.atom(false), focusNode: vi.fn() } as any;
        model.termMode = jotai.atom("term");
        model.getSettingsMenuItems = () => [];

        const completionItem = () => model.getContextMenuItems().find((item) => item.label === "Show Completions");
        expect(completionItem().enabled).toBe(true);
        completionItem().click();
        expect(model.nodeModel.focusNode).toHaveBeenCalledOnce();
        expect(terminal.focus).toHaveBeenCalledOnce();
        expect(globalStore.get(model.completionModel.manualRequestVersionAtom)).toBe(1);

        globalStore.set(status, "running-command");
        expect(completionItem().enabled).toBe(false);
        globalStore.set(status, "ready");
        terminal.buffer.active.type = "alternate";
        expect(completionItem().enabled).toBe(false);
    });

    it("Escape cancels manual completion before results arrive without forwarding the key", async () => {
        const model = makeTermModel();
        let resolve: (items: CompletionItem[]) => void;
        const pending = model.completionModel.requestCompletions(
            { provideCompletions: () => new Promise<CompletionItem[]>((done) => (resolve = done)) },
            makeContext({ requestKind: "manual" })
        );
        const event = makeKeydownEvent("Escape");
        expect(model.handleTerminalKeydown(event)).toBe(false);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        resolve([makeItem()]);
        await pending;
        expect(globalStore.get(model.completionModel.openAtom)).toBe(false);
        expect(globalStore.get(model.completionModel.statusAtom)).toBe("idle");
    });

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

    it("sends the first keystroke immediately and coalesces queued input in order", async () => {
        const pending: Array<() => void> = [];
        const send = vi
            .spyOn(RpcApi, "ControllerInputCommand")
            .mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
        try {
            const model = makeTermModel();
            model.sendDataToController("a");
            expect(send).toHaveBeenCalledTimes(1);
            model.sendDataToController(" ");
            model.sendDataToController("b");

            await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
            pending.shift()();
            await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
            pending.shift()();
            await model.inputQueue;
            expect(send.mock.calls.map(([, data]) => data.inputdata64)).toEqual(["YQ==", "IGI="]);
        } finally {
            send.mockRestore();
        }
    });

    it("preserves Unicode and control bytes across an input burst and recovers after failure", async () => {
        let rejectFirst: (error: Error) => void;
        const send = vi
            .spyOn(RpcApi, "ControllerInputCommand")
            .mockImplementationOnce(
                () =>
                    new Promise<void>((_, reject) => {
                        rejectFirst = reject;
                    })
            )
            .mockResolvedValue(undefined);
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const model = makeTermModel();
            model.sendDataToController("first");
            const burst = ["中", "文", "🚀", "\u0003", "\r", ...Array(1000).fill("x")];
            burst.forEach((data) => model.sendDataToController(data));
            expect(send).toHaveBeenCalledTimes(1);
            rejectFirst(new Error("connection lost"));
            await model.inputQueue;
            expect(send).toHaveBeenCalledTimes(2);
            expect(Buffer.from(send.mock.calls[1][1].inputdata64, "base64").toString("utf8")).toBe(burst.join(""));
            expect(model.pendingInput).toEqual([]);
            expect(model.inputSending).toBe(false);
            model.sendDataToController("after");
            await model.inputQueue;
            expect(send).toHaveBeenCalledTimes(3);
        } finally {
            send.mockRestore();
            log.mockRestore();
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
