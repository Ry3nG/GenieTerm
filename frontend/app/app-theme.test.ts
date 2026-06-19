// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { applyAppTheme, getNextAppTheme, normalizeAppTheme } from "./app-theme";

const AppDir = resolve(__dirname);

describe("app theme helpers", () => {
    it("defaults unknown values to dark mode", () => {
        expect(normalizeAppTheme(null)).toBe("dark");
        expect(normalizeAppTheme("system")).toBe("dark");
    });

    it("toggles between light and dark mode", () => {
        expect(getNextAppTheme("dark")).toBe("light");
        expect(getNextAppTheme("light")).toBe("dark");
        expect(getNextAppTheme("unexpected")).toBe("light");
    });

    it("applies the normalized theme to the document root", () => {
        const root = { dataset: {}, style: {} } as HTMLElement;

        applyAppTheme("light", root);

        expect(root.dataset.appTheme).toBe("light");
        expect(root.style.colorScheme).toBe("light");
    });

    it("keeps the light terminal viewport opaque for crisp text rendering", () => {
        const themeScss = readFileSync(resolve(AppDir, "theme.scss"), "utf8");

        expect(themeScss).toContain(`:root[data-app-theme="light"] .xterm .xterm-viewport {
    background-color: var(--term-background);
}`);
    });
});
