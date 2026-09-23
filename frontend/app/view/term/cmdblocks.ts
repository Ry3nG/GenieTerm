// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Command Blocks: a per-command model derived from the shell-integration prompt
// markers (OSC 16162 A/C/D). Each block spans from the prompt-start (A) marker of
// a command to the next command's prompt-start, carrying the command text, exit
// code, timing, and cwd. This module is pure data/helpers; lifecycle wiring lives
// in osc-handlers.ts / termwrap.ts and rendering in the term view.

import type * as TermTypes from "@xterm/xterm";
import { bufferLinesToText } from "./termutil";

export type CmdBlockState = "running" | "done";

export interface CmdBlock {
    id: number; // monotonic id, stable across re-render (not the xterm marker id)
    startMarker: TermTypes.IMarker; // prompt-start (A) marker for this command
    outputMarker?: TermTypes.IMarker | null;
    endMarker: TermTypes.IMarker | null; // next command's A marker; null while this is the last block
    command: string | null; // decoded command text from OSC C; null until C arrives
    exitCode: number | null; // from OSC D; null while running
    state: CmdBlockState;
    startTs: number; // Date.now() captured at command-start (C)
    doneTs: number | null; // Date.now() captured at command-done (D)
    cwd: string | null; // cmd:cwd snapshot at command-start
}

export type CmdBlockSnapshot = {
    id: number;
    startline: number;
    outputline?: number | null;
    endline: number | null;
    command: string | null;
    exitcode: number | null;
    state: CmdBlockState;
    startts: number;
    donets: number | null;
    cwd: string | null;
};

export type CmdBlockIndexSnapshot = {
    version: 1;
    ptyoffset: number;
    cols: number;
    blocks: CmdBlockSnapshot[];
};

export function makeCmdBlockIndexSnapshot(blocks: CmdBlock[], ptyOffset: number, cols: number): CmdBlockIndexSnapshot {
    return {
        version: 1,
        ptyoffset: ptyOffset,
        cols,
        blocks: blocks
            .filter((block) => block.startMarker?.line >= 0)
            .map((block) => ({
                id: block.id,
                startline: block.startMarker.line,
                outputline: block.outputMarker?.line >= 0 ? block.outputMarker.line : null,
                endline: block.endMarker?.line >= 0 ? block.endMarker.line : null,
                command: block.command,
                exitcode: block.exitCode,
                state: block.state,
                startts: block.startTs,
                donets: block.doneTs,
                cwd: block.cwd,
            })),
    };
}

export function parseCmdBlockIndexSnapshot(raw: unknown, ptyOffset: number, cols: number): CmdBlockIndexSnapshot | null {
    try {
        const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (
            snapshot?.version !== 1 ||
            snapshot.ptyoffset !== ptyOffset ||
            snapshot.cols !== cols ||
            !Array.isArray(snapshot.blocks)
        ) {
            return null;
        }
        for (const block of snapshot.blocks) {
            if (
                !Number.isSafeInteger(block.id) ||
                !Number.isSafeInteger(block.startline) ||
                block.startline < 0 ||
                (block.outputline != null && (!Number.isSafeInteger(block.outputline) || block.outputline < block.startline)) ||
                (block.endline != null && (!Number.isSafeInteger(block.endline) || block.endline <= block.startline)) ||
                (block.command != null && typeof block.command !== "string") ||
                (block.exitcode != null && !Number.isInteger(block.exitcode)) ||
                (block.state !== "running" && block.state !== "done") ||
                !Number.isFinite(block.startts) ||
                (block.donets != null && !Number.isFinite(block.donets)) ||
                (block.cwd != null && typeof block.cwd !== "string")
            ) {
                return null;
            }
        }
        return snapshot;
    } catch {
        return null;
    }
}

export async function hashTerminalSnapshot(
    state: string,
    ptyOffset: number,
    termSize: TermSize,
    commandIndex: string,
    fileEpoch: number,
    revision: number
): Promise<string> {
    const metadata = JSON.stringify({ ptyOffset, termSize, commandIndex, fileEpoch, revision });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${state.length}\0${state}\0${metadata}`));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// [startLine, endLine) buffer indices for a block's full region (prompt + output).
// The end is the next command's prompt line, or - for the last/running block - the
// current bottom of content.
export function blockBufferRange(block: CmdBlock, buffer: TermTypes.IBuffer): [number, number] {
    const start = block.startMarker?.line ?? -1;
    let end: number;
    if (block.endMarker != null && block.endMarker.line >= 0) {
        end = block.endMarker.line;
    } else {
        end = buffer.baseY + buffer.cursorY + 1;
    }
    return [start, end];
}

// The line a "jump to this block" / "jump past output" action should target.
export function blockEndLine(block: CmdBlock, buffer: TermTypes.IBuffer): number {
    return blockBufferRange(block, buffer)[1];
}

export function findCmdBlockAtLine(blocks: CmdBlock[], line: number, buffer: TermTypes.IBuffer): CmdBlock | null {
    let match: CmdBlock | null = null;
    for (const block of blocks ?? []) {
        if (!blockHasCommand(block)) {
            continue;
        }
        const [start, end] = blockBufferRange(block, buffer);
        if (start < 0 || line < start || line >= end) {
            continue;
        }
        match = block;
    }
    return match;
}

// Output text for a block, excluding the prompt/command line itself.
export function getBlockOutputText(block: CmdBlock, terminal: TermTypes.Terminal): string {
    const buffer = terminal.buffer.active;
    const [start, end] = blockBufferRange(block, buffer);
    const outputStart = block.outputMarker?.line >= 0 ? block.outputMarker.line : start + 1;
    if (start < 0 || end <= outputStart) {
        return "";
    }
    const lines = bufferLinesToText(buffer, outputStart, end);
    return lines.join("\n").replace(/\s+$/, "");
}

export type CmdBlockDecorationSpec = {
    block: CmdBlock;
    cols: number;
    rows: number;
};

export function makeCmdBlockDecorationSpecs(
    blocks: CmdBlock[],
    buffer: TermTypes.IBuffer,
    cols: number
): CmdBlockDecorationSpec[] {
    const specs: CmdBlockDecorationSpec[] = [];
    for (const block of blocks ?? []) {
        if (block.state !== "done" || !blockHasCommand(block)) {
            continue;
        }
        const [start, end] = blockBufferRange(block, buffer);
        const rows = end - start;
        if (start < 0 || rows < 1) {
            continue;
        }
        specs.push({ block, cols, rows });
    }
    return specs;
}

// True once a real command (OSC C) has run in this block - empty Enter presses
// (an A with no following C) are not rendered as blocks.
export function blockHasCommand(block: CmdBlock | null | undefined): boolean {
    return block != null && block.command != null && block.command.trim() !== "";
}
