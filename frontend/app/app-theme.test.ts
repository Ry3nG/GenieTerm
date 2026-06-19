// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { applyAppTheme, getNextAppTheme, normalizeAppTheme } from "./app-theme";

describe("app theme helpers (dark-only)", () => {
    it("always resolves to dark mode", () => {
        expect(normalizeAppTheme(null)).toBe("dark");
        expect(normalizeAppTheme("system")).toBe("dark");
        expect(normalizeAppTheme("light")).toBe("dark");
        expect(getNextAppTheme("dark")).toBe("dark");
        expect(getNextAppTheme("light")).toBe("dark");
    });

    it("applies dark to the document root regardless of input", () => {
        const root = { dataset: {}, style: {} } as HTMLElement;

        applyAppTheme("light", root);

        expect(root.dataset.appTheme).toBe("dark");
        expect(root.style.colorScheme).toBe("dark");
    });
});
