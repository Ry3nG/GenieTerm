// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CompletionContext, CompletionItem, CompletionProvider } from "./types";

const MaxHistoryCompletions = 20;
const HistoryBaseScore = 1000;

function startsWithIgnoreCase(value: string, prefix: string): boolean {
    return value.toLowerCase().startsWith(prefix.toLowerCase());
}

// Text of the current command segment before the token being completed, with runs of
// whitespace collapsed so `git  log ` still matches a history entry `git log ...`.
function getPrecedingCommandText(ctx: CompletionContext): string | null {
    const first = ctx.tokens[0];
    if (first == null) {
        return null;
    }
    const editing = ctx.tokenIndex >= 0 && ctx.tokenIndex < ctx.tokens.length ? ctx.tokens[ctx.tokenIndex] : null;
    const tokenStart = editing?.start ?? ctx.cursorIndex;
    const preceding = ctx.inputText.slice(first.start, tokenStart).replace(/\s+/g, " ");
    return preceding.endsWith(" ") ? preceding : null;
}

export function makeHistoryCompletionProvider(): CompletionProvider {
    return {
        id: "history",
        priority: 10,
        provideCompletions: async (ctx) => {
            const items: CompletionItem[] = [];
            const seen = new Set<string>();
            const precedingText = getPrecedingCommandText(ctx);
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
                    // every token before the one being completed must match too, otherwise
                    // `git log ch` would complete to `git log checkout main`.
                    if (precedingText == null || !startsWithIgnoreCase(command, precedingText)) {
                        continue;
                    }
                    const remainder = command.slice(precedingText.length);
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
