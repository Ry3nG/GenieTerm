// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import fsAsync from "node:fs/promises";
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
afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const store of Stores.splice(0)) await store.flush();
    for (const directory of Directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("main-owned command library persistence", () => {
    it("serializes writes from multiple windows and only writes a debounced atomic snapshot", async () => {
        const { file, store } = makeStore();
        const revisions: number[] = [];
        store.subscribe((library) => revisions.push(library.revision));
        await store.update({ type: "record", entry: entry("window-one") });
        await store.update({ type: "record", entry: entry("window-two") });
        expect(fs.existsSync(file)).toBe(false);
        await store.flush();
        expect(revisions).toEqual([1, 2]);
        expect((await makeCommandLibraryStore(file).get()).history.map((item) => item.id)).toEqual([
            "window-two",
            "window-one",
        ]);
        expect(fs.readdirSync(path.dirname(file))).toEqual(["commands.json"]);
    });

    it("persists deletion and does not recreate it after a stale completion arrives", async () => {
        const { file, store } = makeStore();
        await store.update({ type: "record", entry: entry("first") });
        await store.update({ type: "clearhistory" });
        await store.update({
            type: "record",
            update: true,
            entry: { ...entry("first"), status: "success", exitcode: 0 },
        });
        await store.flush();
        expect((await makeCommandLibraryStore(file).get()).history).toEqual([]);
    });

    it("preserves corrupt and newer-version files instead of overwriting them", async () => {
        const { file } = makeStore();
        for (const contents of ["{broken", '{"version":3,"history":[]}']) {
            fs.writeFileSync(file, contents);
            const store = makeCommandLibraryStore(file);
            await expect(store.get()).rejects.toThrow("existing file has been kept");
            await expect(store.update({ type: "clearhistory" })).rejects.toThrow();
            await store.flush();
            expect(fs.readFileSync(file, "utf8")).toBe(contents);
        }
    });

    it("retries a temporary save failure on refresh and preserves newer renderer changes", async () => {
        vi.useFakeTimers();
        const { file, store } = makeStore();
        const write = vi.spyOn(fsAsync, "writeFile").mockImplementationOnce(async () => {
            throw new Error("temporary disk error");
        });
        await store.update({ type: "record", entry: entry("first") });
        await expect(store.flush()).rejects.toThrow("Could not save");
        expect(write).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(file)).toBe(false);

        await store.update({ type: "record", entry: entry("second") });
        expect((await store.get()).history.map((item) => item.id)).toEqual(["second", "first"]);
        expect(write).toHaveBeenCalledTimes(2);
        expect((await makeCommandLibraryStore(file).get()).history).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(60000);
        expect(write).toHaveBeenCalledTimes(2);
    });

    it("retries a continuing write failure only on an explicit read or later mutation", async () => {
        vi.useFakeTimers();
        const { store } = makeStore();
        const write = vi.spyOn(fsAsync, "writeFile").mockImplementation(async () => {
            throw new Error("disk unavailable");
        });
        await store.update({ type: "record", entry: entry("first") });
        await expect(store.flush()).rejects.toThrow("Could not save");
        await vi.advanceTimersByTimeAsync(120000);
        expect(write).toHaveBeenCalledTimes(1);
        await expect(store.get()).rejects.toThrow("Could not save");
        expect(write).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(120000);
        expect(write).toHaveBeenCalledTimes(2);
        write.mockRestore();
        expect((await store.get()).history).toHaveLength(1);
    });

    it("does no startup IO and imports only history without changing the legacy file", async () => {
        const { file } = makeStore();
        const legacy = `${file}.legacy`;
        const original = JSON.stringify({ version: 1, history: [entry("old")], recipes: [{ template: "echo test" }] });
        fs.writeFileSync(legacy, original);
        const read = vi.spyOn(fsAsync, "readFile");
        const store = makeCommandLibraryStore(file, 60000, legacy);
        Stores.push(store);
        await store.flush();
        expect(read).not.toHaveBeenCalled();
        const recovered = await store.get();
        expect(recovered.history[0].id).toBe("old");
        expect(recovered).not.toHaveProperty("recipes");
        await store.flush();
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(recovered);
        expect(fs.readFileSync(legacy, "utf8")).toBe(original);
        await store.update({ type: "clearhistory" });
        await store.flush();
        expect((await makeCommandLibraryStore(file, 60000, legacy).get()).history).toEqual([]);
    });

    it("persists updates arriving during an asynchronous write before flush completes", async () => {
        const { file, store } = makeStore();
        await store.update({ type: "record", entry: entry("first") });
        let release: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const writeFile = fsAsync.writeFile.bind(fsAsync);
        const write = vi.spyOn(fsAsync, "writeFile").mockImplementationOnce(async (...args) => {
            await pending;
            return writeFile(...args);
        });
        const flushing = store.flush();
        await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
        await store.update({ type: "record", entry: entry("second") });
        release();
        await flushing;
        expect(write).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fs.readFileSync(file, "utf8")).history.map((item) => item.id)).toEqual(["second", "first"]);
    });
});
