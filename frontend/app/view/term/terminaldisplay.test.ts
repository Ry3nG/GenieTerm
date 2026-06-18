// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    getTerminalPresentationClassName,
    normalizeTerminalPresentationMode,
    shouldShowSemanticTerminal,
} from "./terminaldisplay";

describe("terminaldisplay", () => {
    it("defaults to semantic presentation", () => {
        expect(normalizeTerminalPresentationMode(null)).toBe("semantic");
        expect(normalizeTerminalPresentationMode("")).toBe("semantic");
        expect(normalizeTerminalPresentationMode("garbage")).toBe("semantic");
    });

    it("keeps classic xterm as an explicit compatibility mode", () => {
        expect(normalizeTerminalPresentationMode("classic")).toBe("classic");
        expect(shouldShowSemanticTerminal("classic")).toBe(false);
    });

    it("maps presentation mode to stable class names", () => {
        expect(getTerminalPresentationClassName("semantic")).toBe("term-presentation-semantic");
        expect(getTerminalPresentationClassName("classic")).toBe("term-presentation-classic");
    });
});
