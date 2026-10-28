// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs/promises";
import path from "node:path";
import {
    applyCommandLibraryChange,
    emptyCommandLibrary,
    recoverCommandLibrary,
    type CommandLibrary,
    type CommandLibraryChange,
} from "../frontend/util/commandlibrary";

const MaxSnapshotBytes = 32 * 1024 * 1024;

export function makeCommandLibraryStore(filePath: string, delayMs = 750, legacyPath?: string) {
    let library = emptyCommandLibrary();
    let timer: ReturnType<typeof setTimeout>;
    let dirty = false;
    let readError = "";
    let writeError = "";
    let loaded: Promise<void>;
    let writing: Promise<void>;
    const listeners = new Set<(library: CommandLibrary) => void>();
    const load = () => {
        loaded ??= (async () => {
            try {
                let source = filePath;
                let stat;
                try {
                    stat = await fs.stat(source);
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                    if (!legacyPath) return;
                    source = legacyPath;
                    try {
                        stat = await fs.stat(source);
                    } catch (legacyError) {
                        if (legacyError.code === "ENOENT") return;
                        throw legacyError;
                    }
                }
                if (stat.size > MaxSnapshotBytes) throw new Error("The command history file is too large.");
                const raw = JSON.parse(await fs.readFile(source, "utf8"));
                if (![1, 2].includes(raw?.version)) throw new Error("Unsupported command history version.");
                library = recoverCommandLibrary(raw);
                dirty = source !== filePath;
            } catch {
                readError = "Could not read the saved command history. Your existing file has been kept.";
            }
        })();
        return loaded;
    };

    const flush = async () => {
        clearTimeout(timer);
        timer = null;
        if (!loaded) return;
        await loaded;
        if (writing) return writing;
        if (!dirty || readError) return;
        writing = (async () => {
            try {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                while (dirty) {
                    const snapshot = library;
                    const temp = `${filePath}.${process.pid}.tmp`;
                    await fs.writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
                    await fs.rename(temp, filePath);
                    dirty = library !== snapshot;
                }
                const recovered = !!writeError;
                writeError = "";
                if (recovered) listeners.forEach((listener) => listener(library));
            } catch {
                writeError = "Could not save the command history on this computer.";
                throw new Error(writeError);
            }
        })();
        try {
            await writing;
        } finally {
            writing = null;
        }
    };
    const update = async (change: CommandLibraryChange) => {
        await load();
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
            timer = setTimeout(
                () => void flush().catch(() => listeners.forEach((listener) => listener(library))),
                delayMs
            );
        }
        listeners.forEach((listener) => listener(library));
        return library;
    };
    return {
        get: async () => {
            await load();
            if (readError) {
                throw new Error(readError);
            }
            if (writeError) {
                await flush();
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
