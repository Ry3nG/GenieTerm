// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function quotePowerShellPath(path: string): string {
    if (path === "~") {
        return "$HOME";
    }
    if (path.startsWith("~/") || path.startsWith("~\\")) {
        return `($HOME + '${path.slice(1).replace(/'/g, "''")}')`;
    }
    return `'${path.replace(/'/g, "''")}'`;
}
