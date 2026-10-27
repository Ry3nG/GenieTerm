// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { RunCompletionGenerator } from "./fig-static-provider";
import type { CompletionContext, CompletionProvider } from "./types";

const CacheTtlMs = 60000;
const MaxCacheEntries = 128;
const CommandCache = new Map<string, { ts: number; result: Promise<PowerShellCommandMetadata | null> }>();
const CommandMetadataScript = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$command = Get-Command -Name ([System.Management.Automation.WildcardPattern]::Escape($env:GENIETERM_COMPLETION_COMMAND)) -ErrorAction SilentlyContinue | Select-Object -First 1",
    "for ($i = 0; $i -lt 16 -and $command -is [System.Management.Automation.AliasInfo]; $i++) {",
    "  $command = Get-Command -Name ([System.Management.Automation.WildcardPattern]::Escape($command.Definition)) -ErrorAction SilentlyContinue | Select-Object -First 1",
    "}",
    "if ($null -ne $command -and $command -isnot [System.Management.Automation.AliasInfo]) {",
    "  $parameters = @($command.Parameters.Values | ForEach-Object { @{ name = $_.Name; aliases = @($_.Aliases) } })",
    "  @{ native = ($command.CommandType -eq 'Application'); parameters = $parameters } | ConvertTo-Json -Depth 4 -Compress",
    "}",
].join("\n");

type PowerShellCommandMetadata = {
    native: boolean;
    parameters: { name: string; aliases: string[] }[];
};

function parseCommandMetadata(stdout: string): PowerShellCommandMetadata | null {
    try {
        const value = JSON.parse(stdout);
        if (typeof value.native !== "boolean" || !Array.isArray(value.parameters)) {
            return null;
        }
        return {
            native: value.native,
            parameters: value.parameters
                .filter((parameter) => typeof parameter.name === "string")
                .map((parameter) => ({
                    name: parameter.name,
                    aliases: Array.isArray(parameter.aliases)
                        ? parameter.aliases.filter((alias) => typeof alias === "string")
                        : [],
                })),
        };
    } catch {
        return null;
    }
}

export function getPowerShellCommandMetadata(
    runGenerator: RunCompletionGenerator,
    ctx: CompletionContext
): Promise<PowerShellCommandMetadata | null> {
    const command = ctx.tokens[0]?.text;
    if (!command || ctx.shellType !== "pwsh") {
        return Promise.resolve(null);
    }
    const now = Date.now();
    const key = JSON.stringify([ctx.connId, ctx.shellName, ctx.cwd, command]);
    const existing = CommandCache.get(key);
    if (existing && now - existing.ts < CacheTtlMs) {
        return existing.result;
    }
    for (const [cachedKey, entry] of CommandCache) {
        if (now - entry.ts >= CacheTtlMs) CommandCache.delete(cachedKey);
    }
    while (CommandCache.size >= MaxCacheEntries) {
        CommandCache.delete(CommandCache.keys().next().value);
    }
    const result = runGenerator({
        command: ctx.shellName === "powershell" ? "powershell" : "pwsh",
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", CommandMetadataScript],
        cwd: ctx.cwd,
        connId: ctx.connId,
        env: { GENIETERM_COMPLETION_COMMAND: command },
    })
        .then((response) => (response?.supported ? parseCommandMetadata(response.stdout) : null))
        .catch(() => null);
    CommandCache.set(key, { ts: now, result });
    return result;
}

export function makePowerShellParameterCompletionProvider(runGenerator: RunCompletionGenerator): CompletionProvider {
    return {
        id: "powershell-parameters",
        priority: 9,
        shellTypes: ["pwsh"],
        provideCompletions: async (ctx) => {
            if (ctx.shellType !== "pwsh" || ctx.tokenIndex <= 0 || !ctx.searchTerm.startsWith("-")) {
                return [];
            }
            const metadata = await getPowerShellCommandMetadata(runGenerator, ctx);
            if (!metadata || metadata.native) {
                return [];
            }
            const used = new Set(
                ctx.tokens.slice(1, ctx.tokenIndex).map((token) => token.text.split(":")[0].toLowerCase())
            );
            const prefix = ctx.searchTerm.toLowerCase();
            return metadata.parameters.flatMap((parameter) => {
                const names = [parameter.name, ...parameter.aliases].map((name) => "-" + name);
                if (
                    names.some((name) => used.has(name.toLowerCase())) ||
                    !names.some((name) => name.toLowerCase().startsWith(prefix))
                ) {
                    return [];
                }
                return [
                    {
                        label: names[0],
                        insertText: names[0],
                        filterText: names.join(" "),
                        kind: "flag" as const,
                        score: 300,
                    },
                ];
            });
        },
    };
}
