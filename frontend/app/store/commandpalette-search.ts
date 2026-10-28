// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommandPaletteCommand } from "./commandpalette";
import { formatBindingTokens } from "./keybindings";

export const PaletteGroups = ["Terminal", "Tabs", "Blocks & Layout", "Connections", "View", "App", "Other"] as const;
export type PaletteGroup = (typeof PaletteGroups)[number];

const PrefixGroups: Record<string, PaletteGroup> = {
    term: "Terminal",
    tab: "Tabs",
    block: "Blocks & Layout",
    conn: "Connections",
    view: "View",
    app: "App",
    config: "App",
};
const ActionGroups: Record<string, PaletteGroup> = {
    "block:search": "Terminal",
    "app:refocus": "Terminal",
    "tab:reload": "App",
    "config:edit-connections": "Connections",
};
const GroupIcons: Record<PaletteGroup, string> = {
    Terminal: "terminal",
    Tabs: "folder",
    "Blocks & Layout": "table-cells-large",
    Connections: "server",
    View: "window-maximize",
    App: "gear",
    Other: "bolt",
};
const ActionIcons: Record<string, string> = {
    "term:copy-last-command": "copy",
    "term:copy-last-output": "clipboard",
    "term:jump-prev-block": "arrow-up",
    "term:jump-next-block": "arrow-down",
    "term:jump-past-output": "arrow-right-to-bracket",
    "term:command-composer": "wand-magic-sparkles",
    "term:multi-input": "keyboard",
    "term:clear": "broom",
    "block:search": "magnifying-glass",
    "block:split-right": "columns",
    "block:split-down": "table-rows",
    "block:magnify": "expand",
    "block:close": "xmark",
    "block:new": "plus",
    "block:new-files": "folder-open",
    "block:new-host": "server",
    "block:new-host-processes": "list-tree",
    "block:new-host-ports": "arrow-right-arrow-left",
    "tab:new": "plus",
    "tab:close": "xmark",
    "tab:next": "arrow-right",
    "tab:prev": "arrow-left",
    "tab:rename": "pen",
    "tab:reload": "rotate-right",
    "conn:switch": "arrow-right-arrow-left",
    "view:toggle-sidebar": "sidebar",
    "view:toggle-tabbar": "window-maximize",
    "app:keybindings-editor": "keyboard",
    "app:about": "circle-info",
    "app:check-for-updates": "cloud-arrow-down",
};
const ActionKeywords: Record<string, string> = {
    "block:split-right": "split horizontal pane right",
    "block:split-down": "split vertical pane down",
    "block:search": "search find terminal output",
    "term:clear": "clear cls clean screen",
    "term:command-composer": "ai ask compose natural language command fix explain codex claude ollama",
    "app:settings": "preferences configuration",
    "tab:reload": "reload refresh",
    "block:new-files": "browse explorer finder sftp remote folder",
    "block:new-host": "system info sysinfo cpu memory gpu nvidia-smi monitor activity",
    "block:new-host-processes": "top htop ps kill process list",
    "block:new-host-ports": "port forward forwarding tunnel ssh -L localhost jupyter tensorboard listening",
};
const RecentLimit = 5;
const ActionOrder = new Map(
    [
        "term:copy-last-command",
        "term:copy-last-output",
        "term:jump-prev-block",
        "term:jump-next-block",
        "term:jump-past-output",
        "term:command-composer",
        "block:search",
        "term:clear",
        "tab:new",
        "tab:rename",
        "block:split-right",
        "block:split-down",
        "conn:switch",
        "view:toggle-sidebar",
        "view:toggle-tabbar",
        "app:settings",
        "tab:reload",
    ].map((id, idx) => [id, idx])
);

export type IndexedPaletteCommand = {
    command: CommandPaletteCommand;
    group: PaletteGroup;
    icon: string;
    label: string;
    metadata: string;
};
export type PaletteMatch = { item: IndexedPaletteCommand; score: number; positions: number[] };
export type PaletteSection = { title: string; matches: PaletteMatch[] };

export function getPaletteGroup(id: string): PaletteGroup {
    return ActionGroups[id] ?? PrefixGroups[id.split(":", 1)[0]] ?? "Other";
}

export function indexPaletteCommands(commands: CommandPaletteCommand[]): IndexedPaletteCommand[] {
    return commands
        .map((command) => {
            const group = getPaletteGroup(command.id);
            const synonyms = [ActionKeywords[command.id] ?? ""];
            if (group === "Connections") {
                synonyms.push("ssh remote host connect");
            }
            if (command.label.toLowerCase().includes("copy")) {
                synonyms.push("copy clipboard");
            }
            if (command.id.includes("close")) {
                synonyms.push("close dismiss remove");
            }
            return {
                command,
                group,
                icon: ActionIcons[command.id] ?? GroupIcons[group],
                label: command.label.toLowerCase(),
                metadata: [group, command.hint ?? "", command.keywords ?? "", ...synonyms].join(" ").toLowerCase(),
            };
        })
        .sort((a, b) => (ActionOrder.get(a.command.id) ?? 1000) - (ActionOrder.get(b.command.id) ?? 1000));
}

// a subsequence counts when it spells word initials ("clo" -> Copy Last command Output) or stays tight;
// anything looser lets short queries match nearly every label
const MaxSubsequenceSpanFactor = 3;

export function scorePaletteText(
    text: string,
    query: string,
    allowSubsequence = true
): { score: number; positions: number[] } {
    if (!query) {
        return { score: 0, positions: [] };
    }
    let offset = text.indexOf(query);
    const substringOffset = offset;
    while (offset >= 0) {
        if (offset === 0 || /[\s: /_-]/.test(text[offset - 1])) {
            return {
                score: offset === 0 ? 400 : 300,
                positions: Array.from({ length: query.length }, (_, idx) => offset + idx),
            };
        }
        offset = text.indexOf(query, offset + 1);
    }
    if (substringOffset >= 0) {
        return {
            score: 200,
            positions: Array.from({ length: query.length }, (_, idx) => substringOffset + idx),
        };
    }
    if (!allowSubsequence) {
        return null;
    }
    const isWordStart = (idx: number) => idx === 0 || /[\s: /_-]/.test(text[idx - 1]);
    const positions: number[] = [];
    let cursor = 0;
    for (const char of query) {
        let next = text.indexOf(char, cursor);
        if (next < 0) {
            return null;
        }
        let wordStart = next;
        while (wordStart >= 0 && !isWordStart(wordStart)) {
            wordStart = text.indexOf(char, wordStart + 1);
        }
        if (wordStart >= 0 && !(positions.length > 0 && next === positions[positions.length - 1] + 1)) {
            next = wordStart;
        }
        positions.push(next);
        cursor = next + 1;
    }
    const isInitialism = positions.every(
        (position, idx) => isWordStart(position) || (idx > 0 && position === positions[idx - 1] + 1)
    );
    const span = positions[positions.length - 1] - positions[0] + 1;
    if (!isInitialism && span > query.length * MaxSubsequenceSpanFactor) {
        return null;
    }
    return { score: 100, positions };
}

export function searchPaletteCommands(
    commands: IndexedPaletteCommand[],
    query: string,
    recents: string[]
): PaletteMatch[] {
    const normalized = query.trim().toLowerCase();
    const tokens = normalized.split(/\s+/);
    const recentRanks = new Map(recents.map((id, idx) => [id, Math.max(0, RecentLimit - idx) * 4]));
    const matches: PaletteMatch[] = [];
    for (const item of commands) {
        let score = 0;
        const positions = new Set<number>();
        let matched = true;
        for (const token of tokens) {
            const labelMatch = scorePaletteText(item.label, token);
            const metadataMatch = scorePaletteText(item.metadata, token, false);
            if (labelMatch == null && metadataMatch == null) {
                matched = false;
                break;
            }
            score += Math.max(labelMatch?.score ?? 0, (metadataMatch?.score ?? 0) - 30);
            labelMatch?.positions.forEach((position) => positions.add(position));
        }
        if (matched) {
            // A contiguous phrase should outrank the same words scattered through a label.
            const phrase = scorePaletteText(item.label, normalized);
            score = score / tokens.length + (phrase?.score === 400 ? 24 : 0);
            matches.push({
                item,
                score: score + (recentRanks.get(item.command.id) ?? 0),
                positions: [...positions].sort((a, b) => a - b),
            });
        }
    }
    return matches.sort((a, b) => b.score - a.score || a.item.command.label.localeCompare(b.item.command.label));
}

export function buildPaletteSections(
    commands: IndexedPaletteCommand[],
    query: string,
    recents: string[]
): PaletteSection[] {
    if (query.trim()) {
        return [{ title: "Results", matches: searchPaletteCommands(commands, query, recents) }];
    }
    const byId = new Map(commands.map((item) => [item.command.id, item]));
    const recentItems = normalizePaletteRecents(recents)
        .map((id) => byId.get(id))
        .filter(Boolean);
    const recentIds = new Set(recentItems.map((item) => item.command.id));
    const toMatch = (item: IndexedPaletteCommand): PaletteMatch => ({ item, score: 0, positions: [] });
    const sections: PaletteSection[] = [{ title: "Recent", matches: recentItems.map(toMatch) }];
    for (const group of PaletteGroups) {
        sections.push({
            title: group,
            matches: commands.filter((item) => item.group === group && !recentIds.has(item.command.id)).map(toMatch),
        });
    }
    return sections.filter((section) => section.matches.length > 0);
}

export function normalizePaletteRecents(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(
        0,
        RecentLimit
    );
}

export function rememberPaletteCommand(id: string, recents: string[]): string[] {
    return normalizePaletteRecents([id, ...recents]);
}

const PaletteModifierOrder = ["Ctrl", "Alt", "Shift", "Cmd"];
const PaletteModifierGlyphs: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘", Meta: "⌘" };
const PaletteKeyGlyphs: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Enter: "↩",
    Escape: "esc",
    Backspace: "⌫",
    Delete: "⌦",
    Tab: "⇥",
    Space: "Space",
};

// keycaps in the order macOS menus use (⌃⌥⇧⌘ then the key), with letters capitalized
export function formatPaletteBinding(binding: string, platform: NodeJS.Platform = "darwin"): string[] {
    if (!binding) {
        return [];
    }
    if (platform !== "darwin") {
        return formatBindingTokens(binding, platform);
    }
    const parts = binding.split(":").filter(Boolean);
    const modifiers = parts
        .filter((part) => PaletteModifierGlyphs[part] != null)
        .map((part) => (part === "Meta" ? "Cmd" : part))
        .sort((a, b) => PaletteModifierOrder.indexOf(a) - PaletteModifierOrder.indexOf(b))
        .map((part) => PaletteModifierGlyphs[part]);
    const keys = parts
        .filter((part) => PaletteModifierGlyphs[part] == null)
        .map((part) => PaletteKeyGlyphs[part] ?? (part.length === 1 ? part.toUpperCase() : part));
    return [...modifiers, ...keys];
}
