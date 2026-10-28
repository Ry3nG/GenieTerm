// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

export const CommandHistoryLimit = 500;
export const CommandTextLimit = 4096;

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

export type CommandLibrary = {
    version: 2;
    revision: number;
    history: CommandHistoryEntry[];
};

export type CommandLibraryChange =
    | { type: "record"; entry: CommandHistoryEntry; update?: boolean }
    | { type: "deletehistory"; id: string }
    | { type: "clearhistory" };

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
    return { version: 2, revision: 0, history: [] };
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

export function recoverCommandLibrary(raw: unknown): CommandLibrary {
    const empty = emptyCommandLibrary();
    if (raw == null || typeof raw !== "object" || ![1, 2].includes((raw as CommandLibrary).version)) {
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
    return {
        ...empty,
        history: [...history.values()].sort((a, b) => b.startts - a.startts).slice(0, CommandHistoryLimit),
    };
}

export function applyCommandLibraryChange(library: CommandLibrary, change: CommandLibraryChange): CommandLibrary {
    let history = library.history;
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
        default:
            throw new Error("Unknown command library action.");
    }
    return { ...library, revision: library.revision + 1, history };
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
