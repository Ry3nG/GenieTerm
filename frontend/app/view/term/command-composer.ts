// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { type CmdBlock, blockHasCommand } from "./cmdblocks";
import type { ShellIntegrationStatus } from "./osc-handlers";

export const CommandComposerActionId = "term:command-composer";
export const CommandComposerDefaultBinding = "Cmd:Shift:Space";

export type CommandRiskLabel = "low" | "write" | "network" | "destructive";
export type CommandProposalSource = "model" | "local";
export type CommandProposalApplyMode = "insert" | "copy" | "confirm";

export type CommandRisk = {
    label: CommandRiskLabel;
    reasons: string[];
    requiresConfirmation: boolean;
};

export type CommandComposerContext = {
    connection: string;
    cwd: string;
    shell: string;
    os: string;
    recentCommands: string[];
    selectedOutput?: string;
};

export type CommandProposal = {
    id: string;
    command: string;
    explanation: string;
    target: string;
    risk: CommandRisk;
    source: CommandProposalSource;
};

export type CommandComposerProviderState = "unknown" | "codex" | "fallback" | "error";

export type CommandComposerProviderStatus = {
    state: CommandComposerProviderState;
    label: string;
    detail: string;
};

export type CommandComposerResult = {
    proposals: CommandProposal[];
    providerStatus: CommandComposerProviderStatus;
};

export type CommandInlineAIStatus = "loading" | "ready" | "error";
export type CommandInlineAIAction = "insert" | "run" | "open" | "dismiss";

export type CommandInlineAIState = {
    prompt: string;
    status: CommandInlineAIStatus;
    proposal?: CommandProposal;
    providerStatus?: CommandComposerProviderStatus;
    error?: string;
    confirmAction?: CommandInlineAIAction;
};

export type CommandInlineAIRequestOptions = {
    auto?: boolean;
};

export type CommandInlineAIRequestHandler = (
    prompt: string,
    block: CmdBlock,
    options?: CommandInlineAIRequestOptions
) => void;
export type CommandInlineAIStateProvider = (block: CmdBlock) => CommandInlineAIState;
export type CommandInlineAIActionHandler = (block: CmdBlock, action: CommandInlineAIAction) => void;

export type CommandComposerContextInput = {
    blockMeta?: MetaType;
    connStatus?: ConnStatus;
    shellType?: string;
    shellUname?: string;
    selectedOutput?: string;
    recentBlocks?: CmdBlock[];
};

export interface CommandComposerBackend {
    compose(prompt: string, context: CommandComposerContext): Promise<CommandComposerResult>;
}

export const UnknownCommandAIProviderStatus: CommandComposerProviderStatus = {
    state: "unknown",
    label: "Checking AI",
    detail: "Checking Codex login status",
};

export const CodexCommandAIProviderStatus: CommandComposerProviderStatus = {
    state: "codex",
    label: "Codex",
    detail: "Using your local Codex login",
};

export const LocalFallbackCommandAIProviderStatus: CommandComposerProviderStatus = {
    state: "fallback",
    label: "Local fallback",
    detail: "Codex is not signed in",
};

export const ErrorFallbackCommandAIProviderStatus: CommandComposerProviderStatus = {
    state: "error",
    label: "Local fallback",
    detail: "Codex request failed",
};

const MaxSelectedOutputChars = 4000;
const MaxRecentCommands = 6;

const DestructivePatterns: Array<[RegExp, string]> = [
    [/(^|[;&|]\s*)sudo\b/, "sudo"],
    [/(^|[;&|]\s*)rm\s+(-[^\s]*[rf][^\s]*|-r|-f)\b/, "rm"],
    [/(^|[;&|]\s*)dd\s+/, "dd"],
    [/(^|[;&|]\s*)mkfs(?:\.|\s)/, "mkfs"],
    [/(^|[;&|]\s*)shutdown\b/, "shutdown"],
    [/(^|[;&|]\s*)reboot\b/, "reboot"],
    [/(^|[;&|]\s*)killall\b/, "killall"],
    [/(^|[;&|]\s*)chmod\s+-R\s+777\b/, "chmod"],
];

const NetworkPatterns: Array<[RegExp, string]> = [
    [/(^|[;&|]\s*)curl\b/, "curl"],
    [/(^|[;&|]\s*)wget\b/, "wget"],
    [/(^|[;&|]\s*)ssh\b/, "ssh"],
    [/(^|[;&|]\s*)scp\b/, "scp"],
    [/(^|[;&|]\s*)rsync\b/, "rsync"],
    [/(^|[;&|]\s*)git\s+(clone|fetch|pull|push)\b/, "git"],
    [/(^|[;&|]\s*)(npm|pnpm|yarn|pip|brew|apt|apt-get)\s+.*\b(install|update|upgrade)\b/, "package-manager"],
];

const WritePatterns: Array<[RegExp, string]> = [
    [/(^|[;&|]\s*)mkdir\b/, "mkdir"],
    [/(^|[;&|]\s*)touch\b/, "touch"],
    [/(^|[;&|]\s*)cp\b/, "cp"],
    [/(^|[;&|]\s*)mv\b/, "mv"],
    [/(^|[;&|]\s*)chmod\b/, "chmod"],
    [/(^|[;&|]\s*)chown\b/, "chown"],
    [/(^|[;&|]\s*)tee\b/, "tee"],
    [/(^|[;&|]\s*)sed\s+(-i|.*\s-i)\b/, "sed"],
    [/(^|[^>])>>?($|[^&])/, "redirect"],
];

function collectReasons(command: string, patterns: Array<[RegExp, string]>): string[] {
    const reasons: string[] = [];
    for (const [pattern, reason] of patterns) {
        if (pattern.test(command)) {
            reasons.push(reason);
        }
    }
    return reasons;
}

export function classifyCommandRisk(command: string): CommandRisk {
    const destructiveReasons = collectReasons(command, DestructivePatterns);
    if (destructiveReasons.length > 0) {
        return { label: "destructive", reasons: destructiveReasons, requiresConfirmation: true };
    }
    const networkReasons = collectReasons(command, NetworkPatterns);
    if (networkReasons.length > 0) {
        return { label: "network", reasons: networkReasons, requiresConfirmation: true };
    }
    const writeReasons = collectReasons(command, WritePatterns);
    if (writeReasons.length > 0) {
        return { label: "write", reasons: writeReasons, requiresConfirmation: true };
    }
    return { label: "low", reasons: [], requiresConfirmation: false };
}

function trimSelectedOutput(selectedOutput: string): string {
    const trimmed = selectedOutput.trim();
    if (trimmed.length <= MaxSelectedOutputChars) {
        return trimmed;
    }
    return trimmed.slice(0, MaxSelectedOutputChars);
}

export function buildCommandComposerContext(input: CommandComposerContextInput): CommandComposerContext {
    const blockMeta = input.blockMeta ?? {};
    const recentBlocks = input.recentBlocks ?? [];
    const recentCommands = recentBlocks
        .filter((block) => blockHasCommand(block))
        .slice(-MaxRecentCommands)
        .map((block) => block.command.trim());
    let recentCwd = "";
    for (let i = recentBlocks.length - 1; i >= 0; i--) {
        if (recentBlocks[i].cwd) {
            recentCwd = recentBlocks[i].cwd;
            break;
        }
    }
    const cwd = (blockMeta["cmd:cwd"] as string) || recentCwd || "~";
    const connection = input.connStatus?.connection || (blockMeta.connection as string) || "local";
    const context: CommandComposerContext = {
        connection,
        cwd,
        os: input.shellUname || "unknown",
        shell: input.shellType || "shell",
        recentCommands,
    };
    if (input.selectedOutput?.trim()) {
        context.selectedOutput = trimSelectedOutput(input.selectedOutput);
    }
    return context;
}

function proposalId(command: string, index: number): string {
    let hash = 0;
    for (let i = 0; i < command.length; i++) {
        hash = (hash * 31 + command.charCodeAt(i)) >>> 0;
    }
    return `cmd-${index}-${hash.toString(16)}`;
}

function proposalTarget(context: CommandComposerContext): string {
    return `${context.connection}:${context.cwd}`;
}

function makeProposal(
    command: string,
    explanation: string,
    context: CommandComposerContext,
    index: number,
    source: CommandProposalSource,
    target?: string
): CommandProposal {
    return {
        id: proposalId(command, index),
        command,
        explanation,
        target: target || proposalTarget(context),
        risk: classifyCommandRisk(command),
        source,
    };
}

function stripJsonFence(raw: string): string {
    const trimmed = raw.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch?.[1]?.trim() ?? trimmed;
}

function normalizeParsedProposals(parsed: any): any[] {
    if (Array.isArray(parsed)) {
        return parsed;
    }
    if (Array.isArray(parsed?.proposals)) {
        return parsed.proposals;
    }
    if (Array.isArray(parsed?.commands)) {
        return parsed.commands;
    }
    return [];
}

export function parseCommandProposalResponse(raw: string, context: CommandComposerContext): CommandProposal[] {
    try {
        const parsed = JSON.parse(stripJsonFence(raw));
        return normalizeParsedProposals(parsed)
            .map((entry, index) => {
                const command = typeof entry === "string" ? entry : entry?.command;
                if (typeof command !== "string" || command.trim() === "") {
                    return null;
                }
                const explanation =
                    typeof entry?.explanation === "string" && entry.explanation.trim()
                        ? entry.explanation.trim()
                        : "Suggested shell command";
                const target = typeof entry?.target === "string" ? entry.target : undefined;
                return makeProposal(command.trim(), explanation, context, index, "model", target);
            })
            .filter(Boolean);
    } catch (_e) {
        const lines = raw
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));
        return lines.map((line, index) => makeProposal(line, "Suggested shell command", context, index, "model"));
    }
}

function quoteForShell(value: string): string {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
        return value;
    }
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function extractQuotedSearch(prompt: string): string {
    const quoted = prompt.match(/["']([^"']+)["']/);
    if (quoted?.[1]) {
        return quoted[1];
    }
    return prompt
        .replace(/\b(search|find|grep|look for|show me)\b/gi, "")
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(" ");
}

export function makeLocalCommandProposals(prompt: string, context: CommandComposerContext): CommandProposal[] {
    const normalized = prompt.trim().toLowerCase();
    const proposals: Array<{ command: string; explanation: string }> = [];

    if (/\bgit\b.*\b(status|changes|changed)\b|\bstatus\b.*\bgit\b/.test(normalized)) {
        proposals.push({
            command: "git status --short --branch",
            explanation: "Show the current branch and changed files.",
        });
    } else if (/\b(list|show)\b.*\b(files|directory)\b|\bls\b/.test(normalized)) {
        proposals.push({ command: "ls -la", explanation: "List files with hidden entries and details." });
    } else if (/\b(disk|space|filesystem)\b|磁盘|空间|容量|文件系统/.test(normalized)) {
        proposals.push({ command: "df -h", explanation: "Show filesystem space in human-readable units." });
    } else if (/\b(port)\b/.test(normalized)) {
        const port = prompt.match(/\b\d{2,5}\b/)?.[0] ?? "3000";
        proposals.push({ command: `lsof -i :${port}`, explanation: `Show processes listening on port ${port}.` });
    } else if (/\b(make|create)\b.*\b(dir|directory|folder)\b/.test(normalized)) {
        proposals.push({
            command: "mkdir -p new-directory",
            explanation: "Create a directory without error if it already exists.",
        });
    } else if (/\b(search|grep|find|look for)\b/.test(normalized)) {
        const searchText = extractQuotedSearch(prompt);
        proposals.push({
            command: `rg -n ${quoteForShell(searchText || "pattern")}`,
            explanation: "Search files recursively with ripgrep.",
        });
    } else {
        proposals.push({
            command: `echo ${quoteForShell(prompt.trim() || "Describe the command you want")}`,
            explanation: "Local fallback echoes the request; configure a model provider for richer proposals.",
        });
    }

    return proposals.map((proposal, index) =>
        makeProposal(proposal.command, proposal.explanation, context, index, "local")
    );
}

export class LocalCommandComposerBackend implements CommandComposerBackend {
    async compose(prompt: string, context: CommandComposerContext): Promise<CommandComposerResult> {
        return {
            proposals: makeLocalCommandProposals(prompt, context),
            providerStatus: LocalFallbackCommandAIProviderStatus,
        };
    }
}

export function isCommandComposerEnabled(settings: Record<string, any>): boolean {
    return settings?.["term:commandcomposer"] !== false;
}

export function getInlineAICommandPrompt(block: CmdBlock): string {
    if (block?.state !== "done" || !blockHasCommand(block) || block.exitCode == null || block.exitCode === 0) {
        return "";
    }
    return block.command.trim();
}

function hasShellOperators(command: string): boolean {
    return /[;&|<>`\\]|\$\(|\${/.test(command);
}

function startsLikeShellCommand(command: string): boolean {
    return /^(?:\.\/|\/|~\/|\w+=|sudo\b|cd\b|ls\b|git\b|grep\b|rg\b|find\b|cat\b|echo\b|npm\b|pnpm\b|yarn\b|python(?:3)?\b|node\b|go\b|make\b|docker\b|kubectl\b|ssh\b|curl\b|wget\b|df\b|du\b|lsof\b|ps\b|kill\b|chmod\b|chown\b|mkdir\b|touch\b|cp\b|mv\b|rm\b|brew\b|apt(?:-get)?\b|pip(?:3)?\b|sed\b|awk\b|tail\b|head\b|less\b|more\b|vim\b|nvim\b|code\b|open\b)/i.test(
        command
    );
}

function containsCJKText(command: string): boolean {
    return /[\u3400-\u9fff]/u.test(command);
}

export function isLikelyNaturalLanguageCommand(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed || hasShellOperators(trimmed) || startsLikeShellCommand(trimmed)) {
        return false;
    }
    if (containsCJKText(trimmed)) {
        return /帮|请|看|查|找|列|显示|告诉|解释|怎么|为什么|一下|磁盘|空间|文件|目录|端口|进程|状态|使用|容量/u.test(
            trimmed
        );
    }
    const words = trimmed.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    if (words.length < 3 && !/[?.!]$/.test(trimmed)) {
        return false;
    }
    return (
        /[?.!]$/.test(trimmed) ||
        /\b(help|please|show|check|tell|what|why|how|can|could|need|want|me|my|usage|disk|file|files|folder|directory|port)\b/i.test(
            trimmed
        )
    );
}

export function shouldAutoComposeInlineAI(block: CmdBlock): boolean {
    const prompt = getInlineAICommandPrompt(block);
    if (!prompt || block.exitCode !== 127) {
        return false;
    }
    return isLikelyNaturalLanguageCommand(prompt);
}

export function getCommandProposalApplyMode(
    proposal: CommandProposal,
    opts: { confirmed: boolean; shellIntegrationStatus?: ShellIntegrationStatus }
): CommandProposalApplyMode {
    if (proposal.risk.requiresConfirmation && !opts.confirmed) {
        return "confirm";
    }
    if (opts.shellIntegrationStatus === "running-command") {
        return "copy";
    }
    return "insert";
}
