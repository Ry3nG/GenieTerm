// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const SafeExternalProtocols = new Set(["http:", "https:", "mailto:"]);

export function isSafeExternalUrl(url: string): boolean {
    if (typeof url !== "string" || url.trim() === "") {
        return false;
    }
    try {
        const parsed = new URL(url);
        return SafeExternalProtocols.has(parsed.protocol);
    } catch {
        return false;
    }
}
