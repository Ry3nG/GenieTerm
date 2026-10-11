// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isUserInterruptExit } from "./cmdblockdisplay";
import { blockHasCommand, isCmdBlockCommandPlaceholder, type CmdBlock } from "./cmdblocks";
import { classifyCommandRisk, commandHasHiddenCharacters, type CommandRisk } from "./command-risk";
import type { ShellIntegrationStatus } from "./osc-handlers";

export const CommandComposerActionId = "term:command-composer";
export const CommandComposerDefaultBinding = "Cmd:Shift:Space";

export type CommandAiTask = "compose" | "fix" | "explain";
export type CommandAiApplyAction = "insert" | "run" | "copy";
export type CommandAiApplyMode = CommandAiApplyAction | "confirm";

export type CommandAiProposalView = {
    id: string;
    command: string;
    explanation: string;
    risk: CommandRisk;
    hiddenChars: boolean;
};

export type CommandAiTarget = {
    blockId: number;
    command: string;
    exitCode?: number;
    output?: string;
    outputLines?: number;
};

export type CommandAiExchange = {
    prompt: string;
    result: CommandAiResult;
    proposals: CommandAiProposalView[];
};

export type CommandAiDisclosureState = {
    loading: boolean;
    preview?: CommandAiPreview;
    error?: string;
};

export type CommandAiPending = {
    requestId: string;
    prompt: string;
    startedAt: number;
};

export type CommandAiSheetState = {
    task: CommandAiTask;
    input: string;
    exchanges: CommandAiExchange[];
    pending?: CommandAiPending;
    selected: number;
    confirmId?: string;
    target?: CommandAiTarget;
    selection?: string;
    includeOutput: boolean;
    disclosure?: CommandAiDisclosureState;
    notice?: string;
};

export type CommandInlineAIStatus = "loading" | "ready" | "error";
export type CommandInlineAIAction = "insert" | "run" | "open" | "dismiss";

export type CommandInlineAIState = {
    prompt: string;
    status: CommandInlineAIStatus;
    proposal?: CommandAiProposalView;
    result?: CommandAiResult;
    confirmAction?: CommandInlineAIAction;
    requestId?: string;
};

export type CommandInlineAIRequestOptions = {
    auto?: boolean;
};

export type CommandInlineAIRequestHandler = (
    prompt: string,
    block: CmdBlock,
    options?: CommandInlineAIRequestOptions
) => void;

export type CommandAiContextInput = {
    blockMeta?: MetaType;
    recentBlocks?: CmdBlock[];
    shellType?: string;
    connection?: string;
};

export type CommandAiProblem = {
    title: string;
    detail: string;
    fixCommand?: string;
    openSettings?: boolean;
    retry?: boolean;
};

const MaxRecentCommands = 8;
const MaxOutputLines = 120;
const MaxProposals = 3;

export function isCommandComposerEnabled(settings: Record<string, any>): boolean {
    return settings?.["term:commandcomposer"] !== false;
}

function proposalId(command: string, index: number): string {
    let hash = 0;
    for (let i = 0; i < command.length; i++) {
        hash = (hash * 31 + command.charCodeAt(i)) >>> 0;
    }
    return `cmd-${index}-${hash.toString(16)}`;
}

export function makeProposalViews(result: CommandAiResult): CommandAiProposalView[] {
    const seen = new Set<string>();
    const views: CommandAiProposalView[] = [];
    for (const proposal of result?.proposals ?? []) {
        const command = (proposal?.command ?? "").trim();
        if (!command || seen.has(command)) {
            continue;
        }
        seen.add(command);
        views.push({
            id: proposalId(command, views.length),
            command,
            explanation: (proposal.explanation ?? "").trim(),
            risk: classifyCommandRisk(command),
            hiddenChars: commandHasHiddenCharacters(command),
        });
        if (views.length >= MaxProposals) {
            break;
        }
    }
    return views;
}

export function needsRunConfirmation(proposal: CommandAiProposalView): boolean {
    return proposal.risk.level === "danger" || proposal.hiddenChars;
}

// Inserting only types the command at the prompt, so it never needs confirmation; the
// exception is a multi-line command without bracketed paste, where each newline would
// run a line, so it is copied instead.
export function getCommandAiApplyMode(
    proposal: CommandAiProposalView,
    action: CommandAiApplyAction,
    opts: { confirmed: boolean; shellIntegrationStatus?: ShellIntegrationStatus; bracketedPaste?: boolean }
): CommandAiApplyMode {
    if (action === "copy") {
        return "copy";
    }
    if (opts.shellIntegrationStatus === "running-command") {
        return "copy";
    }
    if (action === "insert") {
        if (/[\r\n]/.test(proposal.command) && !opts.bracketedPaste) {
            return "copy";
        }
        return "insert";
    }
    if (needsRunConfirmation(proposal) && !opts.confirmed) {
        return "confirm";
    }
    return "run";
}

export function buildCommandAiContext(input: CommandAiContextInput): CommandAiContext {
    const blockMeta = input.blockMeta ?? {};
    const recentBlocks = input.recentBlocks ?? [];
    const recentCommands: string[] = [];
    for (const block of recentBlocks) {
        if (!blockHasCommand(block) || isCmdBlockCommandPlaceholder(block.command)) {
            continue;
        }
        const command = block.command.trim();
        if (recentCommands[recentCommands.length - 1] === command) {
            continue;
        }
        recentCommands.push(command);
    }
    let recentCwd = "";
    for (let i = recentBlocks.length - 1; i >= 0; i--) {
        if (recentBlocks[i].cwd) {
            recentCwd = recentBlocks[i].cwd;
            break;
        }
    }
    const context: CommandAiContext = {
        connection: input.connection || (blockMeta.connection as string) || "",
        cwd: (blockMeta["cmd:cwd"] as string) || recentCwd || "",
        recentcommands: recentCommands.slice(-MaxRecentCommands),
    };
    if (input.shellType && input.shellType !== "unknown") {
        context.shell = input.shellType;
    }
    return context;
}

export function tailLines(text: string, maxLines = MaxOutputLines): { text: string; lines: number } {
    const lines = (text ?? "").replace(/\s+$/, "").split("\n");
    if (lines.length === 1 && lines[0] === "") {
        return { text: "", lines: 0 };
    }
    const kept = lines.slice(-maxLines);
    return { text: kept.join("\n"), lines: kept.length };
}

export function makeCommandAiTarget(block: CmdBlock, outputText: string): CommandAiTarget {
    const tail = tailLines(outputText);
    return {
        blockId: block.id,
        command: block.command?.trim() ?? "",
        exitCode: block.exitCode ?? undefined,
        output: tail.text,
        outputLines: tail.lines,
    };
}

export function getBlockAiTask(block: CmdBlock): CommandAiTask | null {
    if (block?.state !== "done" || !blockHasCommand(block) || isCmdBlockCommandPlaceholder(block.command)) {
        return null;
    }
    if (block.exitCode != null && block.exitCode !== 0 && !isUserInterruptExit(block.exitCode)) {
        return "fix";
    }
    return "explain";
}

export function makePreviousTurns(exchanges: CommandAiExchange[]): CommandAiTurn[] {
    return exchanges.slice(-4).map((exchange) => ({
        prompt: exchange.prompt,
        commands: exchange.proposals.map((proposal) => proposal.command),
    }));
}

export function describeCommandAiProblem(result: CommandAiResult): CommandAiProblem | null {
    const engine = result?.enginelabel || "The AI";
    switch (result?.status) {
        case "ok":
        case "canceled":
            return null;
        case "empty":
            return {
                title: "No command came back",
                detail: result.statusdetail || "Try describing the result you want, such as a file, port or process.",
                retry: true,
            };
        case "disabled":
            return { title: "Command AI is off", detail: result.statusdetail || "", openSettings: true };
        case "notconfigured":
            return {
                title: "Finish setting up Command AI",
                detail: result.statusdetail || "Choose the AI that Command AI should use.",
                openSettings: true,
            };
        case "unavailable":
            return {
                title: `${engine} isn't available`,
                detail: result.statusdetail || `GenieTerm couldn't find ${engine} on this computer.`,
                fixCommand: result.fixcommand,
                openSettings: true,
            };
        case "signedout":
            return {
                title: `Sign in to ${engine}`,
                detail: result.statusdetail || `${engine} needs you to sign in before it can answer.`,
                fixCommand: result.fixcommand,
                retry: true,
            };
        case "timeout":
            return {
                title: `${engine} took too long`,
                detail: result.statusdetail || "Try again, or choose a faster model in Settings.",
                retry: true,
            };
        default:
            return {
                title: `${engine} couldn't answer`,
                detail: result?.statusdetail || "Something went wrong. Try again.",
                fixCommand: result?.fixcommand,
                retry: true,
            };
    }
}

export function getInlineAICommandPrompt(block: CmdBlock): string {
    if (
        block?.state !== "done" ||
        !blockHasCommand(block) ||
        block.exitCode == null ||
        block.exitCode === 0 ||
        isUserInterruptExit(block.exitCode)
    ) {
        return "";
    }
    if (isCmdBlockCommandPlaceholder(block.command)) {
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
    return /[㐀-鿿]/u.test(command);
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
