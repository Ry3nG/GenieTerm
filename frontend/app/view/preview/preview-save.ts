// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type SaveBaseline = {
    exists: boolean;
    modtime: number;
    size: number;
};

export type SaveConflictActions = {
    overwrite: () => void;
    reload: () => void;
};

export function makeSaveBaseline(info: FileInfo): SaveBaseline {
    if (info == null) {
        return null;
    }
    return {
        exists: !info.notfound,
        modtime: info.modtime ?? 0,
        size: info.size ?? 0,
    };
}

// Without a baseline (file info never loaded) we can't tell, so the save proceeds as before.
export function hasRemoteFileChanged(baseline: SaveBaseline, current: FileInfo): boolean {
    if (baseline == null || current == null) {
        return false;
    }
    const now = makeSaveBaseline(current);
    if (baseline.exists !== now.exists) {
        return true;
    }
    if (!baseline.exists) {
        return false;
    }
    return baseline.modtime !== now.modtime || baseline.size !== now.size;
}

export function makeSaveConflictMessage(path: string, current: FileInfo, actions: SaveConflictActions): ErrorMsg {
    const change = current?.notfound ? "was deleted" : "was changed";
    return {
        status: "File Changed Since Opened",
        text: `${path} ${change} on disk after you opened it. Overwrite it with your version, reload it (discarding your unsaved edits), or cancel.`,
        level: "warning",
        buttons: [
            { text: "Overwrite", onClick: actions.overwrite },
            { text: "Reload", onClick: actions.reload },
            { text: "Cancel", onClick: () => {} },
        ],
    };
}
