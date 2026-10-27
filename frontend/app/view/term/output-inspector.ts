// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as TermTypes from "@xterm/xterm";
import { blockBufferRange, type CmdBlock } from "./cmdblocks";
import { bufferLinesToText } from "./termutil";

const MaxOutputRows = 2000;
const MaxOutputCharacters = 256 * 1024;
export const MaxOutputMatches = 1000;

export type OutputSnapshot = {
    commandid: number;
    command: string;
    cwd: string;
    connection: string;
    startts: number;
    capturedat: number;
    running: boolean;
    exitcode: number;
    text: string;
    truncated: boolean;
};

export function captureCommandOutput(
    block: CmdBlock,
    terminal: TermTypes.Terminal,
    connection: string
): OutputSnapshot {
    const buffer = terminal.buffer.active;
    const [start, rawEnd] = blockBufferRange(block, buffer);
    const end = Math.min(rawEnd, buffer.length);
    const outputStart = block.outputMarker?.line >= 0 ? block.outputMarker.line : start + 1;
    const firstRow = Math.max(outputStart, end - MaxOutputRows);
    const captured =
        start < 0 || end <= outputStart ? "" : bufferLinesToText(buffer, firstRow, end).join("\n").trimEnd();
    return {
        commandid: block.id,
        command: block.command ?? "",
        cwd: block.cwd ?? "",
        connection: connection || "local",
        startts: block.startTs,
        capturedat: Date.now(),
        running: block.state === "running",
        exitcode: block.exitCode,
        text: captured.slice(-MaxOutputCharacters),
        truncated: firstRow > outputStart || captured.length > MaxOutputCharacters,
    };
}

export function findOutputMatches(text: string, query: string): number[] {
    if (!query) {
        return [];
    }
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches: number[] = [];
    while (matches.length < MaxOutputMatches) {
        const match = pattern.exec(text);
        if (!match) {
            break;
        }
        matches.push(match.index);
    }
    return matches;
}

export function nextOutputMatchIndex(current: number, count: number, direction: 1 | -1): number {
    if (count === 0) {
        return -1;
    }
    if (current < 0 || current >= count) {
        return direction < 0 ? count - 1 : 0;
    }
    return (current + direction + count) % count;
}
