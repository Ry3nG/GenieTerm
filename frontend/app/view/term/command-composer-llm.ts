// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    CodexCommandAIProviderStatus,
    ErrorFallbackCommandAIProviderStatus,
    LocalCommandComposerBackend,
    LocalFallbackCommandAIProviderStatus,
    parseCommandProposalResponse,
    type CommandComposerBackend,
    type CommandComposerContext,
    type CommandComposerResult,
} from "./command-composer";

// Generates proposals via the user's Codex/ChatGPT login (keyless, server-side).
// Falls back to the local deterministic generator whenever the model path is
// unavailable, errors, or yields nothing — so it never regresses the composer.
export class LLMCommandComposerBackend implements CommandComposerBackend {
    fallback = new LocalCommandComposerBackend();

    async compose(prompt: string, context: CommandComposerContext): Promise<CommandComposerResult> {
        try {
            const rtn = await RpcApi.AiCommandComposeCommand(TabRpcClient, {
                prompt,
                cwd: context.cwd,
                shell: context.shell,
                os: context.os,
                connection: context.connection,
                recentcommands: context.recentCommands,
            });
            if (!rtn?.available) {
                const fallback = await this.fallback.compose(prompt, context);
                return { ...fallback, providerStatus: LocalFallbackCommandAIProviderStatus };
            }
            if (rtn?.available && rtn.text?.trim()) {
                const proposals = parseCommandProposalResponse(rtn.text, context);
                if (proposals.length > 0) {
                    return { proposals, providerStatus: CodexCommandAIProviderStatus };
                }
            }
        } catch (e) {
            console.warn("command composer model path failed, using local fallback", e);
            const fallback = await this.fallback.compose(prompt, context);
            return { ...fallback, providerStatus: ErrorFallbackCommandAIProviderStatus };
        }
        return this.fallback.compose(prompt, context);
    }
}
