// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { TermCompletionService } from "./completion-service";
import type { CompletionContext, CompletionItem, CompletionProvider } from "./types";

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "git ch",
        cursorIndex: 6,
        tokens: [
            { text: "git", start: 0, end: 3 },
            { text: "ch", start: 4, end: 6 },
        ],
        searchTerm: "ch",
        tokenIndex: 1,
        tokenType: "subcommand",
        cwd: "/repo",
        connId: "",
        shellType: "zsh",
        env: {},
        recentCommands: [],
        ...overrides,
    };
}

function provider(
    id: string,
    items: CompletionItem[],
    overrides: Partial<CompletionProvider> = {}
): CompletionProvider {
    return {
        id,
        provideCompletions: async () => items,
        ...overrides,
    };
}

describe("TermCompletionService", () => {
    it("runs matching providers and ranks by provider priority then item score", async () => {
        const service = new TermCompletionService([
            provider("low", [{ label: "checkout", insertText: "checkout", kind: "subcommand", score: 100 }], {
                priority: 1,
            }),
            provider("high", [{ label: "cherry-pick", insertText: "cherry-pick", kind: "subcommand", score: 1 }], {
                priority: 10,
            }),
        ]);

        const items = await service.provideCompletions(makeContext());

        expect(items.map((item) => item.label)).toEqual(["cherry-pick", "checkout"]);
        expect(items.map((item) => item.source)).toEqual(["high", "low"]);
    });

    it("filters providers by shell and trigger characters", async () => {
        const service = new TermCompletionService([
            provider("zsh", [{ label: "zsh-item", insertText: "zsh-item", kind: "argument" }], {
                shellTypes: ["zsh"],
            }),
            provider("fish", [{ label: "fish-item", insertText: "fish-item", kind: "argument" }], {
                shellTypes: ["fish"],
            }),
            provider("dash", [{ label: "-n", insertText: "-n", kind: "flag" }], {
                triggerCharacters: ["-"],
            }),
        ]);

        const wordItems = await service.provideCompletions(makeContext({ searchTerm: "z", tokenType: "argument" }));
        const flagItems = await service.provideCompletions(makeContext({ searchTerm: "-n", tokenType: "option" }));

        expect(wordItems.map((item) => item.label)).toEqual(["zsh-item"]);
        expect(flagItems.map((item) => item.label)).toEqual(["-n"]);
    });

    it("dedupes equivalent insertions while keeping the higher ranked source", async () => {
        const service = new TermCompletionService([
            provider("history", [{ label: "git checkout", insertText: "checkout", kind: "history", score: 10 }], {
                priority: 1,
            }),
            provider("fig", [{ label: "checkout", insertText: "checkout", kind: "subcommand", score: 20 }], {
                priority: 5,
            }),
        ]);

        const items = await service.provideCompletions(makeContext());

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ label: "checkout", insertText: "checkout", source: "fig" });
    });

    it("keeps provider failures isolated from the merged result", async () => {
        const service = new TermCompletionService([
            {
                id: "broken",
                provideCompletions: async () => {
                    throw new Error("provider failed");
                },
            },
            provider("working", [{ label: "checkout", insertText: "checkout", kind: "subcommand" }]),
        ]);

        await expect(service.provideCompletions(makeContext())).resolves.toMatchObject([
            { label: "checkout", source: "working" },
        ]);
    });

    it("runs fallback providers only when normal providers return no items", async () => {
        let fallbackCalls = 0;
        const fallbackProvider = provider(
            "ai",
            [{ label: "df -h", insertText: "df -h", kind: "ai", filterText: "ch" }],
            {
                fallback: true,
                provideCompletions: async () => {
                    fallbackCalls++;
                    return [{ label: "df -h", insertText: "df -h", kind: "ai", filterText: "ch" }];
                },
            }
        );
        const serviceWithNormal = new TermCompletionService([
            provider("normal", [{ label: "checkout", insertText: "checkout", kind: "subcommand" }]),
            fallbackProvider,
        ]);

        await expect(serviceWithNormal.provideCompletions(makeContext())).resolves.toMatchObject([
            { label: "checkout", source: "normal" },
        ]);
        expect(fallbackCalls).toBe(0);

        const serviceWithoutNormal = new TermCompletionService([provider("empty", []), fallbackProvider]);
        await expect(serviceWithoutNormal.provideCompletions(makeContext())).resolves.toMatchObject([
            { label: "df -h", source: "ai" },
        ]);
        expect(fallbackCalls).toBe(1);
    });
});
