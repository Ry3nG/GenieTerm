// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Frozen contract for inline command completion. Providers (file/folder, history,
// Fig specs, dynamic generators, AI) all implement CompletionProvider and feed one
// ranked list. Keep this stable so providers can be built in parallel.

export type ShellType = "zsh" | "bash" | "fish" | "pwsh" | "unknown";

export type CompletionItemKind = "file" | "folder" | "command" | "subcommand" | "flag" | "argument" | "history" | "ai";

export type CompletionTokenType = "command" | "subcommand" | "option" | "argument";

// The live prompt input buffer reported by shell integration (OSC 16162 "I").
// cursorIndex is a JS string index (UTF-16 code units), already normalized from the
// shell's character offset.
export interface TermInputBuffer {
    text: string;
    cursorIndex: number;
}

export interface CommandToken {
    text: string;
    // [start, end) JS string indices into the full input line
    start: number;
    end: number;
}

export interface CompletionContext {
    // full partial command line on the current prompt
    inputText: string;
    cursorIndex: number;
    // tokens of the final pipeline segment up to the cursor
    tokens: CommandToken[];
    // the partial token text being completed (left of cursor, within the current token)
    searchTerm: string;
    // index into tokens of the token being completed; -1 when starting a fresh token
    tokenIndex: number;
    tokenType: CompletionTokenType;
    cwd: string;
    // GenieTerm connection id for routing generators/listing; "" for local or for a
    // bare interactive `ssh host` typed at the prompt (degrades to static specs).
    connId: string;
    shellType: ShellType;
    env: Record<string, string>;
    // recent commands (most-recent first) from this terminal's command blocks; feeds the history provider
    recentCommands: string[];
    // auto while typing, manual for an explicit Ctrl-Space request
    requestKind?: "auto" | "manual";
}

export interface CompletionItem {
    label: string;
    // text that completes searchTerm (replaces the partial token, not the whole line)
    insertText: string;
    kind: CompletionItemKind;
    detail?: string;
    // higher ranks first within a provider; the service combines this with provider priority
    score?: number;
    icon?: string;
    // require explicit confirm before inserting (maps to Fig isDangerous)
    isDangerous?: boolean;
    // id of the provider that produced this item (dedupe tie-break / debugging)
    source?: string;
    // Optional full-line or custom replacement range. Defaults to the active token.
    replaceStart?: number;
    replaceEnd?: number;
    // Optional hidden text used by the service filter.
    filterText?: string;
}

export interface CompletionProvider {
    id: string;
    // higher priority runs and ranks first; default 0
    priority?: number;
    // restrict to specific shells; undefined = all shells
    shellTypes?: ShellType[];
    // when set, only invoked if the searchTerm/preceding char matches (e.g. "-", "/")
    triggerCharacters?: string[];
    // fallback providers run only when normal providers produced no items
    fallback?: boolean;
    provideCompletions(ctx: CompletionContext): Promise<CompletionItem[]>;
}

export function normalizeShellType(shell?: string): ShellType {
    const normalized = shell?.toLowerCase() ?? "";
    if (normalized.includes("zsh")) {
        return "zsh";
    }
    if (normalized.includes("bash")) {
        return "bash";
    }
    if (normalized.includes("fish")) {
        return "fish";
    }
    if (normalized.includes("pwsh") || normalized.includes("powershell")) {
        return "pwsh";
    }
    return "unknown";
}
