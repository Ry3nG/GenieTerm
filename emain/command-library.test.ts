// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandHistoryEntry } from "../frontend/util/commandlibrary";
import { makeCommandLibraryStore } from "./command-library";

const Directories: string[] = [];
const Stores: ReturnType<typeof makeCommandLibraryStore>[] = [];
function makeStore() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "genieterm-command-library-"));
    Directories.push(directory);
    const file = path.join(directory, "commands.json");
    const store = makeCommandLibraryStore(file, 60000);
    Stores.push(store);
    return { file, store };
}
function entry(id: string): CommandHistoryEntry {
    return {
        id,
        blockid: id,
        tabid: "tab",
        commandblockid: 1,
        command: "echo hello",
        connection: "",
        cwd: "/work",
        shell: "bash",
        startts: 100,
        donets: null,
        exitcode: null,
        status: "running",
    };
}
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const store of Stores.splice(0)) store.flush();
    for (const directory of Directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("main-owned command library persistence", () => {
    it("serializes writes from multiple windows and only writes a debounced atomic snapshot", () => {
        const { file, store } = makeStore();
        const revisions: number[] = [];
        store.subscribe((library) => revisions.push(library.revision));
        store.update({ type: "record", entry: entry("window-one") });
        store.update({ type: "record", entry: entry("window-two") });
        expect(fs.existsSync(file)).toBe(false);
        store.flush();
        expect(revisions).toEqual([1, 2]);
        expect(
            makeCommandLibraryStore(file)
                .get()
                .history.map((item) => item.id)
        ).toEqual(["window-two", "window-one"]);
        expect(fs.readdirSync(path.dirname(file))).toEqual(["commands.json"]);
    });

    it("persists deletion and does not recreate it after a stale completion arrives", () => {
        const { file, store } = makeStore();
        store.update({ type: "record", entry: entry("first") });
        store.update({ type: "clearhistory" });
        store.update({ type: "record", update: true, entry: { ...entry("first"), status: "success", exitcode: 0 } });
        store.flush();
        expect(makeCommandLibraryStore(file).get().history).toEqual([]);
    });

    it("preserves corrupt and newer-version files instead of overwriting them", () => {
        const { file } = makeStore();
        for (const contents of ["{broken", '{"version":2,"history":[]}']) {
            fs.writeFileSync(file, contents);
            const store = makeCommandLibraryStore(file);
            expect(() => store.get()).toThrow("existing file has been kept");
            expect(() => store.update({ type: "clearhistory" })).toThrow();
            store.flush();
            expect(fs.readFileSync(file, "utf8")).toBe(contents);
        }
    });

    it("retries a temporary save failure on refresh and preserves newer renderer changes", () => {
        vi.useFakeTimers();
        const { file, store } = makeStore();
        const write = vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
            throw new Error("temporary disk error");
        });
        store.update({ type: "record", entry: entry("first") });
        vi.advanceTimersByTime(60000);
        expect(write).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(file)).toBe(false);

        store.update({ type: "record", entry: entry("second") });
        expect(store.get().history.map((item) => item.id)).toEqual(["second", "first"]);
        expect(write).toHaveBeenCalledTimes(2);
        expect(makeCommandLibraryStore(file).get().history).toHaveLength(2);
        vi.advanceTimersByTime(60000);
        expect(write).toHaveBeenCalledTimes(2);
    });

    it("retries a continuing write failure only on an explicit read or later mutation", () => {
        vi.useFakeTimers();
        const { store } = makeStore();
        const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
            throw new Error("disk unavailable");
        });
        store.update({ type: "record", entry: entry("first") });
        vi.advanceTimersByTime(120000);
        expect(write).toHaveBeenCalledTimes(1);
        expect(() => store.get()).toThrow("Could not save");
        expect(write).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(120000);
        expect(write).toHaveBeenCalledTimes(2);
        write.mockRestore();
        expect(store.get().history).toHaveLength(1);
    });
});
