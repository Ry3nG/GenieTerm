// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { computeTheme, DefaultLightTermTheme, DefaultTermTheme, resolveTermThemeName } from "@/app/view/term/termutil";

const FullConfig = {
    termthemes: {
        [DefaultTermTheme]: {
            background: "#000000",
            foreground: "#c1c1c1",
        },
        [DefaultLightTermTheme]: {
            background: "#ffffff",
            foreground: "#1d1d1f",
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

    it("computes the light default as a transparent xterm theme over a white block background", () => {
        const [theme, bgColor] = computeTheme(FullConfig, resolveTermThemeName(null, "light"), 0);

        expect(theme).toMatchObject({
            background: "#00000000",
            foreground: "#1d1d1f",
        });
        expect(bgColor).toBe("#ffffff");
    });
});
