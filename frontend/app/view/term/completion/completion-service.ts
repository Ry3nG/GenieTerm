// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionContext, CompletionItem, CompletionProvider } from "./types";

type RankedCompletionItem = CompletionItem & {
    providerPriority: number;
    itemScore: number;
    order: number;
};

function matchesShell(provider: CompletionProvider, ctx: CompletionContext): boolean {
    return provider.shellTypes == null || provider.shellTypes.includes(ctx.shellType);
}

function matchesTrigger(provider: CompletionProvider, ctx: CompletionContext): boolean {
    if (provider.triggerCharacters == null || provider.triggerCharacters.length === 0) {
        return true;
    }
    const previousChar = ctx.cursorIndex > 0 ? ctx.inputText[ctx.cursorIndex - 1] : "";
    return provider.triggerCharacters.some((trigger) => ctx.searchTerm.startsWith(trigger) || previousChar === trigger);
}

function fuzzyMatches(searchTerm: string, item: CompletionItem): boolean {
    const needle = searchTerm.toLowerCase();
    if (needle === "") {
        return true;
    }
    const haystacks = [item.label, item.insertText, item.filterText ?? ""].map((value) => value.toLowerCase());
    return haystacks.some((haystack) => haystack.includes(needle));
}

function completionDedupeKey(item: CompletionItem): string {
    return item.insertText;
}

function compareRankedItems(a: RankedCompletionItem, b: RankedCompletionItem): number {
    if (a.providerPriority !== b.providerPriority) {
        return b.providerPriority - a.providerPriority;
    }
    if (a.itemScore !== b.itemScore) {
        return b.itemScore - a.itemScore;
    }
    return a.order - b.order;
}

export class TermCompletionService {
    providers: CompletionProvider[];

    constructor(providers: CompletionProvider[] = []) {
        this.providers = providers;
    }

    registerProvider(provider: CompletionProvider): void {
        this.providers.push(provider);
    }

    async collectRankedItems(ctx: CompletionContext, providers: CompletionProvider[]): Promise<RankedCompletionItem[]> {
        const batches = await Promise.all(
            providers.map(async (provider) => {
                try {
                    return { provider, items: await provider.provideCompletions(ctx) };
                } catch {
                    return { provider, items: [] };
                }
            })
        );

        const rankedItems: RankedCompletionItem[] = [];
        let order = 0;
        for (const batch of batches) {
            const providerPriority = batch.provider.priority ?? 0;
            for (const item of batch.items) {
                if (!fuzzyMatches(ctx.searchTerm, item)) {
                    continue;
                }
                rankedItems.push({
                    ...item,
                    source: item.source ?? batch.provider.id,
                    providerPriority,
                    itemScore: item.score ?? 0,
                    order,
                });
                order++;
            }
        }
        return rankedItems;
    }

    async provideCompletions(ctx: CompletionContext): Promise<CompletionItem[]> {
        const matchingProviders = this.providers.filter(
            (provider) => matchesShell(provider, ctx) && matchesTrigger(provider, ctx)
        );
        const normalProviders = matchingProviders.filter((provider) => !provider.fallback);
        const fallbackProviders = matchingProviders.filter((provider) => provider.fallback);
        let rankedItems = await this.collectRankedItems(ctx, normalProviders);
        if (rankedItems.length === 0 && fallbackProviders.length > 0) {
            rankedItems = await this.collectRankedItems(ctx, fallbackProviders);
        }

        rankedItems.sort(compareRankedItems);
        const deduped = new Map<string, RankedCompletionItem>();
        for (const item of rankedItems) {
            const key = completionDedupeKey(item);
            if (deduped.has(key)) {
                continue;
            }
            deduped.set(key, item);
        }
        return Array.from(deduped.values()).map(({ providerPriority, itemScore, order, ...item }) => item);
    }
}
