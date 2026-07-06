// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    CodexCommandAIProviderStatus,
    ErrorFallbackCommandAIProviderStatus,
    parseCommandProposalResponse,
    type CommandComposerBackend,
    type CommandComposerContext,
    type CommandComposerProviderReason,
    type CommandComposerProviderStatus,
    type CommandComposerResult,
} from "./command-composer";

type AiCommandComposeRtnWithStatus = AiCommandComposeRtn & {
    status?: string;
    statusdetail?: string;
    logincommand?: string;
    installcommand?: string;
};

function normalizeReason(status?: string): CommandComposerProviderReason {
    if (status === "expired" || status === "requestfailed" || status === "emptyresponse") {
        return status;
    }
    if (status === "ready") {
        return "ready";
    }
    return "loginrequired";
}

function makeLoginStatus(rtn?: AiCommandComposeRtnWithStatus): CommandComposerProviderStatus {
    const actionCommand = rtn?.logincommand || "codex login";
    const installCommand = rtn?.installcommand || "npm install -g @openai/codex";
    return {
        state: "error",
        label: "Codex login required",
        reason: "loginrequired",
        detail: rtn?.statusdetail || "Sign in with ChatGPT from Codex CLI to enable Command AI.",
        actionLabel: "Copy login command",
        actionCommand,
        secondaryActionLabel: "Copy install command",
        secondaryActionCommand: installCommand,
    };
}

function makeProviderStatus(rtn?: AiCommandComposeRtnWithStatus): CommandComposerProviderStatus {
    const reason = normalizeReason(rtn?.status);
    if (reason === "ready") {
        return CodexCommandAIProviderStatus;
    }
    if (reason === "loginrequired") {
        return makeLoginStatus(rtn);
    }
    if (reason === "expired") {
        return {
            ...makeLoginStatus(rtn),
            reason,
            label: "Codex login expired",
            detail: rtn?.statusdetail || "Codex OAuth login expired. Run codex login, then retry.",
        };
    }
    if (reason === "emptyresponse") {
        return {
            state: "error",
            label: "Codex returned no command",
            reason,
            detail: rtn?.statusdetail || "Codex did not return a usable command suggestion.",
        };
    }
    return {
        ...ErrorFallbackCommandAIProviderStatus,
        detail: rtn?.statusdetail || ErrorFallbackCommandAIProviderStatus.detail,
    };
}

// Generates proposals via the user's Codex/ChatGPT OAuth login (keyless, server-side).
export class LLMCommandComposerBackend implements CommandComposerBackend {
    async compose(prompt: string, context: CommandComposerContext): Promise<CommandComposerResult> {
        try {
            const rtn = (await RpcApi.AiCommandComposeCommand(TabRpcClient, {
                prompt,
                cwd: context.cwd,
                shell: context.shell,
                os: context.os,
                connection: context.connection,
                recentcommands: context.recentCommands,
            })) as AiCommandComposeRtnWithStatus;
            if (!rtn?.available) {
                return { proposals: [], providerStatus: makeProviderStatus(rtn) };
            }
            if (rtn?.available && rtn.text?.trim()) {
                const proposals = parseCommandProposalResponse(rtn.text, context);
                if (proposals.length > 0) {
                    return { proposals, providerStatus: CodexCommandAIProviderStatus };
                }
            }
            return { proposals: [], providerStatus: makeProviderStatus({ ...rtn, status: "emptyresponse" }) };
        } catch (e) {
            return {
                proposals: [],
                providerStatus: {
                    ...ErrorFallbackCommandAIProviderStatus,
                    detail: e instanceof Error ? e.message : String(e),
                },
            };
        }
    }
}
