// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import {
    applyCommandLibraryChange,
    emptyCommandLibrary,
    recoverCommandLibrary,
    type CommandLibrary,
    type CommandLibraryChange,
} from "../frontend/util/commandlibrary";

const MaxSnapshotBytes = 32 * 1024 * 1024;

export function makeCommandLibraryStore(filePath: string, delayMs = 750) {
    let library = emptyCommandLibrary();
    let timer: ReturnType<typeof setTimeout>;
    let dirty = false;
    let readError = "";
    let writeError = "";
    const listeners = new Set<(library: CommandLibrary) => void>();
    try {
        if (fs.existsSync(filePath)) {
            if (fs.statSync(filePath).size > MaxSnapshotBytes) {
                throw new Error("The command library file is too large.");
            }
            const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (raw?.version !== 1) {
                throw new Error("Unsupported command library version.");
            }
            library = recoverCommandLibrary(raw);
        }
    } catch {
        readError = "Could not read the saved command library. Your existing file has been kept.";
    }

    const flush = () => {
        clearTimeout(timer);
        timer = null;
        if (!dirty) {
            return;
        }
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const temp = `${filePath}.${process.pid}.tmp`;
            fs.writeFileSync(temp, JSON.stringify(library), { mode: 0o600 });
            fs.renameSync(temp, filePath);
        } catch {
            writeError = "Could not save the command library on this computer.";
            throw new Error(writeError);
        }
        dirty = false;
        const recovered = !!writeError;
        writeError = "";
        if (recovered) {
            listeners.forEach((listener) => listener(library));
        }
    };
    const update = (change: CommandLibraryChange) => {
        if (readError) {
            throw new Error(readError);
        }
        const next = applyCommandLibraryChange(library, change);
        if (next === library) {
            return library;
        }
        library = next;
        dirty = true;
        if (!timer) {
            timer = setTimeout(() => {
                try {
                    flush();
                } catch {
                    listeners.forEach((listener) => listener(library));
                }
            }, delayMs);
        }
        listeners.forEach((listener) => listener(library));
        return library;
    };
    return {
        get: () => {
            if (readError) {
                throw new Error(readError);
            }
            if (writeError) {
                flush();
            }
            return library;
        },
        update,
        flush,
        subscribe: (listener: (library: CommandLibrary) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
