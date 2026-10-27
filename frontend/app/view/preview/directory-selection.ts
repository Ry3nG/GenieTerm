// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type DirectorySelection = { files: FileInfo[]; anchor: string };
export type SelectionModifiers = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

export function selectDirectoryEntry(
    selection: DirectorySelection,
    entry: FileInfo,
    visible: FileInfo[],
    modifiers: SelectionModifiers
): DirectorySelection {
    if (!entry || entry.name === "..") return { files: [], anchor: null };
    const additive = modifiers.ctrlKey || modifiers.metaKey;
    if (modifiers.shiftKey && selection.anchor) {
        const start = visible.findIndex((file) => file.path === selection.anchor);
        const end = visible.findIndex((file) => file.path === entry.path);
        if (start >= 0 && end >= 0) {
            const range = visible
                .slice(Math.min(start, end), Math.max(start, end) + 1)
                .filter((file) => file.name !== "..");
            const files = new Map((additive ? selection.files : []).map((file) => [file.path, file]));
            range.forEach((file) => files.set(file.path, file));
            return { files: [...files.values()], anchor: selection.anchor };
        }
    }
    if (!additive) return { files: [entry], anchor: entry.path };
    const files = new Map(selection.files.map((file) => [file.path, file]));
    if (files.has(entry.path)) files.delete(entry.path);
    else files.set(entry.path, entry);
    return { files: [...files.values()], anchor: entry.path };
}

export function getTransferSelection(files: FileInfo[]): FileInfo[] {
    const unique = [...new Map(files.filter((file) => file.name !== "..").map((file) => [file.path, file])).values()];
    const folders = new Set(unique.filter((file) => file.isdir).map((file) => file.path.replace(/\/+$/, "")));
    return unique.filter((file) => {
        let parent = file.path.replace(/\/+$/, "");
        while (parent.lastIndexOf("/") > 0) {
            parent = parent.slice(0, parent.lastIndexOf("/"));
            if (folders.has(parent)) return false;
        }
        return true;
    });
}
