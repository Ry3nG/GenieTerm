// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseSettingsNumber } from "./settingscontrols";

describe("parseSettingsNumber", () => {
    const fontRange = { min: 4, max: 64, step: 0.5 };

    it.each(["", " ", "abc", "12px", "1.2.3", "NaN", "Infinity", "-Infinity", "0x10", "1e3", "9".repeat(400)])(
        "reverts invalid input %j",
        (input) => {
            expect(parseSettingsNumber(input, 12, fontRange)).toBe(12);
        }
    );

    it.each([
        ["2", 4],
        ["90", 64],
        [" 13.5 ", 13.5],
        ["13.3", 13.5],
        ["4", 4],
        ["64", 64],
    ])("normalizes font size %s to %s", (input, expected) => {
        expect(parseSettingsNumber(String(input), 12, fontRange)).toBe(expected);
    });

    it("rounds line counts and respects the terminal's scrollback limit", () => {
        expect(parseSettingsNumber("2000.7", 2000, { min: 1, max: 50000 })).toBe(2001);
        expect(parseSettingsNumber("900000", 2000, { min: 1, max: 50000 })).toBe(50000);
        expect(parseSettingsNumber("0", 2000, { min: 1, max: 50000 })).toBe(1);
    });

    it("allows a zero tile gap and clamps negative gaps", () => {
        expect(parseSettingsNumber("0", 3, { min: 0, max: 32 })).toBe(0);
        expect(parseSettingsNumber("-5", 3, { min: 0, max: 32 })).toBe(0);
    });
});
