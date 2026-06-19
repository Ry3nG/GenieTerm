// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { RunCompletionGenerator } from "./fig-static-provider";
import type { CompletionItem, CompletionProvider } from "./types";

// Command-name completion from the connection's actual $PATH executables (local OR remote
// over SSH), the way Warp does it. This covers binaries with no Fig spec - nvidia-smi,
// nvidia-detector, internal tools, etc. - which the static Fig name list can never know about.

const PathCacheTtlMs = 60000;
const PathCache = new Map<string, { ts: number; names: Promise<string[]> }>();

// portable: split $PATH on ':' and list each dir's entries. Runs where the shell lives, so
// over SSH it enumerates the REMOTE host's PATH (which is what shows nvidia-* on the GPU box).
const ListPathScript = 'IFS=:; for d in $PATH; do [ -d "$d" ] && ls -1 "$d" 2>/dev/null; done';

function startsWithIgnoreCase(value: string, prefix: string): boolean {
    return value.toLowerCase().startsWith(prefix.toLowerCase());
}

export function parsePathExecutables(stdout: string): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const line of stdout.split("\n")) {
        const name = line.trim();
        if (!name || seen.has(name)) {
            continue;
        }
        seen.add(name);
        names.push(name);
    }
    return names;
}

export function makePathCommandCompletionProvider(
    runGenerator: RunCompletionGenerator | undefined
): CompletionProvider {
    return {
        id: "path",
        priority: 6,
        provideCompletions: async (ctx): Promise<CompletionItem[]> => {
            if (runGenerator == null || ctx.tokenIndex > 0) {
                return [];
            }
            const term = ctx.searchTerm;
            if (term.length < 1 || term.startsWith("-")) {
                return [];
            }
            const cacheKey = ctx.connId;
            let entry = PathCache.get(cacheKey);
            if (entry == null || Date.now() - entry.ts > PathCacheTtlMs) {
                const namesPromise = runGenerator({
                    command: "sh",
                    args: ["-c", ListPathScript],
                    cwd: ctx.cwd,
                    connId: ctx.connId,
                })
                    .then((res) => (res != null && res.supported ? parsePathExecutables(res.stdout) : []))
                    .catch(() => []);
                entry = { ts: Date.now(), names: namesPromise };
                PathCache.set(cacheKey, entry);
            }
            const names = await entry.names;
            return names
                .filter((name) => startsWithIgnoreCase(name, term) && name.toLowerCase() !== term.toLowerCase())
                .slice(0, 50)
                .map((name, idx) => ({
                    label: name,
                    insertText: name,
                    kind: "command" as const,
                    score: 250 - idx,
                    source: "path",
                }));
        },
    };
}
