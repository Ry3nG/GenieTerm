// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type {
    CommandToken,
    CompletionContext,
    CompletionTokenType,
    ShellName,
    ShellType,
    TermInputBuffer,
} from "./types";

interface RawToken {
    text: string;
    start: number;
    end: number;
    isSep: boolean;
}

function isWhitespace(c: string): boolean {
    return c === " " || c === "\t";
}

function isSeparatorChar(c: string): boolean {
    return c === "|" || c === "&" || c === ";";
}

// Quote-aware scan of a shell line into word tokens and segment separators (| || & && ;).
function scanTokens(line: string, shellType: ShellType): RawToken[] {
    const tokens: RawToken[] = [];
    const escape = shellType === "pwsh" ? "`" : "\\";
    const n = line.length;
    let i = 0;
    while (i < n) {
        const c = line[i];
        if (isWhitespace(c)) {
            i++;
            continue;
        }
        if (isSeparatorChar(c)) {
            let j = i + 1;
            if ((c === "|" && line[j] === "|") || (c === "&" && line[j] === "&")) {
                j++;
            }
            tokens.push({ text: line.slice(i, j), start: i, end: j, isSep: true });
            i = j;
            continue;
        }
        const start = i;
        let inSingle = false;
        let inDouble = false;
        while (i < n) {
            const ch = line[i];
            if (inSingle) {
                if (ch === "'") {
                    inSingle = false;
                }
                i++;
                continue;
            }
            if (inDouble) {
                if (ch === escape && i + 1 < n) {
                    i += 2;
                    continue;
                }
                if (ch === '"') {
                    inDouble = false;
                }
                i++;
                continue;
            }
            if (ch === "'") {
                inSingle = true;
                i++;
                continue;
            }
            if (ch === '"') {
                inDouble = true;
                i++;
                continue;
            }
            if (ch === escape && i + 1 < n) {
                i += 2;
                continue;
            }
            if (isWhitespace(ch) || isSeparatorChar(ch)) {
                break;
            }
            i++;
        }
        tokens.push({ text: line.slice(start, i), start, end: i, isSep: false });
    }
    return tokens;
}

function decodeToken(text: string, shellType: ShellType): string {
    let quote: string = null;
    let decoded = "";
    const escape = shellType === "pwsh" ? "`" : "\\";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const escaped =
            ch === escape &&
            quote !== "'" &&
            i + 1 < text.length &&
            (shellType === "pwsh" || quote !== '"' || /[\\"$`\n]/.test(text[i + 1]));
        if (escaped) {
            decoded += text[++i];
        } else if (quote && ch === quote) {
            if (shellType === "pwsh" && text[i + 1] === quote) {
                decoded += text[++i];
            } else {
                quote = null;
            }
        } else if (!quote && (ch === "'" || ch === '"')) {
            quote = ch;
        } else {
            decoded += ch;
        }
    }
    return decoded;
}

export interface TokenizeResult {
    // word tokens of the pipeline segment containing the cursor, up to the cursor
    tokens: CommandToken[];
    // partial token text left of the cursor (unquoted)
    searchTerm: string;
    // index within tokens of the token being completed; tokens.length when starting fresh
    tokenIndex: number;
    tokenType: CompletionTokenType;
}

export function tokenizeForCompletion(
    text: string,
    cursorIndex: number,
    shellType: ShellType = "unknown"
): TokenizeResult {
    const all = scanTokens(text, shellType);

    // restrict to the segment containing the cursor: tokens after the last separator
    // at/before the cursor and before the next separator.
    let segStart = 0;
    let segEnd = all.length;
    for (let k = 0; k < all.length; k++) {
        const t = all[k];
        if (!t.isSep) {
            continue;
        }
        if (t.end <= cursorIndex) {
            segStart = k + 1;
        } else {
            segEnd = k;
            break;
        }
    }
    const words = all.slice(segStart, segEnd).filter((t) => !t.isSep && t.start <= cursorIndex);

    let editing: RawToken | null = null;
    for (const t of words) {
        if (cursorIndex > t.start && cursorIndex <= t.end) {
            editing = t;
            break;
        }
    }

    const tokens: CommandToken[] = words.map((t) => ({
        text: decodeToken(t.text, shellType),
        start: t.start,
        end: t.end,
    }));

    let searchTerm = "";
    let tokenIndex = words.length;
    if (editing != null) {
        tokenIndex = words.indexOf(editing);
        searchTerm = decodeToken(text.slice(editing.start, cursorIndex), shellType);
    }

    let tokenType: CompletionTokenType;
    if (tokenIndex <= 0) {
        tokenType = "command";
    } else if (searchTerm.startsWith("-")) {
        tokenType = "option";
    } else if (tokenIndex === 1) {
        tokenType = "subcommand";
    } else {
        tokenType = "argument";
    }

    return { tokens, searchTerm, tokenIndex, tokenType };
}

export function buildCompletionContext(
    input: TermInputBuffer,
    env: {
        cwd: string;
        connId: string;
        shellType: ShellType;
        shellName?: ShellName;
        env: Record<string, string>;
        recentCommands: string[];
        requestKind?: CompletionContext["requestKind"];
    }
): CompletionContext {
    const tok = tokenizeForCompletion(input.text, input.cursorIndex, env.shellType);
    return {
        inputText: input.text,
        cursorIndex: input.cursorIndex,
        tokens: tok.tokens,
        searchTerm: tok.searchTerm,
        tokenIndex: tok.tokenIndex,
        tokenType: tok.tokenType,
        cwd: env.cwd,
        connId: env.connId,
        shellType: env.shellType,
        shellName: env.shellName,
        env: env.env,
        recentCommands: env.recentCommands,
        requestKind: env.requestKind,
    };
}
