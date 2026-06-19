// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    computeTheme,
    DefaultLightTermTheme,
    DefaultTermTheme,
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
        [DefaultLightTermTheme]: {
            background: "#ffffff",
            foreground: "#1d1d1f",
            selectionBackground: "#0969da33",
        },
        dracula: {
            background: "#282a36",
            foreground: "#f8f8f2",
        },
    },
} as unknown as FullConfigType;

describe("term theme defaults", () => {
    it("uses a light terminal palette only when the app is light and no terminal theme is configured", () => {
        expect(resolveTermThemeName(null, "dark")).toBe(DefaultTermTheme);
        expect(resolveTermThemeName(null, "light")).toBe(DefaultLightTermTheme);
        expect(resolveTermThemeName("dracula", "light")).toBe("dracula");
    });

    it("uses an opaque default background for the light terminal theme", () => {
        expect(resolveTermTransparency(null, DefaultLightTermTheme)).toBe(0);
        expect(resolveTermTransparency(null, DefaultTermTheme)).toBe(0.5);
        expect(resolveTermTransparency(0.5, DefaultLightTermTheme)).toBe(0.5);
    });

    it("keeps the light background in the xterm theme so reverse-video text stays legible", () => {
        const [theme, bgColor] = computeTheme(FullConfig, resolveTermThemeName(null, "light"), 0);

        expect(theme).toMatchObject({
            background: "#ffffff",
            foreground: "#1d1d1f",
        });
        expect(bgColor).toBe("#ffffff");
    });

    it("does not amplify the light selection color when terminal transparency is enabled", () => {
        const [theme] = computeTheme(FullConfig, resolveTermThemeName(null, "light"), 0.5);

        expect(theme.selectionBackground).toBe("#0969da33");
    });

    it("uses the DOM renderer for bright terminal palettes so text stays crisp", () => {
        const [lightTheme] = computeTheme(FullConfig, DefaultLightTermTheme, 0);
        const [darkTheme] = computeTheme(FullConfig, DefaultTermTheme, 0.5);

        expect(shouldUseWebGlRenderer(false, lightTheme)).toBe(false);
        expect(shouldUseWebGlRenderer(false, darkTheme)).toBe(true);
        expect(shouldUseWebGlRenderer(true, darkTheme)).toBe(false);
    });
});
