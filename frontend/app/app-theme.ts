// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// GenieTerm is dark-only. The light/white appearance was removed; these helpers are kept
// (same signatures) so callers keep working, but they always resolve to dark.
export type AppTheme = "dark" | "light";

export const AppThemeChangeEventName = "wave:app-theme-change";

export function normalizeAppTheme(_theme?: unknown): AppTheme {
    return "dark";
}

export function getNextAppTheme(_theme?: unknown): AppTheme {
    return "dark";
}

export function applyAppTheme(_theme: unknown, root: HTMLElement = document.documentElement): AppTheme {
    root.dataset.appTheme = "dark";
    root.style.colorScheme = "dark";
    const view = root.ownerDocument?.defaultView;
    view?.dispatchEvent(new view.CustomEvent(AppThemeChangeEventName, { detail: { theme: "dark" } }));
    return "dark";
}
