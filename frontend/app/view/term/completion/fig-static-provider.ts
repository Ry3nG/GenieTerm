// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import FigCommandNames from "@withfig/autocomplete";
import type { CompletionContext, CompletionItem, CompletionProvider } from "./types";

const FigBaseScore = 700;
const FigSpecModules = import.meta.glob([
    "/node_modules/@withfig/autocomplete/build/brew.js",
    "/node_modules/@withfig/autocomplete/build/cargo.js",
    "/node_modules/@withfig/autocomplete/build/curl.js",
    "/node_modules/@withfig/autocomplete/build/df.js",
    "/node_modules/@withfig/autocomplete/build/docker-compose.js",
    "/node_modules/@withfig/autocomplete/build/docker.js",
    "/node_modules/@withfig/autocomplete/build/find.js",
    "/node_modules/@withfig/autocomplete/build/gh.js",
    "/node_modules/@withfig/autocomplete/build/git.js",
    "/node_modules/@withfig/autocomplete/build/go.js",
    "/node_modules/@withfig/autocomplete/build/grep.js",
    "/node_modules/@withfig/autocomplete/build/kubectl.js",
    "/node_modules/@withfig/autocomplete/build/ls.js",
    "/node_modules/@withfig/autocomplete/build/node.js",
    "/node_modules/@withfig/autocomplete/build/npm.js",
    "/node_modules/@withfig/autocomplete/build/pnpm.js",
    "/node_modules/@withfig/autocomplete/build/python.js",
    "/node_modules/@withfig/autocomplete/build/rg.js",
    "/node_modules/@withfig/autocomplete/build/ssh.js",
    "/node_modules/@withfig/autocomplete/build/wrangler.js",
    "/node_modules/@withfig/autocomplete/build/yarn.js",
]);

type FigName = string | string[];

type FigNamedItem = {
    name: FigName;
    description?: string;
    insertValue?: string;
    hidden?: boolean;
    isDangerous?: boolean;
    subcommands?: FigNamedItem[];
    options?: FigNamedItem[];
    args?: FigArg | FigArg[];
};

type FigSpec = FigNamedItem & {
    additionalSuggestions?: FigNamedItem[];
};

type FigGeneratorScript = string | string[] | ((tokens: string[]) => string | string[]);

type FigGenerator = {
    script?: FigGeneratorScript;
    postProcess?: (out: string, tokens: string[]) => Array<FigNamedItem | string>;
    splitOn?: string;
};

type FigArg = {
    name?: FigName;
    suggestions?: Array<FigNamedItem | string> | FigNamedItem | string;
    template?: FigName;
    generators?: FigGenerator | FigGenerator[];
};

// Runs a generator command (e.g. `git branch`) where the shell lives and returns stdout.
// supported=false means the connection can't run generators (remote WSL / disconnected) -
// the provider then falls back to static suggestions only.
export type RunCompletionGenerator = (req: {
    command: string;
    args: string[];
    cwd: string;
    connId: string;
}) => Promise<{ stdout: string; supported: boolean } | null>;

type FigProviderOptions = {
    commandNames?: string[];
    loadSpec?: (command: string) => Promise<FigSpec>;
    runGenerator?: RunCompletionGenerator;
};

const FigSpecCache = new Map<string, Promise<FigSpec>>();

function namesOf(name: FigName): string[] {
    return Array.isArray(name) ? name : [name];
}

function matchesName(item: FigNamedItem, value: string): boolean {
    return namesOf(item.name).some((name) => name === value);
}

function startsWithIgnoreCase(value: string, prefix: string): boolean {
    return value.toLowerCase().startsWith(prefix.toLowerCase());
}

function defaultLoadFigSpec(command: string): Promise<FigSpec> {
    const modulePath = `/node_modules/@withfig/autocomplete/build/${command}.js`;
    const loader = FigSpecModules[modulePath] as (() => Promise<{ default: FigSpec }>) | undefined;
    if (loader == null) {
        return Promise.resolve(null);
    }
    let cached = FigSpecCache.get(command);
    if (cached == null) {
        cached = loader().then((mod) => mod.default);
        FigSpecCache.set(command, cached);
    }
    return cached;
}

function findSubcommand(spec: FigNamedItem, tokenText: string): FigNamedItem {
    return spec.subcommands?.find((subcommand) => matchesName(subcommand, tokenText));
}

function activeFigNode(root: FigSpec, tokens: CompletionItemContextToken[], tokenIndex: number): FigNamedItem {
    let node: FigNamedItem = root;
    for (let idx = 1; idx < tokenIndex; idx++) {
        const tokenText = tokens[idx]?.text;
        if (!tokenText || tokenText.startsWith("-")) {
            continue;
        }
        const subcommand = findSubcommand(node, tokenText);
        if (subcommand == null) {
            continue;
        }
        node = subcommand;
    }
    return node;
}

type CompletionItemContextToken = {
    text: string;
};

function argsOf(item: FigNamedItem): FigArg[] {
    if (item.args == null) {
        return [];
    }
    return Array.isArray(item.args) ? item.args : [item.args];
}

function suggestionsOf(arg: FigArg): Array<FigNamedItem | string> {
    if (arg.suggestions == null) {
        return [];
    }
    return Array.isArray(arg.suggestions) ? arg.suggestions : [arg.suggestions];
}

function optionArgsForToken(node: FigNamedItem, tokenText: string): FigArg[] {
    const option = node.options?.find((item) => matchesName(item, tokenText));
    return option == null ? [] : argsOf(option);
}

function figItems(
    items: FigNamedItem[] = [],
    kind: CompletionItem["kind"],
    searchTerm: string,
    baseScore = FigBaseScore
): CompletionItem[] {
    const completions: CompletionItem[] = [];
    for (const item of items) {
        if (item.hidden) {
            continue;
        }
        for (const name of namesOf(item.name)) {
            if (!startsWithIgnoreCase(name, searchTerm)) {
                continue;
            }
            completions.push({
                label: name,
                insertText: item.insertValue || name,
                kind,
                detail: item.description,
                isDangerous: item.isDangerous,
                score: baseScore - completions.length,
            });
        }
    }
    return completions;
}

function figArgItems(args: FigArg[], searchTerm: string): CompletionItem[] {
    const completions: CompletionItem[] = [];
    for (const arg of args) {
        for (const suggestion of suggestionsOf(arg)) {
            const item: FigNamedItem =
                typeof suggestion === "string"
                    ? { name: suggestion, description: namesOf(arg.name ?? "")[0] }
                    : suggestion;
            if (item.hidden) {
                continue;
            }
            for (const name of namesOf(item.name)) {
                if (!startsWithIgnoreCase(name, searchTerm)) {
                    continue;
                }
                completions.push({
                    label: name,
                    insertText: item.insertValue || name,
                    kind: "argument",
                    detail: item.description,
                    isDangerous: item.isDangerous,
                    score: FigBaseScore - completions.length,
                });
            }
        }
    }
    return completions;
}

const FigGenCacheTtlMs = 15000;
const FigGenCache = new Map<string, { ts: number; items: Promise<CompletionItem[]> }>();

function generatorsOf(arg: FigArg): FigGenerator[] {
    if (arg.generators == null) {
        return [];
    }
    return Array.isArray(arg.generators) ? arg.generators : [arg.generators];
}

function resolveGeneratorScript(script: FigGeneratorScript, tokens: string[]): string[] {
    const resolved = typeof script === "function" ? script(tokens) : script;
    if (typeof resolved === "string") {
        return resolved.trim().split(/\s+/).filter(Boolean);
    }
    return Array.isArray(resolved) ? resolved.filter((part) => part != null) : [];
}

function generatorSuggestionToItem(suggestion: FigNamedItem | string): CompletionItem {
    const item: FigNamedItem = typeof suggestion === "string" ? { name: suggestion } : suggestion;
    if (item.hidden) {
        return null;
    }
    const name = namesOf(item.name)[0];
    if (!name) {
        return null;
    }
    return {
        label: name,
        insertText: item.insertValue || name,
        kind: "argument",
        detail: item.description,
        isDangerous: item.isDangerous,
        score: FigBaseScore - 100,
    };
}

function parseGeneratorOutput(stdout: string, generator: FigGenerator, tokens: string[]): CompletionItem[] {
    let suggestions: Array<FigNamedItem | string> = [];
    if (generator.postProcess != null) {
        try {
            suggestions = generator.postProcess(stdout, tokens) ?? [];
        } catch (e) {
            suggestions = [];
        }
    } else {
        const pieces = generator.splitOn != null ? stdout.split(generator.splitOn) : stdout.split("\n");
        suggestions = pieces.map((piece) => piece.trim()).filter(Boolean);
    }
    return suggestions.map(generatorSuggestionToItem).filter((item) => item != null);
}

async function figGeneratorItems(
    args: FigArg[],
    ctx: CompletionContext,
    runGenerator?: RunCompletionGenerator
): Promise<CompletionItem[]> {
    if (runGenerator == null) {
        return [];
    }
    const generators = args.flatMap(generatorsOf);
    if (generators.length === 0) {
        return [];
    }
    const tokens = ctx.tokens.map((token) => token.text);
    const collected: CompletionItem[] = [];
    for (const generator of generators) {
        if (generator.script == null) {
            continue;
        }
        const parts = resolveGeneratorScript(generator.script, tokens);
        if (parts.length === 0) {
            continue;
        }
        const [command, ...scriptArgs] = parts;
        // cache raw output per (conn, cwd, script) so generators don't re-run every keystroke;
        // the searchTerm filter below runs against the cached items.
        const cacheKey = `${ctx.connId} ${ctx.cwd} ${parts.join(" ")}`;
        let entry = FigGenCache.get(cacheKey);
        if (entry == null || Date.now() - entry.ts > FigGenCacheTtlMs) {
            const itemsPromise = runGenerator({ command, args: scriptArgs, cwd: ctx.cwd, connId: ctx.connId })
                .then((result) => {
                    if (result == null || !result.supported) {
                        return [];
                    }
                    return parseGeneratorOutput(result.stdout, generator, tokens);
                })
                .catch(() => []);
            entry = { ts: Date.now(), items: itemsPromise };
            FigGenCache.set(cacheKey, entry);
        }
        collected.push(...(await entry.items));
    }
    return collected.filter((item) => startsWithIgnoreCase(item.label, ctx.searchTerm));
}

function mergeFigItems(...lists: CompletionItem[][]): CompletionItem[] {
    const seen = new Set<string>();
    const merged: CompletionItem[] = [];
    for (const list of lists) {
        for (const item of list) {
            if (seen.has(item.insertText)) {
                continue;
            }
            seen.add(item.insertText);
            merged.push(item);
        }
    }
    return merged;
}

export function makeFigStaticCompletionProvider(options: FigProviderOptions = {}): CompletionProvider {
    const commandNames = options.commandNames ?? FigCommandNames;
    const loadSpec = options.loadSpec ?? defaultLoadFigSpec;
    const runGenerator = options.runGenerator;
    return {
        id: "fig",
        priority: 8,
        provideCompletions: async (ctx) => {
            if (ctx.tokenIndex <= 0) {
                return commandNames
                    .filter((command) => !command.includes("/") && startsWithIgnoreCase(command, ctx.searchTerm))
                    .map((command, idx) => ({
                        label: command,
                        insertText: command,
                        kind: "command" as const,
                        detail: "Fig spec",
                        score: FigBaseScore - idx,
                    }));
            }
            const command = ctx.tokens[0]?.text;
            if (!command) {
                return [];
            }
            const spec = await loadSpec(command);
            if (spec == null) {
                return [];
            }
            const activeNode = activeFigNode(spec, ctx.tokens, ctx.tokenIndex);
            const prevTokenText = ctx.tokens[ctx.tokenIndex - 1]?.text;
            if (prevTokenText?.startsWith("-")) {
                const optionArgs = optionArgsForToken(activeNode, prevTokenText);
                const optionArgItems = mergeFigItems(
                    figArgItems(optionArgs, ctx.searchTerm),
                    await figGeneratorItems(optionArgs, ctx, runGenerator)
                );
                if (optionArgItems.length > 0) {
                    return optionArgItems;
                }
            }
            if (ctx.tokenType === "option" || ctx.searchTerm.startsWith("-")) {
                return figItems(activeNode.options, "flag", ctx.searchTerm);
            }
            const subcommandItems = figItems(activeNode.subcommands, "subcommand", ctx.searchTerm);
            if (subcommandItems.length > 0) {
                return subcommandItems;
            }
            // positional argument (e.g. `git checkout <branch>`): static arg suggestions +
            // dynamic generators (live branches/containers/etc.) for the active subcommand.
            const nodeArgs = argsOf(activeNode);
            const argItems = mergeFigItems(
                figArgItems(nodeArgs, ctx.searchTerm),
                await figGeneratorItems(nodeArgs, ctx, runGenerator)
            );
            if (argItems.length > 0) {
                return argItems;
            }
            return figItems(spec.additionalSuggestions, "argument", ctx.searchTerm, FigBaseScore - 200);
        },
    };
}
