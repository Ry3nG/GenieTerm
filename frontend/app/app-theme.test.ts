// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { applyAppTheme, getNextAppTheme, normalizeAppTheme } from "./app-theme";

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
});
