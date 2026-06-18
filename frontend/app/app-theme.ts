// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type AppTheme = "dark" | "light";

export const AppThemeChangeEventName = "wave:app-theme-change";

export function normalizeAppTheme(theme: unknown): AppTheme {
    if (theme === "light") {
        return "light";
    }
    return "dark";
}

export function getNextAppTheme(theme: unknown): AppTheme {
    return normalizeAppTheme(theme) === "light" ? "dark" : "light";
}

export function applyAppTheme(theme: unknown, root: HTMLElement = document.documentElement): AppTheme {
    const normalizedTheme = normalizeAppTheme(theme);
    root.dataset.appTheme = normalizedTheme;
    root.style.colorScheme = normalizedTheme;
    const view = root.ownerDocument?.defaultView;
    view?.dispatchEvent(new view.CustomEvent(AppThemeChangeEventName, { detail: { theme: normalizedTheme } }));
    return normalizedTheme;
}
