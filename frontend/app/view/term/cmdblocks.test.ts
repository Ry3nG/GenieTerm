// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as TermTypes from "@xterm/xterm";
import { describe, expect, it } from "vitest";

import { type CmdBlock, makeCmdBlockDecorationSpecs } from "./cmdblocks";

function marker(line: number): TermTypes.IMarker {
    return { line, dispose: () => {} } as any;
}

function block(overrides: Partial<CmdBlock>): CmdBlock {
    return {
        id: 1,
        startMarker: marker(2),
        endMarker: marker(5),
        command: "npm test",
        exitCode: 0,
        state: "done",
        startTs: 100,
        doneTs: 200,
        cwd: "/repo",
        ...overrides,
    };
}

function buffer(overrides: Partial<TermTypes.IBuffer> = {}): TermTypes.IBuffer {
    return {
        baseY: 10,
        cursorY: 4,
        type: "normal",
        ...overrides,
    } as any;
}

describe("cmdblocks", () => {
    it("builds decoration specs only for completed command blocks with valid ranges", () => {
        const first = block({ id: 1, startMarker: marker(2), endMarker: marker(6) });
        const last = block({ id: 2, startMarker: marker(8), endMarker: null });

        expect(
            makeCmdBlockDecorationSpecs(
                [
                    first,
                    block({ id: 3, command: "  " }),
                    block({ id: 4, state: "running" }),
                    block({ id: 5, startMarker: marker(-1) }),
                    last,
                ],
                buffer(),
                120
            )
        ).toEqual([
            { block: first, cols: 120, rows: 4 },
            { block: last, cols: 120, rows: 7 },
        ]);
    });
});
