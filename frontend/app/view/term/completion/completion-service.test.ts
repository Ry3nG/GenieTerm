// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { TermCompletionService } from "./completion-service";
import { makePathCommandCompletionProvider } from "./path-provider";
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
    afterEach(() => vi.useRealTimers());

    it.each(["powershell", "pwsh"] as const)("keeps a cold %s command result after 1.5 seconds", async (shellName) => {
        vi.useFakeTimers();
        const runGenerator = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 2300));
            return { supported: true, stdout: "Get-ChildItem\n" };
        });
        const service = new TermCompletionService([makePathCommandCompletionProvider(runGenerator)]);
        const result = service.provideCompletions(
            makeContext({
                shellType: "pwsh",
                shellName,
                connId: `cold-${shellName}`,
                inputText: "Get-Ch",
                cursorIndex: 6,
                tokens: [{ text: "Get-Ch", start: 0, end: 6 }],
                tokenIndex: 0,
                tokenType: "command",
                searchTerm: "Get-Ch",
            })
        );

        await vi.advanceTimersByTimeAsync(2300);

        expect(await result).toMatchObject([{ label: "Get-ChildItem", source: "path" }]);
        expect(runGenerator).toHaveBeenCalledWith(expect.objectContaining({ command: shellName }));
    });

    it("retains the short default budget for non-PowerShell providers", async () => {
        vi.useFakeTimers();
        const service = new TermCompletionService([
            provider("slow", [], {
                provideCompletions: () =>
                    new Promise((resolve) =>
                        setTimeout(
                            () =>
                                resolve([
                                    {
                                        label: "checkout",
                                        insertText: "checkout",
                                        kind: "command",
                                    },
                                ]),
                            2300
                        )
                    ),
            }),
        ]);
        const result = service.provideCompletions(makeContext({ shellType: "bash" }));

        await vi.advanceTimersByTimeAsync(1500);

        expect(await result).toEqual([]);
    });

    it("still bounds a hung PowerShell provider without dropping fast results", async () => {
        vi.useFakeTimers();
        const service = new TermCompletionService([
            provider("fast", [{ label: "checkout", insertText: "checkout", kind: "command" }]),
            provider("hung", [], { provideCompletions: () => new Promise(() => {}) }),
        ]);
        const result = service.provideCompletions(makeContext({ shellType: "pwsh" }));
        let settled = false;
        void result.then(() => (settled = true));

        await vi.advanceTimersByTimeAsync(4999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);

        expect(await result).toMatchObject([{ label: "checkout", source: "fast" }]);
    });

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

    it.each(["zsh", "pwsh"] as const)(
        "respects an explicit timeout for %s without dropping faster providers",
        async (shellType) => {
            const service = new TermCompletionService(
                [
                    provider("fast", [{ label: "checkout", insertText: "checkout", kind: "subcommand" }]),
                    {
                        id: "hanging",
                        provideCompletions: () => new Promise<never>(() => {}),
                    },
                ],
                { providerTimeoutMs: 30 }
            );

            const items = await service.provideCompletions(makeContext({ shellType }));

            expect(items.map((item) => item.source)).toEqual(["fast"]);
        }
    );

    it("returns an empty list when every provider times out", async () => {
        const service = new TermCompletionService(
            [
                {
                    id: "hanging-a",
                    provideCompletions: () => new Promise<never>(() => {}),
                },
                {
                    id: "hanging-b",
                    provideCompletions: () => new Promise<never>(() => {}),
                },
            ],
            { providerTimeoutMs: 30 }
        );

        await expect(service.provideCompletions(makeContext())).resolves.toEqual([]);
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
