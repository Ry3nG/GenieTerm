// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { makeCompletionGhostText } from "./ghost";
import type { CompletionItem } from "./types";

function item(insertText: string): CompletionItem {
    return { label: insertText, insertText, kind: "subcommand" };
}

describe("makeCompletionGhostText", () => {
    it("returns the unmatched suffix for prefix matches", () => {
        expect(makeCompletionGhostText("ch", item("checkout"))).toBe("eckout");
    });

    it("matches case-insensitively while preserving completion casing", () => {
        expect(makeCompletionGhostText("g", item("GitHub"))).toBe("itHub");
    });

    it("returns an empty string when the completion does not extend the search term", () => {
        expect(makeCompletionGhostText("co", item("checkout"))).toBe("");
        expect(makeCompletionGhostText("checkout", item("checkout"))).toBe("");
    });
});
