// Copyright 2026, GenieTerm. Apache-2.0.

import { describe, expect, it } from "vitest";
import { TerminalStreamBoundaryTracker } from "./terminal-stream-boundary";

describe("TerminalStreamBoundaryTracker", () => {
    it("waits for split OSC, CSI, and UTF-8 sequences before allowing a cache checkpoint", () => {
        const tracker = new TerminalStreamBoundaryTracker();
        tracker.feed(new TextEncoder().encode("hello\x1b]16162;A"));
        expect(tracker.isSafe).toBe(false);
        tracker.feed(new Uint8Array([0x1b]));
        expect(tracker.isSafe).toBe(false);
        tracker.feed(new Uint8Array([0x5c, 0x1b, 0x5b, 0x33]));
        expect(tracker.isSafe).toBe(false);
        tracker.feed(new Uint8Array([0x31, 0x6d, 0xe4, 0xbd]));
        expect(tracker.isSafe).toBe(false);
        tracker.feed(new Uint8Array([0xa0]));
        expect(tracker.isSafe).toBe(true);
    });

    it("resets after terminal truncation", () => {
        const tracker = new TerminalStreamBoundaryTracker();
        tracker.feed(new Uint8Array([0x1b, 0x5d]));
        expect(tracker.isSafe).toBe(false);
        tracker.reset();
        expect(tracker.isSafe).toBe(true);
    });
});
