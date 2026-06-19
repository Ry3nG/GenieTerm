// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommandComposerBackend, CommandComposerContext, CommandProposal } from "../command-composer";
import type { CompletionContext, CompletionItem, CompletionProvider } from "./types";

const AIBaseScore = 120;
const MaxAICompletionItems = 3;

function makeComposerContext(ctx: CompletionContext): CommandComposerContext {
    return {
        connection: ctx.connId || "local",
        cwd: ctx.cwd,
        shell: ctx.shellType,
        os: ctx.env.WAVETERM_UNAME || "unknown",
        recentCommands: ctx.recentCommands.slice(0, 6),
    };
}

function isEchoFallback(proposal: CommandProposal): boolean {
    return proposal.source === "local" && /^echo\s+/u.test(proposal.command.trim());
}

export function makeAICompletionProvider(backend: CommandComposerBackend): CompletionProvider {
    return {
        id: "ai",
        priority: 1,
        fallback: true,
        provideCompletions: async (ctx) => {
            if (ctx.requestKind !== "manual") {
                return [];
            }
            const prompt = ctx.inputText.trim();
            if (!prompt) {
                return [];
            }
            const result = await backend.compose(prompt, makeComposerContext(ctx));
            return result.proposals
                .filter((proposal) => proposal.command.trim() !== "")
                .filter((proposal) => !proposal.risk.requiresConfirmation)
                .filter((proposal) => !isEchoFallback(proposal))
                .slice(0, MaxAICompletionItems)
                .map<CompletionItem>((proposal, idx) => ({
                    label: proposal.command,
                    insertText: proposal.command,
                    kind: "ai",
                    detail: `${result.providerStatus.label}: ${proposal.explanation}`,
                    score: AIBaseScore - idx,
                    replaceStart: 0,
                    replaceEnd: ctx.inputText.length,
                    filterText: ctx.searchTerm || ctx.inputText,
                }));
        },
    };
}
