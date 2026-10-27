// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { RunCompletionGenerator } from "./fig-static-provider";
import type { CompletionItem, CompletionProvider } from "./types";

// Command-name completion from the connection's actual $PATH executables (local OR remote
// over SSH), the way Warp does it. This covers binaries with no Fig spec - nvidia-smi,
// nvidia-detector, internal tools, etc. - which the static Fig name list can never know about.

const PathCacheTtlMs = 60000;
const MaxPathCacheEntries = 128;
const PathCache = new Map<string, { ts: number; names: Promise<string[]> }>();

// portable: split $PATH on ':' and list each dir's entries. Runs where the shell lives, so
// over SSH it enumerates the REMOTE host's PATH (which is what shows nvidia-* on the GPU box).
const ListPathScript = 'IFS=:; for d in $PATH; do [ -d "$d" ] && ls -1 "$d" 2>/dev/null; done';
const ListPowerShellCommandsScript =
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-Command -Name ([System.Management.Automation.WildcardPattern]::Escape($env:GENIETERM_COMPLETION_PREFIX) + '*') -CommandType Alias,Function,Cmdlet,ExternalScript,Application -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name";

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
            const powerShell = ctx.shellType === "pwsh";
            const cacheKey = JSON.stringify([
                ctx.connId,
                ctx.shellName ?? ctx.shellType,
                powerShell ? term.toLowerCase() : "",
            ]);
            let entry = PathCache.get(cacheKey);
            if (entry == null || Date.now() - entry.ts > PathCacheTtlMs) {
                for (const [key, cached] of PathCache) {
                    if (Date.now() - cached.ts > PathCacheTtlMs) PathCache.delete(key);
                }
                while (PathCache.size >= MaxPathCacheEntries) {
                    PathCache.delete(PathCache.keys().next().value);
                }
                const namesPromise = runGenerator({
                    command: ctx.shellType === "pwsh" ? (ctx.shellName === "powershell" ? "powershell" : "pwsh") : "sh",
                    args:
                        ctx.shellType === "pwsh"
                            ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ListPowerShellCommandsScript]
                            : ["-c", ListPathScript],
                    cwd: ctx.cwd,
                    connId: ctx.connId,
                    ...(powerShell ? { env: { GENIETERM_COMPLETION_PREFIX: term } } : {}),
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
