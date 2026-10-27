// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { quotePosixShellArg } from "./transferutil";

export const CommandHistoryLimit = 500;
export const CommandRecipeLimit = 100;
export const CommandTextLimit = 4096;
export const RecipeArgumentLimit = 12;

export type CommandHistoryStatus = "running" | "success" | "failed" | "unknown";
export type CommandHistoryEntry = {
    id: string;
    blockid: string;
    tabid: string;
    commandblockid: number;
    command: string;
    connection: string;
    cwd: string;
    shell: string;
    startts: number;
    donets: number;
    exitcode: number;
    status: CommandHistoryStatus;
};

export type CommandRecipeArgument = {
    name: string;
    kind: "text" | "choice";
    value: string;
    choices: string[];
};

export type CommandRecipe = {
    id: string;
    name: string;
    template: string;
    connection: string;
    cwd: string;
    shell: string;
    arguments: CommandRecipeArgument[];
    updatedts: number;
};

export type CommandLibrary = {
    version: 1;
    revision: number;
    history: CommandHistoryEntry[];
    recipes: CommandRecipe[];
};

export type CommandLibraryChange =
    | { type: "record"; entry: CommandHistoryEntry; update?: boolean }
    | { type: "deletehistory"; id: string }
    | { type: "clearhistory" }
    | { type: "saverecipe"; recipe: CommandRecipe }
    | { type: "deleterecipe"; id: string };

export type CommandLibraryContext = { blockid: string; tabid: string; connection: string; cwd: string; shell: string };

const HistoryStatuses = new Set(["running", "success", "failed", "unknown"]);
function hasCommandControls(value: string): boolean {
    return [...value].some((char) => {
        const code = char.codePointAt(0);
        return (
            (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
            code === 127 ||
            (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2066 && code <= 0x2069)
        );
    });
}

export function emptyCommandLibrary(): CommandLibrary {
    return { version: 1, revision: 0, history: [], recipes: [] };
}

export function commandConnectionLabel(connection: string): string {
    return !connection || connection === "local" ? "This computer" : connection;
}

export function normalizeCommandConnection(connection: string): string {
    return connection === "local" ? "" : connection;
}

function boundedText(value: unknown, max: number, allowEmpty = true): value is string {
    return typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
}

export function normalizeHistoryEntry(raw: unknown): CommandHistoryEntry | null {
    if (raw == null || typeof raw !== "object") {
        return null;
    }
    const entry = raw as CommandHistoryEntry;
    if (
        !boundedText(entry.id, 240, false) ||
        !boundedText(entry.blockid, 100, false) ||
        !boundedText(entry.tabid, 100) ||
        !boundedText(entry.command, CommandTextLimit, false) ||
        hasCommandControls(entry.command) ||
        !boundedText(entry.connection, 512) ||
        !boundedText(entry.cwd, 2048) ||
        !boundedText(entry.shell, 32) ||
        !Number.isSafeInteger(entry.commandblockid) ||
        entry.commandblockid < 1 ||
        !Number.isSafeInteger(entry.startts) ||
        entry.startts <= 0 ||
        entry.startts > 8640000000000000 ||
        (entry.donets != null && !Number.isFinite(entry.donets)) ||
        (entry.exitcode != null && !Number.isInteger(entry.exitcode)) ||
        !HistoryStatuses.has(entry.status)
    ) {
        return null;
    }
    return {
        id: entry.id,
        blockid: entry.blockid,
        tabid: entry.tabid,
        commandblockid: entry.commandblockid,
        command: entry.command,
        connection: normalizeCommandConnection(entry.connection),
        cwd: entry.cwd,
        shell: entry.shell,
        startts: entry.startts,
        donets: entry.donets ?? null,
        exitcode: entry.exitcode ?? null,
        status: entry.status,
    };
}

export function recipeParameterNames(
    template: string,
    shell = "bash"
): {
    names: string[];
    error?: string;
    positions?: { start: number; end: number; name: string }[];
} {
    const names: string[] = [];
    const positions: { start: number; end: number; name: string }[] = [];
    let quote = "";
    let hasShellSyntax = false;
    for (let i = 0; i < template.length; i++) {
        const ch = template[i];
        if (shell === "pwsh" ? ch === "`" && quote !== "'" : ch === "\\" && quote !== "'") {
            const literalParameter = template.slice(i + 1).match(/^\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/);
            i += literalParameter?.[0].length ?? 1;
            continue;
        }
        if (template.startsWith("{{", i)) {
            const match = template.slice(i).match(/^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/);
            if (match == null) {
                continue;
            }
            if (
                quote ||
                (i > 0 && !/\s/.test(template[i - 1])) ||
                (i + match[0].length < template.length && !/\s/.test(template[i + match[0].length]))
            ) {
                return { names, error: "Use {{name}} as a whole argument, separated by spaces and without quotes." };
            }
            if (!names.includes(match[1])) {
                names.push(match[1]);
            }
            positions.push({ start: i, end: i + match[0].length, name: match[1] });
            i += match[0].length - 1;
            continue;
        }
        // Quotes protect argument data, but not heredoc bodies, comments, or shell expressions.
        // Keep parameterized recipes to simple commands instead of partially parsing shell grammar.
        if (
            !quote &&
            ("\r\n;|&<>(){}[]".includes(ch) ||
                (ch === "#" && (shell === "pwsh" || i === 0 || /\s/.test(template[i - 1]))) ||
                (shell === "pwsh" && ch === "@" && /['"]/.test(template[i + 1] ?? "")))
        ) {
            hasShellSyntax = true;
        }
        if (ch === quote) {
            if (shell === "pwsh" && template[i + 1] === quote) {
                i++;
            } else {
                quote = "";
            }
        } else if (!quote && (ch === "'" || ch === '"' || (ch === "`" && shell !== "pwsh"))) {
            quote = ch;
        }
    }
    if (names.length > RecipeArgumentLimit) {
        return { names, error: `Use at most ${RecipeArgumentLimit} arguments.` };
    }
    if (names.length && (hasShellSyntax || quote)) {
        return {
            names,
            error: "Use parameters in one simple command. Scripts, comments and shell operators are not supported.",
        };
    }
    return { names, positions };
}

export function normalizeCommandRecipe(raw: unknown): CommandRecipe | null {
    if (raw == null || typeof raw !== "object") {
        return null;
    }
    const recipe = raw as CommandRecipe;
    if (
        !boundedText(recipe.id, 100, false) ||
        !boundedText(recipe.name, 100, false) ||
        !boundedText(recipe.template, CommandTextLimit, false) ||
        hasCommandControls(recipe.template) ||
        !boundedText(recipe.connection, 512) ||
        !boundedText(recipe.cwd, 2048) ||
        !boundedText(recipe.shell, 32) ||
        !Number.isFinite(recipe.updatedts) ||
        !Array.isArray(recipe.arguments) ||
        recipe.arguments.length > RecipeArgumentLimit ||
        JSON.stringify(recipe.arguments).length > 16384
    ) {
        return null;
    }
    const params = recipeParameterNames(recipe.template, recipe.shell);
    if (params.error || params.names.length !== recipe.arguments.length) {
        return null;
    }
    const args: CommandRecipeArgument[] = [];
    for (const name of params.names) {
        const arg = recipe.arguments.find((candidate) => candidate?.name === name);
        if (
            arg == null ||
            !["text", "choice"].includes(arg.kind) ||
            !boundedText(arg.value, 1024) ||
            hasCommandControls(arg.value) ||
            !Array.isArray(arg.choices) ||
            arg.choices.length > 20 ||
            arg.choices.some((value) => !boundedText(value, 1024, false) || hasCommandControls(value)) ||
            (arg.kind === "choice" && (!arg.choices.length || !arg.choices.includes(arg.value)))
        ) {
            return null;
        }
        args.push({
            name,
            kind: arg.kind,
            value: arg.value,
            choices: arg.kind === "choice" ? [...new Set(arg.choices)] : [],
        });
    }
    return {
        id: recipe.id,
        name: recipe.name.trim(),
        template: recipe.template,
        connection: normalizeCommandConnection(recipe.connection),
        cwd: recipe.cwd,
        shell: recipe.shell,
        arguments: args,
        updatedts: recipe.updatedts,
    };
}

export function recoverCommandLibrary(raw: unknown): CommandLibrary {
    const empty = emptyCommandLibrary();
    if (raw == null || typeof raw !== "object" || (raw as CommandLibrary).version !== 1) {
        return empty;
    }
    const data = raw as CommandLibrary;
    const history = new Map<string, CommandHistoryEntry>();
    for (const candidate of Array.isArray(data.history) ? data.history : []) {
        const entry = normalizeHistoryEntry(candidate);
        if (entry) {
            history.set(entry.id, { ...entry, status: entry.status === "running" ? "unknown" : entry.status });
        }
    }
    const recipes = new Map<string, CommandRecipe>();
    for (const candidate of Array.isArray(data.recipes) ? data.recipes : []) {
        const recipe = normalizeCommandRecipe(candidate);
        if (recipe) {
            recipes.set(recipe.id, recipe);
        }
    }
    return {
        ...empty,
        history: [...history.values()].sort((a, b) => b.startts - a.startts).slice(0, CommandHistoryLimit),
        recipes: [...recipes.values()].sort((a, b) => b.updatedts - a.updatedts).slice(0, CommandRecipeLimit),
    };
}

export function applyCommandLibraryChange(library: CommandLibrary, change: CommandLibraryChange): CommandLibrary {
    let history = library.history;
    let recipes = library.recipes;
    switch (change?.type) {
        case "record": {
            const entry = normalizeHistoryEntry(change.entry);
            if (!entry) {
                throw new Error("This command cannot be saved to history.");
            }
            const existing = history.find((item) => item.id === entry.id);
            // A completion must not resurrect a command deleted or cleared while it was running.
            if ((change.update && !existing) || (existing && JSON.stringify(existing) === JSON.stringify(entry))) {
                return library;
            }
            const savedEntry = change.update
                ? { ...existing, status: entry.status, donets: entry.donets, exitcode: entry.exitcode }
                : entry;
            history = [savedEntry, ...history.filter((item) => item.id !== entry.id)]
                .sort((a, b) => b.startts - a.startts)
                .slice(0, CommandHistoryLimit);
            break;
        }
        case "deletehistory":
            history = history.filter((item) => item.id !== change.id);
            break;
        case "clearhistory":
            history = [];
            break;
        case "saverecipe": {
            const recipe = normalizeCommandRecipe(change.recipe);
            if (!recipe) {
                throw new Error("Check the recipe name, command and arguments before saving.");
            }
            if (recipes.length >= CommandRecipeLimit && !recipes.some((item) => item.id === recipe.id)) {
                throw new Error(`You can save up to ${CommandRecipeLimit} recipes. Delete one to make room.`);
            }
            recipes = [recipe, ...recipes.filter((item) => item.id !== recipe.id)];
            break;
        }
        case "deleterecipe":
            recipes = recipes.filter((item) => item.id !== change.id);
            break;
        default:
            throw new Error("Unknown command library action.");
    }
    return { ...library, revision: library.revision + 1, history, recipes };
}

export function filterCommandHistory(
    history: CommandHistoryEntry[],
    filter: {
        query?: string;
        connection?: string;
        cwd?: string;
        status?: string;
    }
): CommandHistoryEntry[] {
    const words = (filter.query ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const cwd = (filter.cwd ?? "").toLocaleLowerCase();
    return history.filter((entry) => {
        if (filter.connection != null && entry.connection !== normalizeCommandConnection(filter.connection)) {
            return false;
        }
        if (filter.status && entry.status !== filter.status) {
            return false;
        }
        if (cwd && !entry.cwd.toLocaleLowerCase().includes(cwd)) {
            return false;
        }
        const text = `${entry.command}\n${entry.cwd}\n${commandConnectionLabel(entry.connection)}`.toLocaleLowerCase();
        return words.every((word) => text.includes(word));
    });
}

export function resolveCommandRecipe(
    recipe: CommandRecipe,
    values: Record<string, string>,
    shell: string
): {
    command: string;
    error?: string;
} {
    const params = recipeParameterNames(recipe.template, recipe.shell);
    if (params.error) {
        return { command: recipe.template, error: params.error };
    }
    if (recipe.shell && recipe.shell !== "unknown" && shell !== recipe.shell) {
        return { command: recipe.template, error: `Open a ${recipe.shell} terminal to use this recipe.` };
    }
    if (params.names.length && !["bash", "zsh", "fish", "pwsh"].includes(shell)) {
        return { command: recipe.template, error: "The terminal's shell must be known to quote recipe arguments." };
    }
    let error: string;
    let command = recipe.template;
    for (const parameter of [...(params.positions ?? [])].reverse()) {
        const name = parameter.name;
        const arg = recipe.arguments.find((candidate) => candidate.name === name);
        const value = values[name] ?? arg?.value ?? "";
        if (
            !arg ||
            !boundedText(value, 1024) ||
            hasCommandControls(value) ||
            (arg.kind === "choice" && !arg.choices.includes(value))
        ) {
            error = `Choose a valid value for ${name}.`;
            continue;
        }
        let quoted: string;
        if (shell === "pwsh") {
            quoted = `'${value.replace(/'/g, "''")}'`;
        } else if (shell === "fish") {
            quoted = `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
        } else {
            quoted = quotePosixShellArg(value);
        }
        command = command.slice(0, parameter.start) + quoted + command.slice(parameter.end);
    }
    if (command.length > CommandTextLimit) {
        error = "The resolved command is too long.";
    }
    return { command, error };
}
