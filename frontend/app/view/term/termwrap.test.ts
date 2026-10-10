// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/store/global";
import { stringToBase64 } from "@/util/util";
import type * as TermTypes from "@xterm/xterm";
import * as jotai from "jotai";
import { describe, expect, it, vi } from "vitest";
import type { CmdBlock } from "./cmdblocks";
import { emptyPromptInputBuffer } from "./completion/input-mirror";
import type { TermInputBuffer } from "./completion/types";
import { handleOsc16162Command, type ShellIntegrationStatus } from "./osc-handlers";
import { TermWrap } from "./termwrap";

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
        terminal,
        loaded: true,
        disposed: false,
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
    });
});
