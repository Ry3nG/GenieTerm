// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TermWshClient } from "./term-wsh";

function makeClient() {
    const block = { id: 5, startTs: 123, command: "git status", startMarker: { line: 12, isDisposed: false } };
    const wrap = {
        loaded: true,
        terminal: { buffer: { active: { type: "normal" } }, scrollToLine: vi.fn(), focus: vi.fn() },
        cmdBlocks: [block],
        hoveredBlockIdAtom: atom<number>(null),
    };
    const client = Object.create(TermWshClient.prototype) as TermWshClient;
    client.model = { termRef: { current: wrap } } as unknown as TermWshClient["model"];
    return { client, wrap, block };
}
describe("terminal command history navigation", () => {
    afterEach(() => vi.useRealTimers());
    const request = { commandblockid: 5, startts: 123, command: "git status" };
    it("checks retained identity without changing scroll or focus, then jumps on explicit request", async () => {
        const { client, wrap } = makeClient();
        expect(await client.handle_termcommandblock(null, request)).toEqual({ retained: true });
        expect(wrap.terminal.scrollToLine).not.toHaveBeenCalled();
        expect(wrap.terminal.focus).not.toHaveBeenCalled();
        expect(await client.handle_termcommandblock(null, { ...request, focus: true })).toEqual({ retained: true });
        expect(wrap.terminal.scrollToLine).toHaveBeenCalledWith(12);
        expect(globalStore.get(wrap.hoveredBlockIdAtom)).toBe(5);
    });
    it("rejects mismatched commands, timestamps, discarded lines and alternate-screen navigation", async () => {
        const { client, wrap, block } = makeClient();
        expect(await client.handle_termcommandblock(null, { ...request, startts: 124, focus: true })).toEqual({
            retained: false,
        });
        expect(await client.handle_termcommandblock(null, { ...request, command: "rm file", focus: true })).toEqual({
            retained: false,
        });
        block.startMarker.line = -1;
        expect(await client.handle_termcommandblock(null, request)).toEqual({ retained: false });
        block.startMarker.line = 12;
        wrap.terminal.buffer.active.type = "alternate";
        expect(await client.handle_termcommandblock(null, request)).toEqual({ retained: false });
        expect(wrap.terminal.scrollToLine).not.toHaveBeenCalled();
    });
    it("waits only for an explicit jump while a newly activated terminal loads", async () => {
        vi.useFakeTimers();
        const { client, wrap } = makeClient();
        wrap.loaded = false;
        expect(await client.handle_termcommandblock(null, request)).toEqual({ retained: false });
        const result = client.handle_termcommandblock(null, { ...request, focus: true });
        await vi.advanceTimersByTimeAsync(100);
        expect(wrap.terminal.scrollToLine).not.toHaveBeenCalled();
        wrap.loaded = true;
        await vi.advanceTimersByTimeAsync(50);
        expect(await result).toEqual({ retained: true });
        expect(wrap.terminal.scrollToLine).toHaveBeenCalledWith(12);
    });
    it("bounds startup waiting and does not label a loading terminal as expired output", async () => {
        vi.useFakeTimers();
        const { client, wrap } = makeClient();
        wrap.loaded = false;
        const result = expect(client.handle_termcommandblock(null, { ...request, focus: true })).rejects.toThrow(
            "still loading"
        );
        await vi.advanceTimersByTimeAsync(3000);
        await result;
        expect(wrap.terminal.scrollToLine).not.toHaveBeenCalled();
    });
});
