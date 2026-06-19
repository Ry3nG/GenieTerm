// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    computeTheme,
    DefaultTermTheme,
    resolveTermMinimumContrastRatio,
    resolveTermThemeName,
    resolveTermTransparency,
    shouldUseWebGlRenderer,
} from "@/app/view/term/termutil";

const FullConfig = {
    termthemes: {
        [DefaultTermTheme]: {
            background: "#000000",
            foreground: "#c1c1c1",
        },
        dracula: {
            background: "#282a36",
            foreground: "#f8f8f2",
        },
    },
} as unknown as FullConfigType;

describe("term theme defaults (dark-only)", () => {
    it("falls back to the default dark theme when none is configured", () => {
        expect(resolveTermThemeName(null)).toBe(DefaultTermTheme);
        expect(resolveTermThemeName("dracula")).toBe("dracula");
    });

    it("uses the default terminal transparency unless overridden", () => {
        expect(resolveTermTransparency(null, DefaultTermTheme)).toBe(0.5);
        expect(resolveTermTransparency(0.2, DefaultTermTheme)).toBe(0.2);
    });

    it("always uses the WebGL renderer unless explicitly disabled", () => {
        const [darkTheme] = computeTheme(FullConfig, DefaultTermTheme, 0.5);
        expect(shouldUseWebGlRenderer(false, darkTheme)).toBe(true);
        expect(shouldUseWebGlRenderer(true, darkTheme)).toBe(false);
    });

    it("uses the default minimum contrast ratio", () => {
        const [darkTheme] = computeTheme(FullConfig, DefaultTermTheme, 0.5);
        expect(resolveTermMinimumContrastRatio(darkTheme)).toBe(1);
    });
});
