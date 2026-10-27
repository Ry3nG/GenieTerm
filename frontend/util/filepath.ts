// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function isWindowsPath(path: string): boolean {
    return /^[A-Za-z]:[\\/]|^\\\\[^\\]+\\[^\\]+/.test(path);
}

export function getPathBasename(path: string, windows = false): string {
    const separator = windows ? /[\\/]+$/ : /\/+$/;
    const trimmed = path.replace(separator, "");
    const index = windows ? Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) : trimmed.lastIndexOf("/");
    return trimmed.slice(index + 1);
}

export function replacePathBasename(path: string, name: string, windows = false): string {
    const trimmed = path.replace(windows ? /[\\/]+$/ : /\/+$/, "");
    const basename = getPathBasename(trimmed, windows);
    return trimmed.slice(0, trimmed.length - basename.length) + name;
}

export function expandHomePath(path: string, home: string, windows = false): string {
    if (path === "~") {
        return home;
    }
    if (!path.startsWith("~/") && !(windows && path.startsWith("~\\"))) {
        return path;
    }
    return home.replace(windows ? /[\\/]+$/ : /\/+$/, "") + path.slice(1);
}
