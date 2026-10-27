// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { subscribeOnboardingEvents } from "@/app/onboarding/onboarding-events";
import { activeTabIdAtom } from "@/app/store/activetab";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore } from "@/store/global";
import { stringToBase64 } from "@/util/util";
import type * as TermTypes from "@xterm/xterm";
import * as jotai from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CmdBlock } from "./cmdblocks";
import { emptyPromptInputBuffer } from "./completion/input-mirror";
import type { TermInputBuffer } from "./completion/types";
import { handleOsc16162Command, type ShellIntegrationStatus } from "./osc-handlers";
import { LocalUrlScanner } from "./term-forward";
import { TermWrap } from "./termwrap";

vi.mock("@xterm/addon-search", () => ({
    SearchAddon: class {
        findNext = vi.fn();
        findPrevious = vi.fn();
        clearDecorations = vi.fn();
        onDidChangeResults = vi.fn(() => ({ dispose: vi.fn() }));
    },
}));

vi.mock("@/app/store/localhome", () => ({ getLocalHomeDir: () => "/Users/me" }));

vi.mock("@xterm/addon-serialize", () => ({
    SerializeAddon: class {
        serialize = vi.fn(() => "snapshot");
    },
}));

vi.mock("@/store/global", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/store/global")>();
    const { atom } = await import("jotai");
    const nullAtom = atom(null);
    return { ...actual, getSettingsKeyAtom: () => nullAtom, getBlockMetaKeyAtom: () => nullAtom };
});

type FakeMarker = TermTypes.IMarker & { fireDispose: () => void };

function makeFakeTerminal() {
    const markers: FakeMarker[] = [];
    const terminal = {
        markers,
        cursorLine: 0,
        modes: { bracketedPasteMode: false },
        options: { ignoreBracketedPasteMode: false } as Record<string, any>,
        buffer: { active: { baseY: 0, cursorY: 0, type: "normal", length: 24 } },
        focus: vi.fn(),
        write: vi.fn(),
        registerMarker(offset: number): FakeMarker {
            const listeners: Array<() => void> = [];
            const state = {
                id: markers.length,
                line: terminal.cursorLine + offset,
                isDisposed: false,
                onDispose: (cb: () => void) => {
                    listeners.push(cb);
                    return { dispose: () => {} };
                },
                dispose: () => state.fireDispose(),
                fireDispose: () => {
                    if (state.isDisposed) {
                        return;
                    }
                    state.isDisposed = true;
                    state.line = -1;
                    listeners.forEach((cb) => cb());
                },
            };
            const marker = state as unknown as FakeMarker;
            markers.push(marker);
            return marker;
        },
        // mirrors xterm: clear() disposes every marker, even on the kept cursor line
        clear() {
            markers.forEach((marker) => marker.fireDispose());
            terminal.cursorLine = 0;
        },
    };
    return terminal;
}

function makeTermWrap(status: ShellIntegrationStatus | null = "ready") {
    const terminal = makeFakeTerminal();
    const termWrap = Object.create(TermWrap.prototype) as TermWrap;
    Object.assign(termWrap, {
        blockId: "block-1",
        tabId: "tab-1",
        terminal,
        controllerReady: false,
        controllerResyncVersion: 0,
        loaded: true,
        disposed: false,
        searchRequest: 0,
        toDispose: [],
        replayingTerminalData: false,
        drainingHeldData: false,
        heldData: [],
        appendQueue: Promise.resolve(),
        pendingAppends: [],
        appendDrainScheduled: false,
        fileEpoch: 0,
        termFileEpoch: 0,
        ptyOffset: 0,
        cmdBlocks: [],
        localUrlScanner: new LocalUrlScanner(),
        promptMarkers: [],
        outputMarkers: [],
        pendingCmdBlock: null,
        cmdBlockIdCounter: 0,
        cmdBlocksCacheDirty: false,
        localCompletionInputBuffer: emptyPromptInputBuffer(),
        localCompletionInputDisabled: false,
        inputSentWhileRunning: false,
        shellInputReportSeen: false,
        shellIntegrationStatusAtom: jotai.atom(status),
        shellIntegrationDisabledAtom: jotai.atom(false),
        shellTypeAtom: jotai.atom("unknown"),
        shellNameAtom: jotai.atom("unknown"),
        altScreenActiveAtom: jotai.atom(false),
        currentInputBufferAtom: jotai.atom(null) as jotai.PrimitiveAtom<TermInputBuffer>,
        cmdBlocksAtom: jotai.atom([]),
        hoveredBlockIdAtom: jotai.atom(null),
        lastCommandAtom: jotai.atom(null),
        claudeCodeActiveAtom: jotai.atom(false),
        publishCmdBlocks: () => {},
        syncCmdDecorations_debounced: () => {},
        sendDataHandler: vi.fn(),
        multiInputCallback: vi.fn(),
        onInlineAIRequest: vi.fn(),
        onInlineAIDismiss: vi.fn(),
        notifyCommandDone: vi.fn(),
    });
    return { termWrap, terminal, sent: termWrap.sendDataHandler as ReturnType<typeof vi.fn> };
}

function replay(termWrap: TermWrap, data: string) {
    termWrap.replayingTerminalData = true;
    try {
        return handleOsc16162Command(data, termWrap.blockId, false, termWrap);
    } finally {
        termWrap.replayingTerminalData = false;
    }
}

describe("TermWrap deferred addons", () => {
    it("uses the newest search after loading and cancels a search when cleared", async () => {
        const { termWrap, terminal } = makeTermWrap();
        Object.assign(terminal, { loadAddon: vi.fn() });
        await termWrap.search("", "next", {});
        expect(termWrap.searchAddonLoad).toBeUndefined();
        const first = termWrap.search("old", "next", {});
        const second = termWrap.search("new", "previous", { regex: true });
        await Promise.all([first, second]);
        expect(termWrap.terminal.loadAddon).toHaveBeenCalledTimes(1);
        expect(termWrap.searchAddon.findNext).not.toHaveBeenCalled();
        expect(termWrap.searchAddon.findPrevious).toHaveBeenCalledWith("new", { regex: true });

        const { termWrap: pending } = makeTermWrap();
        Object.assign(pending.terminal, { loadAddon: vi.fn() });
        const search = pending.search("closed", "next", {});
        pending.clearSearch();
        await search;
        expect(pending.searchAddon.findNext).not.toHaveBeenCalled();
    });

    it("does not attach addons to a terminal disposed during import", async () => {
        const { termWrap, terminal } = makeTermWrap();
        Object.assign(terminal, { loadAddon: vi.fn() });
        const search = termWrap.search("query", "next", {});
        termWrap.disposed = true;
        await search;
        expect(termWrap.terminal.loadAddon).not.toHaveBeenCalled();
    });

    it("defers serialization until a cache save and rechecks stream safety after loading", async () => {
        const { termWrap, terminal } = makeTermWrap();
        Object.assign(terminal, { loadAddon: vi.fn() });
        Object.assign(termWrap, { dataBytesProcessed: 0, streamBoundary: { isSafe: true } });
        termWrap.processAndCacheData();
        expect(termWrap.serializeAddonLoad).toBeUndefined();
        termWrap.dataBytesProcessed = 102400;
        termWrap.processAndCacheData();
        termWrap.inSyncTransaction = true;
        await termWrap.serializeAddonLoad;
        expect(termWrap.terminal.loadAddon).toHaveBeenCalledTimes(1);
        expect(termWrap.serializeAddon.serialize).not.toHaveBeenCalled();
        expect(termWrap.dataBytesProcessed).toBe(102400);
    });
});

describe("TermWrap controller startup", () => {
    afterEach(() => vi.restoreAllMocks());

    function makeResizableTermWrap() {
        const { termWrap, terminal } = makeTermWrap();
        Object.assign(terminal, { rows: 24, cols: 80 });
        Object.assign(termWrap, {
            paneActive: true,
            fitAddon: { fit: vi.fn(() => Object.assign(terminal, { rows: 30, cols: 100 })) },
        });
        return { termWrap, terminal };
    }

    it("creates the controller with the first fitted size before sending any resize input", async () => {
        const resync = vi.spyOn(RpcApi, "ControllerResyncCommand").mockResolvedValue(undefined);
        const input = vi.spyOn(RpcApi, "ControllerInputCommand").mockResolvedValue(undefined);
        const { termWrap } = makeResizableTermWrap();
        termWrap.handleResize();
        expect(resync).toHaveBeenCalledWith(TabRpcClient, {
            tabid: "tab-1",
            blockid: "block-1",
            rtopts: { termsize: { rows: 30, cols: 100 } },
        });
        expect(input).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(termWrap.controllerReady).toBe(true);
        expect(input).not.toHaveBeenCalled();
    });

    it("coalesces size changes while creation is pending and sends the latest size after it completes", async () => {
        let finishResync: () => void;
        const pending = new Promise<void>((resolve) => (finishResync = resolve));
        const resync = vi.spyOn(RpcApi, "ControllerResyncCommand").mockReturnValue(pending);
        const input = vi.spyOn(RpcApi, "ControllerInputCommand").mockResolvedValue(undefined);
        const { termWrap, terminal } = makeResizableTermWrap();
        termWrap.handleResize();
        vi.mocked(termWrap.fitAddon.fit).mockImplementation(() => Object.assign(terminal, { rows: 40, cols: 120 }));
        termWrap.handleResize();
        vi.mocked(termWrap.fitAddon.fit).mockImplementation(() => Object.assign(terminal, { rows: 50, cols: 140 }));
        termWrap.handleResize();
        expect(resync).toHaveBeenCalledOnce();
        expect(input).not.toHaveBeenCalled();

        finishResync();
        await pending;
        expect(input).toHaveBeenCalledExactlyOnceWith(TabRpcClient, {
            blockid: "block-1",
            termsize: { rows: 50, cols: 140 },
        });
        vi.mocked(termWrap.fitAddon.fit).mockImplementation(() => Object.assign(terminal, { rows: 60, cols: 160 }));
        termWrap.handleResize();
        expect(input).toHaveBeenLastCalledWith(TabRpcClient, {
            blockid: "block-1",
            termsize: { rows: 60, cols: 160 },
        });
    });

    it("does not flush a stale resync or a terminal closed during creation", async () => {
        let finishFirst: () => void;
        let finishSecond: () => void;
        const first = new Promise<void>((resolve) => (finishFirst = resolve));
        const second = new Promise<void>((resolve) => (finishSecond = resolve));
        vi.spyOn(RpcApi, "ControllerResyncCommand").mockReturnValueOnce(first).mockReturnValueOnce(second);
        const input = vi.spyOn(RpcApi, "ControllerInputCommand").mockResolvedValue(undefined);
        const { termWrap, terminal } = makeResizableTermWrap();
        termWrap.handleResize();
        const retry = termWrap.resyncController("connection change");
        Object.assign(terminal, { rows: 40, cols: 120 });
        finishFirst();
        await first;
        expect(termWrap.controllerReady).toBe(false);
        expect(input).not.toHaveBeenCalled();
        termWrap.disposed = true;
        finishSecond();
        await retry;
        expect(termWrap.controllerReady).toBe(false);
        expect(input).not.toHaveBeenCalled();
    });

    it("keeps resize input blocked after a failed creation until a successful retry", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const resync = vi.spyOn(RpcApi, "ControllerResyncCommand").mockRejectedValueOnce(new Error("disconnected"));
        const input = vi.spyOn(RpcApi, "ControllerInputCommand").mockResolvedValue(undefined);
        const { termWrap, terminal } = makeResizableTermWrap();
        termWrap.handleResize();
        await Promise.resolve();
        vi.mocked(termWrap.fitAddon.fit).mockImplementation(() => Object.assign(terminal, { rows: 40, cols: 120 }));
        termWrap.handleResize();
        expect(termWrap.controllerReady).toBe(false);
        expect(input).not.toHaveBeenCalled();
        resync.mockResolvedValueOnce(undefined);
        await termWrap.resyncController("reconnected");
        expect(termWrap.controllerReady).toBe(true);
        expect(resync).toHaveBeenLastCalledWith(TabRpcClient, {
            tabid: "tab-1",
            blockid: "block-1",
            rtopts: { termsize: { rows: 40, cols: 120 } },
        });
    });
});

describe("TermWrap pane visibility", () => {
    it("defers hidden resize and cancels delayed WebGL release on a quick return", () => {
        vi.useFakeTimers();
        try {
            const { termWrap, terminal } = makeTermWrap();
            Object.assign(termWrap, {
                paneActive: true,
                preferredRenderer: "webgl",
                fitAddon: { fit: vi.fn() },
            });
            Object.assign(terminal, { rows: 24, refresh: vi.fn() });
            const release = vi.spyOn(termWrap, "releaseWebGL").mockImplementation(() => {});
            termWrap.setPaneActive(false);
            termWrap.handleResize();
            expect(termWrap.fitAddon.fit).not.toHaveBeenCalled();
            expect(termWrap.pendingResize).toBe(true);
            vi.advanceTimersByTime(9999);
            expect(release).not.toHaveBeenCalled();
            const resize = vi.spyOn(termWrap, "handleResize").mockImplementation(() => {});
            const renderer = vi.spyOn(termWrap, "setTermRenderer").mockImplementation(() => {});
            termWrap.setPaneActive(true);
            expect(renderer).toHaveBeenCalledWith("webgl");
            expect(resize).toHaveBeenCalledOnce();
            expect(termWrap.pendingResize).toBe(false);
            vi.advanceTimersByTime(10000);
            expect(release).not.toHaveBeenCalled();
            termWrap.setPaneActive(false);
            vi.advanceTimersByTime(10000);
            expect(release).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it("captures the WebGL canvas behind the 2D link layer before disposing and losing its context", () => {
        const { termWrap, terminal } = makeTermWrap();
        const order: string[] = [];
        const loseContext = vi.fn(() => order.push("lose"));
        const context = { getExtension: vi.fn(() => ({ loseContext })) };
        Object.assign(terminal, {
            element: {
                querySelectorAll: () => [
                    { getContext: () => null },
                    {
                        getContext: () => {
                            order.push("capture");
                            return context;
                        },
                    },
                ],
            },
        });
        Object.assign(termWrap, {
            preferredRenderer: "webgl",
            webglEnabledAtom: jotai.atom(true),
            webglContextLossDisposable: { dispose: () => order.push("unsubscribe") },
            webglAddon: { dispose: () => order.push("dispose") },
        });
        termWrap.releaseWebGL();
        expect(order).toEqual(["unsubscribe", "capture", "dispose", "lose"]);
        expect(termWrap.webglAddon).toBeNull();
        expect(globalStore.get(termWrap.webglEnabledAtom)).toBe(false);
        expect(termWrap.preferredRenderer).toBe("webgl");
        termWrap.releaseWebGL();
        expect(loseContext).toHaveBeenCalledOnce();
    });
});

function startPrompt(termWrap: TermWrap) {
    termWrap.onPromptStart(termWrap.makePromptMarker());
}

function typeInput(termWrap: TermWrap, data: string) {
    for (const char of data) {
        termWrap.handleTermData(char);
    }
}

describe("TermWrap input", () => {
    it("always delivers Enter to the shell, even for input that reads like natural language", () => {
        const { termWrap, sent } = makeTermWrap();
        startPrompt(termWrap);

        for (const command of ["npx create-react-app my-app", "scp file.txt me@host:", "systemctl status my-service"]) {
            sent.mockClear();
            typeInput(termWrap, command);
            termWrap.handleTermData("\r");

            expect(sent.mock.calls.map(([data]) => data).join("")).toBe(`${command}\r`);
            expect(termWrap.onInlineAIRequest).not.toHaveBeenCalled();
        }
    });

    it("stops trusting the input mirror after an edit it can't reproduce, until the next prompt", () => {
        const { termWrap } = makeTermWrap();
        startPrompt(termWrap);
        typeInput(termWrap, "git sttaus");

        termWrap.handleTermData("\x14");
        expect(globalStore.get(termWrap.currentInputBufferAtom)).toBeNull();
        termWrap.handleTermData("x");
        expect(globalStore.get(termWrap.currentInputBufferAtom)).toBeNull();

        startPrompt(termWrap);
        typeInput(termWrap, "ls");
        expect(globalStore.get(termWrap.currentInputBufferAtom)).toEqual({ text: "ls", cursorIndex: 2 });
    });

    it("disables the input mirror for the prompt that receives typeahead from a running command", () => {
        const { termWrap } = makeTermWrap("running-command");
        termWrap.handleTermData("\x03");
        startPrompt(termWrap);
        expect(globalStore.get(termWrap.currentInputBufferAtom)).toEqual({ text: "", cursorIndex: 0 });

        globalStore.set(termWrap.shellIntegrationStatusAtom, "running-command");
        typeInput(termWrap, "git st");
        startPrompt(termWrap);
        globalStore.set(termWrap.shellIntegrationStatusAtom, "ready");
        typeInput(termWrap, "a");
        expect(globalStore.get(termWrap.currentInputBufferAtom)).toBeNull();

        startPrompt(termWrap);
        typeInput(termWrap, "ls");
        expect(globalStore.get(termWrap.currentInputBufferAtom)).toEqual({ text: "ls", cursorIndex: 2 });
    });
});

describe("TermWrap runCommand", () => {
    it("clears pending input and submits through the typed-input path at an idle prompt", () => {
        const { termWrap, sent } = makeTermWrap();
        startPrompt(termWrap);
        typeInput(termWrap, "half typed");
        sent.mockClear();

        expect(termWrap.runCommand("npm test")).toBe(true);

        expect(sent).toHaveBeenCalledWith("\x05\x15npm test\r");
        expect(termWrap.multiInputCallback).toHaveBeenCalledWith("\x05\x15npm test\r");
        expect(globalStore.get(termWrap.currentInputBufferAtom)).toEqual({ text: "", cursorIndex: 0 });
    });

    it("wraps multi-line commands in bracketed paste when the shell enabled it", () => {
        const { termWrap, terminal, sent } = makeTermWrap();
        terminal.modes.bracketedPasteMode = true;

        expect(termWrap.runCommand("echo one\necho two")).toBe(true);

        expect(sent).toHaveBeenCalledWith("\x05\x15\x1b[200~echo one\necho two\x1b[201~\r");
    });

    it("never types into a running program or a full-screen app", () => {
        const running = makeTermWrap("running-command");
        expect(running.termWrap.runCommand("npm test")).toBe(false);
        expect(running.sent).not.toHaveBeenCalled();

        const altScreen = makeTermWrap("ready");
        globalStore.set(altScreen.termWrap.altScreenActiveAtom, true);
        expect(altScreen.termWrap.runCommand("npm test")).toBe(false);

        const noIntegration = makeTermWrap(null);
        expect(noIntegration.termWrap.runCommand("npm test")).toBe(false);
        expect(noIntegration.termWrap.runCommand("# command too large (9000 bytes)")).toBe(false);
    });
});

describe("TermWrap command blocks", () => {
    it.each([
        { replaying: false, interrupted: false, command: "make test", exitCode: 0, emits: true },
        { replaying: false, interrupted: true, command: "make test", exitCode: 130, emits: true },
        { replaying: false, interrupted: false, command: "make test", exitCode: null, emits: true },
        { replaying: true, interrupted: false, command: "make test", exitCode: 0, emits: false },
        { replaying: false, interrupted: false, command: "", exitCode: 0, emits: false },
        { replaying: false, interrupted: false, command: "   ", exitCode: 0, emits: false },
    ])("emits command-done only for live commands: %j", ({ replaying, interrupted, command, exitCode, emits }) => {
        const { termWrap } = makeTermWrap();
        startPrompt(termWrap);
        termWrap.onCommandStart(command, replaying);
        const block = termWrap.pendingCmdBlock;
        if (interrupted) {
            termWrap.finalizeInterruptedCmdBlock(block);
        }
        const listener = vi.fn();
        const unsubscribe = subscribeOnboardingEvents(listener);
        try {
            termWrap.onCommandDone(exitCode, replaying);
            expect(listener).toHaveBeenCalledTimes(emits ? 1 : 0);
            if (emits) {
                expect(listener).toHaveBeenCalledWith({
                    type: "command-done",
                    blockId: "block-1",
                    cmdBlockId: String(block.id),
                    command,
                    exitCode: exitCode ?? -1,
                });
            }
        } finally {
            unsubscribe();
        }
    });

    it.each([
        ["live", false, false, true],
        ["replayed", true, false, false],
        ["already interrupted", false, true, false],
    ])("only evaluates notifications for live completions: %s", (_name, replaying, interrupted, expected) => {
        const { termWrap } = makeTermWrap();
        startPrompt(termWrap);
        termWrap.onCommandStart("make test");
        if (interrupted) {
            termWrap.finalizeInterruptedCmdBlock(termWrap.pendingCmdBlock);
        }
        termWrap.onCommandDone(0, replaying);
        expect(termWrap.notifyCommandDone).toHaveBeenCalledTimes(expected ? 1 : 0);
        termWrap.onCommandDone(0, replaying);
        expect(termWrap.notifyCommandDone).toHaveBeenCalledTimes(expected ? 1 : 0);
    });

    it("finalizes a block with no D as interrupted when the next prompt starts", () => {
        const { termWrap } = makeTermWrap();
        startPrompt(termWrap);
        termWrap.onCommandStart("sleep 100");
        const block = termWrap.pendingCmdBlock;
        expect(block.startTs).toBeGreaterThan(0);

        startPrompt(termWrap);

        expect(block).toMatchObject({ state: "done", exitCode: null, interrupted: true });
        expect(block.doneTs).toBeGreaterThanOrEqual(block.startTs);
        expect(termWrap.cmdBlocks).toContain(block);
    });

    it("finalizes the running block as interrupted when the shell restarts", () => {
        const { termWrap } = makeTermWrap();
        startPrompt(termWrap);
        termWrap.onCommandStart("vim notes.txt");
        const block = termWrap.pendingCmdBlock;

        termWrap.onShellRestart();

        expect(block).toMatchObject({ state: "done", exitCode: null, interrupted: true });
    });

    it("hides the duration of a restored running block whose D is replayed without a timestamp", () => {
        const { termWrap } = makeTermWrap();
        startPrompt(termWrap);
        termWrap.onCommandStart("make build");
        const block = termWrap.pendingCmdBlock;
        block.startTs = 1_000;

        termWrap.onCommandDone(0, true);

        expect(block).toMatchObject({ state: "done", exitCode: 0, startTs: 0, doneTs: null });
    });

    it("re-anchors the pending block after Cmd+K so the next command is still recorded", () => {
        const { termWrap, terminal } = makeTermWrap();
        startPrompt(termWrap);
        termWrap.onCommandStart("ls");
        termWrap.onCommandDone(0);
        terminal.cursorLine = 30;
        startPrompt(termWrap);
        const pending = termWrap.pendingCmdBlock;

        termWrap.clearTerminal();

        expect(termWrap.pendingCmdBlock).toBe(pending);
        expect(pending.startMarker.isDisposed).toBe(false);
        expect(pending.startMarker.line).toBe(0);
        expect(termWrap.cmdBlocks).toEqual([pending]);
        termWrap.onCommandStart("git status");
        termWrap.onCommandDone(0);
        expect(pending).toMatchObject({ command: "git status", state: "done", exitCode: 0 });
    });
});

describe("TermWrap command notification delivery", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        globalStore.set(activeTabIdAtom, null);
    });

    function makeNotifyingTerm(blockId = "block-1") {
        const { termWrap } = makeTermWrap();
        Object.assign(termWrap, {
            tabId: "tab-1",
            blockId,
            nodeModel: { isFocused: jotai.atom(true) },
            notifyAfterAtom: jotai.atom(10),
            notifyCommandDone: TermWrap.prototype.notifyCommandDone,
        });
        globalStore.set(activeTabIdAtom, "tab-1");
        return termWrap;
    }

    function finishLongCommand(termWrap: TermWrap) {
        startPrompt(termWrap);
        termWrap.onCommandStart("make test");
        termWrap.pendingCmdBlock.startTs = Date.now() - 10000;
        termWrap.pendingCmdBlock.cwd = "/Users/me/project";
        termWrap.onCommandDone(0);
    }

    it.each([
        ["watched", true, true, true, 10, 0],
        ["other app", false, true, true, 10, 1],
        ["other tab", true, false, true, 10, 1],
        ["other block", true, true, false, 10, 1],
        ["override off", false, true, true, 0, 0],
        ["override above duration", false, true, true, 30, 0],
    ])(
        "uses the owning tab and override when %s",
        (_name, windowFocused, tabActive, blockFocused, threshold, count) => {
            vi.stubGlobal("document", { hasFocus: () => windowFocused });
            const notify = vi.spyOn(RpcApi, "NotifyCommand").mockResolvedValue();
            const termWrap = makeNotifyingTerm();
            termWrap.notifyAfterAtom = jotai.atom(threshold);
            globalStore.set(activeTabIdAtom, tabActive ? "tab-1" : "tab-2");
            termWrap.nodeModel.isFocused = jotai.atom(blockFocused);
            finishLongCommand(termWrap);
            expect(notify).toHaveBeenCalledTimes(count);
            if (count) {
                expect(notify).toHaveBeenCalledWith(
                    TabRpcClient,
                    {
                        title: "make test",
                        body: "Finished in 10s · ~/project",
                        silent: false,
                        tabid: "tab-1",
                        blockid: "block-1",
                    },
                    { route: "electron", timeout: 5000 }
                );
            }
        }
    );

    it("coalesces synchronously while RPC delivery is pending and keeps blocks independent", async () => {
        vi.stubGlobal("document", { hasFocus: () => false });
        const clock = vi.spyOn(performance, "now").mockReturnValue(10000);
        let deliver: () => void;
        const pending = new Promise<void>((resolve) => (deliver = resolve));
        const notify = vi.spyOn(RpcApi, "NotifyCommand").mockReturnValue(pending);
        const termWrap = makeNotifyingTerm();
        finishLongCommand(termWrap);
        finishLongCommand(termWrap);
        expect(notify).toHaveBeenCalledTimes(1);
        finishLongCommand(makeNotifyingTerm("block-2"));
        expect(notify).toHaveBeenCalledTimes(2);
        clock.mockReturnValue(12999);
        finishLongCommand(termWrap);
        expect(notify).toHaveBeenCalledTimes(2);
        clock.mockReturnValue(13000);
        finishLongCommand(termWrap);
        expect(notify).toHaveBeenCalledTimes(3);
        deliver();
        await pending;
    });
});

describe("TermWrap live append coalescing", () => {
    it("merges appends that arrive while a write is in flight into one write", async () => {
        const { termWrap } = makeTermWrap();
        const writes: { data: number[]; offset: number }[] = [];
        let releaseFirst: () => void = null;
        termWrap.applyFileAppend = vi.fn(async (data: Uint8Array, offset: number) => {
            writes.push({ data: Array.from(data), offset });
            if (writes.length === 1) {
                await new Promise<void>((resolve) => (releaseFirst = resolve));
            }
        });

        termWrap.queueLiveAppend(new Uint8Array([1]), 0);
        await Promise.resolve();
        await Promise.resolve();
        termWrap.queueLiveAppend(new Uint8Array([2]), 1);
        termWrap.queueLiveAppend(new Uint8Array([3, 4]), 2);
        termWrap.queueLiveAppend(new Uint8Array([9]), 10);
        releaseFirst();
        await termWrap.appendQueue;

        expect(writes).toEqual([
            { data: [1], offset: 0 },
            { data: [2, 3, 4], offset: 1 },
            { data: [9], offset: 10 },
        ]);
    });

    it("drops queued appends when the terminal is truncated", async () => {
        const { termWrap } = makeTermWrap();
        const writes: number[] = [];
        let releaseFirst: () => void = null;
        termWrap.applyFileAppend = vi.fn(async (data: Uint8Array) => {
            writes.push(data[0]);
            if (writes.length === 1) {
                await new Promise<void>((resolve) => (releaseFirst = resolve));
            }
        });
        termWrap.streamBoundary = { reset: vi.fn() } as any;
        termWrap.resetCmdBlocks = vi.fn();

        termWrap.queueLiveAppend(new Uint8Array([1]), 0);
        await Promise.resolve();
        await Promise.resolve();
        termWrap.queueLiveAppend(new Uint8Array([2]), 1);
        termWrap.handleNewFileSubjectData({ fileop: "truncate", fileepoch: 1 } as WSFileEventData);
        releaseFirst();
        await termWrap.appendQueue;

        expect(writes).toEqual([1]);
    });
});

describe("TermWrap remote loopback URLs", () => {
    it("reports localhost URLs from live output and ignores the rest", () => {
        const { termWrap } = makeTermWrap();
        const seen: number[] = [];
        termWrap.scanLocalUrls(new TextEncoder().encode("TensorBoard at http://localhost:6006/ (Press CTRL+C)\n"));
        termWrap.onLocalUrls = (urls) => seen.push(...urls.map((u) => u.port));
        termWrap.scanLocalUrls(new TextEncoder().encode("epoch 3\n"));
        termWrap.scanLocalUrls(new TextEncoder().encode("Running on http://127.0.0.1:7860\n"));
        expect(seen).toEqual([7860]);
    });
});

describe("TermWrap shell-integration markers during load", () => {
    it("treats held data drained after the initial load as live output", async () => {
        const { termWrap } = makeTermWrap();
        termWrap.loaded = false;
        const liveFlags: boolean[] = [];
        termWrap.applyFileAppend = vi.fn(async () => {
            liveFlags.push(termWrap.isProcessingLiveData());
        });
        termWrap.heldData = [
            { data: new Uint8Array([1]), offset: 0, fileEpoch: 0 },
            { data: new Uint8Array([2]), offset: 5, fileEpoch: 0 },
        ];

        await termWrap.drainHeldData(0);

        expect(liveFlags).toEqual([true, true]);
        expect(termWrap.isProcessingLiveData()).toBe(false);
    });

    it("drops held and live appends from a file epoch that was truncated away", async () => {
        const { termWrap } = makeTermWrap();
        termWrap.loaded = false;
        termWrap.termFileEpoch = 2;
        const applied: number[] = [];
        termWrap.applyFileAppend = vi.fn(async (_data: Uint8Array, offset: number) => {
            applied.push(offset);
        });

        termWrap.handleNewFileSubjectData({ fileop: "append", data64: "AQ==", offset: 10, fileepoch: 1 } as any);
        termWrap.handleNewFileSubjectData({ fileop: "append", data64: "AQ==", offset: 20, fileepoch: 2 } as any);
        await termWrap.drainHeldData(0);
        expect(applied).toEqual([20]);

        termWrap.loaded = true;
        termWrap.handleNewFileSubjectData({ fileop: "append", data64: "AQ==", offset: 30, fileepoch: 1 } as any);
        termWrap.handleNewFileSubjectData({ fileop: "append", data64: "AQ==", offset: 40 } as any);
        termWrap.handleNewFileSubjectData({ fileop: "append", data64: "AQ==", offset: 50, fileepoch: 2 } as any);
        await termWrap.appendQueue;
        expect(applied).toEqual([20, 50]);
    });

    it("treats a missing append epoch as epoch 0", async () => {
        const { termWrap } = makeTermWrap();
        const applied: number[] = [];
        termWrap.applyFileAppend = vi.fn(async (_data: Uint8Array, offset: number) => {
            applied.push(offset);
        });

        termWrap.handleNewFileSubjectData({ fileop: "append", data64: "AQ==", offset: 5 } as any);
        await termWrap.appendQueue;

        expect(applied).toEqual([5]);
    });

    it("rebuilds blocks and integration status from replayed markers", () => {
        const { termWrap } = makeTermWrap(null);
        termWrap.loaded = false;

        replay(termWrap, "A");
        expect(globalStore.get(termWrap.shellIntegrationStatusAtom)).toBe("ready");
        replay(termWrap, `C;${JSON.stringify({ cmd64: stringToBase64("npm test") })}`);
        expect(globalStore.get(termWrap.shellIntegrationStatusAtom)).toBe("running-command");
        replay(termWrap, `D;${JSON.stringify({ exitcode: 1 })}`);
        replay(termWrap, "A");

        expect(globalStore.get(termWrap.shellIntegrationStatusAtom)).toBe("ready");
        expect(termWrap.cmdBlocks.map((block: CmdBlock) => [block.command, block.state, block.exitCode])).toEqual([
            ["npm test", "done", 1],
            [null, "running", null],
        ]);
    });

    it("ignores a malformed replayed command payload instead of throwing inside the parser", () => {
        const { termWrap } = makeTermWrap(null);
        termWrap.loaded = false;
        replay(termWrap, "A");
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect(() => replay(termWrap, `C;${JSON.stringify({ cmd64: "bm90 IGJhc2U2NA==!!" })}`)).not.toThrow();
        } finally {
            consoleError.mockRestore();
        }
        expect(termWrap.pendingCmdBlock.command).toBeNull();
    });

    it("records a shell that reports integration:false", () => {
        const { termWrap } = makeTermWrap(null);
        termWrap.loaded = false;

        replay(termWrap, `M;${JSON.stringify({ shell: "pwsh", integration: false })}`);

        expect(globalStore.get(termWrap.shellIntegrationDisabledAtom)).toBe(true);
        expect(globalStore.get(termWrap.shellTypeAtom)).toBe("pwsh");
        expect(globalStore.get(termWrap.shellNameAtom)).toBe("pwsh");
    });

    it.each(["powershell", "pwsh"])("preserves the actual %s executable name from shell metadata", (shell) => {
        const { termWrap } = makeTermWrap(null);
        termWrap.loaded = false;
        replay(termWrap, `M;${JSON.stringify({ shell, integration: true })}`);
        expect(globalStore.get(termWrap.shellTypeAtom)).toBe("pwsh");
        expect(globalStore.get(termWrap.shellNameAtom)).toBe(shell);
    });
});
