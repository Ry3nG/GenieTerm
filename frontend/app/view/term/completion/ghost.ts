// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionItem } from "./types";

// The part of the item that would be appended after what is already typed for the
// current token; "" when the item doesn't extend the typed text.
export function getCompletionSuffix(searchTerm: string, item: CompletionItem): string {
    const typed = searchTerm ?? "";
    if (!item.insertText.toLowerCase().startsWith(typed.toLowerCase())) {
        return "";
    }
    return item.insertText.slice(typed.length);
}

export function makeCompletionGhostText(searchTerm: string, item: CompletionItem): string {
    if (!searchTerm) {
        return "";
    }
    return getCompletionSuffix(searchTerm, item);
}
