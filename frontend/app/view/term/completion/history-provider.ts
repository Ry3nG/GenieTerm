// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionItem, CompletionProvider } from "./types";

const MaxHistoryCompletions = 20;
const HistoryBaseScore = 1000;

function startsWithIgnoreCase(value: string, prefix: string): boolean {
    return value.toLowerCase().startsWith(prefix.toLowerCase());
}

export function makeHistoryCompletionProvider(): CompletionProvider {
    return {
        id: "history",
        priority: 10,
        provideCompletions: async (ctx) => {
            const items: CompletionItem[] = [];
            const seen = new Set<string>();
            for (let idx = 0; idx < ctx.recentCommands.length; idx++) {
                const command = ctx.recentCommands[idx]?.trim();
                if (!command || seen.has(command)) {
                    continue;
                }
                seen.add(command);

                let insertText = "";
                if (ctx.tokenIndex <= 0) {
                    if (!startsWithIgnoreCase(command, ctx.searchTerm)) {
                        continue;
                    }
                    insertText = command;
                } else {
                    const commandToken = ctx.tokens[0]?.text;
                    if (!commandToken || !startsWithIgnoreCase(command, `${commandToken} `)) {
                        continue;
                    }
                    const remainder = command.slice(commandToken.length + 1);
                    if (!startsWithIgnoreCase(remainder, ctx.searchTerm)) {
                        continue;
                    }
                    insertText = remainder;
                }

                items.push({
                    label: command,
                    insertText,
                    kind: "history",
                    detail: "History",
                    score: HistoryBaseScore - idx,
                });
                if (items.length >= MaxHistoryCompletions) {
                    break;
                }
            }
            return items;
        },
    };
}
