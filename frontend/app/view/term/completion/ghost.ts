// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionItem } from "./types";

export function makeCompletionGhostText(searchTerm: string, item: CompletionItem): string {
    if (!searchTerm) {
        return "";
    }
    if (!item.insertText.toLowerCase().startsWith(searchTerm.toLowerCase())) {
        return "";
    }
    return item.insertText.slice(searchTerm.length);
}
