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
    endMarker: TermTypes.IMarker | null; // next command's A marker; null while this is the last block
    command: string | null; // decoded command text from OSC C; null until C arrives
    exitCode: number | null; // from OSC D; null while running
    state: CmdBlockState;
    startTs: number; // Date.now() captured at command-start (C)
    doneTs: number | null; // Date.now() captured at command-done (D)
    cwd: string | null; // cmd:cwd snapshot at command-start
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

// Output text for a block, excluding the prompt/command line itself.
export function getBlockOutputText(block: CmdBlock, terminal: TermTypes.Terminal): string {
    const buffer = terminal.buffer.active;
    const [start, end] = blockBufferRange(block, buffer);
    if (start < 0 || end <= start + 1) {
        return "";
    }
    const lines = bufferLinesToText(buffer, start + 1, end);
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
export function blockHasCommand(block: CmdBlock): boolean {
    return block.command != null && block.command.trim() !== "";
}
