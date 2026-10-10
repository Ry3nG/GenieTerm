// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
    confirmFileDelete,
    copyWithOverwriteConfirmation,
    getBestUnit,
    getDirectoryColumnSizing,
    getDirectoryFocusIndex,
    getDirectoryHiddenColumns,
    getFileKind,
    getLastModifiedTime,
    handleFileDelete,
    isFileCopyFailure,
    isParentDirEntry,
    makeDeleteConfirmation,
    makeDirectoryDefaultMenuItems,
    makeRecursiveDeleteConfirmation,
    overwriteError,
    parentDirectoryFirst,
    recursiveError,
    resizeDirectoryColumns,
} from "./preview-directory-utils";

describe("getLastModifiedTime", () => {
    const now = new Date(2026, 6, 6, 12, 0);

    it.each([
        [new Date(2026, 6, 6, 0, 21), "Today 00:21"],
        [new Date(2026, 6, 5, 20, 9), "Yesterday 20:09"],
        [new Date(2026, 0, 5, 9, 7), "Jan 5 09:07"],
        [new Date(2025, 6, 5, 20, 52), "Jul 5, 2025"],
        [new Date(2027, 6, 5), "Jul 5, 2027"],
    ])("formats %s as %s", (date, expected) => {
        expect(getLastModifiedTime(date.getTime(), now)).toBe(expected);
    });

    it("recognizes yesterday across year and month boundaries", () => {
        expect(getLastModifiedTime(new Date(2025, 11, 31, 23, 59).getTime(), new Date(2026, 0, 1))).toBe(
            "Yesterday 23:59"
        );
        expect(getLastModifiedTime(new Date(2026, 1, 28, 20, 9).getTime(), new Date(2026, 2, 1))).toBe(
            "Yesterday 20:09"
        );
    });

    it("uses calendar days across daylight saving changes", () => {
        expect(getLastModifiedTime(new Date(2026, 2, 8, 0, 30).getTime(), new Date(2026, 2, 9, 0, 15))).toBe(
            "Yesterday 00:30"
        );
        expect(getLastModifiedTime(new Date(2026, 10, 1, 0, 30).getTime(), new Date(2026, 10, 2, 0, 15))).toBe(
            "Yesterday 00:30"
        );
    });

    it.each([null, undefined, NaN, Infinity, 1e20])("handles unavailable dates (%s)", (date) => {
        expect(getLastModifiedTime(date, now)).toBe("—");
    });
});

describe("getBestUnit", () => {
    it.each([
        [0, "0 B"],
        [206, "206 B"],
        [999, "999 B"],
        [1000, "1.0 KB"],
        [1950, "1.9 KB"],
        [5130, "5.1 KB"],
        [12400000, "12.4 MB"],
        [1200000000, "1.2 GB"],
        [99950, "100 KB"],
        [100500, "101 KB"],
        [999500, "1.0 MB"],
        [1e12, "1.0 TB"],
        [1e15, "1.0 PB"],
        [null, "—"],
        [undefined, "—"],
        [-1, "—"],
        [NaN, "—"],
        [Infinity, "—"],
    ])("formats %s as %s", (bytes, expected) => {
        expect(getBestUnit(bytes)).toBe(expected);
    });
});

describe("getFileKind", () => {
    it.each([
        ["README.md", "text/plain", "Markdown"],
        ["README.MARKDOWN", "", "Markdown"],
        ["config.json", "application/octet-stream", "JSON"],
        ["config.yml", "text/plain", "YAML"],
        ["config.yaml", "", "YAML"],
        ["app.tsx", "text/plain", "TypeScript"],
        ["app.ts", "video/mp2t", "TypeScript"],
        ["app.jsx", "", "JavaScript"],
        ["main.go", "", "Go source"],
        ["setup.sh", "", "Shell script"],
        ["image.PNG", "", "PNG image"],
        ["image.jpeg", "", "JPEG image"],
        ["image.jpg", "", "JPEG image"],
        ["report.pdf", "", "PDF"],
        ["notes.txt", "", "Plain text"],
        ["yarn.lock", "text/plain", "LOCK file"],
        ["README", "text/plain; charset=utf-8", "Plain text"],
        ["LICENSE", "", "Document"],
        [".gitignore", "", "Document"],
        ["file.", "", "Document"],
        ["", "application/json; charset=utf-8", "JSON"],
        ["image", "image/png", "PNG image"],
        ["constructor", "application/octet-stream", "Document"],
        ["file.constructor", "", "CONSTRUCTOR file"],
    ])("formats %s (%s) as %s", (name, mimetype, expected) => {
        expect(getFileKind({ name, mimetype })).toBe(expected);
    });

    it("prioritizes folders and symlinks over file extensions", () => {
        expect(getFileKind({ name: "folder.json", isdir: true })).toBe("Folder");
        expect(getFileKind({ mimetype: "directory" })).toBe("Folder");
        expect(getFileKind({ name: "linked.md", modestr: "Lrwxr-xr-x" })).toBe("Symlink");
        expect(getFileKind({ isdir: true, modestr: "lrwxr-xr-x" })).toBe("Symlink");
        expect(getFileKind({ mode: 1 << 27 })).toBe("Symlink");
        expect(getFileKind({ mimetype: "inode/symlink" })).toBe("Symlink");
        expect(getFileKind({})).toBe("Document");
    });
});

describe("directory navigation", () => {
    it.each([-20, -1, 1, 20])("starts at the first real entry for movement %s", (delta) => {
        expect(getDirectoryFocusIndex(-1, 5, delta, true)).toBe(1);
        expect(getDirectoryFocusIndex(-1, 5, delta, false)).toBe(0);
    });

    it("handles empty and parent-only directories and clamps navigation", () => {
        expect(getDirectoryFocusIndex(-1, 0, 1, false)).toBe(-1);
        expect(getDirectoryFocusIndex(-1, 1, 1, true)).toBe(0);
        expect(getDirectoryFocusIndex(1, 5, -1, true)).toBe(0);
        expect(getDirectoryFocusIndex(4, 5, 20, true)).toBe(4);
        expect(getDirectoryFocusIndex(4, 5, -20, true)).toBe(0);
    });

    it("keeps the parent first for both rendered rows and selected paths after sorting", () => {
        const rows = ["z.txt", "a.txt", ".."].map((name) => ({ original: { name, path: `/tmp/${name}` } }));
        const ordered = parentDirectoryFirst(rows);
        expect(ordered.map((row) => row.original.name)).toEqual(["..", "z.txt", "a.txt"]);
        expect(ordered[getDirectoryFocusIndex(-1, ordered.length, 1, true)].original.path).toBe("/tmp/z.txt");
        expect(rows[0].original.name).toBe("z.txt");
        expect(parentDirectoryFirst(rows.slice(0, 2))).toEqual(rows.slice(0, 2));
    });
});

describe("directory column sizing", () => {
    it("fills a wide viewport and preserves minimum widths in a narrow one", () => {
        const wide = getDirectoryColumnSizing(1900, {});
        expect(Object.values(wide).reduce((sum, width) => sum + width, 12)).toBe(1900);
        expect(wide.name).toBeGreaterThan(1200);
        const narrow = getDirectoryColumnSizing(500, {});
        expect(narrow.name).toBe(160);
        expect(narrow.mimetype).toBe(wide.mimetype);
    });

    it("resizes fixed columns while Name absorbs the difference", () => {
        const current = getDirectoryColumnSizing(1900, {});
        const resized = resizeDirectoryColumns(current, { ...current, mimetype: 220 });
        const next = getDirectoryColumnSizing(1900, resized);
        expect(next.mimetype).toBe(220);
        expect(next.name).toBe(current.name - 68);
        expect(getDirectoryColumnSizing(1000, resized).mimetype).toBe(220);
    });

    it("moves the Name/Perm boundary without leaving empty space", () => {
        const current = getDirectoryColumnSizing(1900, {});
        const resized = resizeDirectoryColumns(current, { ...current, name: current.name - 80 });
        const next = getDirectoryColumnSizing(1900, resized);
        expect(next.name).toBe(current.name - 80);
        expect(next.modestr).toBe(current.modestr + 80);
        expect(resizeDirectoryColumns(current, { ...current, name: current.name + 500 }).modestr).toBe(100);
    });
});

describe("copyWithOverwriteConfirmation", () => {
    it("narrows file copy failures with a type guard", () => {
        const result = {
            ok: false,
            errorText: "copy failed",
            retryable: true,
        } as const;

        expect(isFileCopyFailure(result)).toBe(true);
        if (isFileCopyFailure(result)) {
            expect(result.errorText).toBe("copy failed");
            expect(result.retryable).toBe(true);
        }
    });

    it("waits for file overwrite confirmation before resolving the copy result", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const copyCalls: CommandFileCopyData[] = [];
        let overlay: ErrorMsg | null = null;
        const refresh = vi.fn();
        const copyFile = vi.fn(async (data: CommandFileCopyData) => {
            copyCalls.push(structuredClone(data));
            if (copyCalls.length === 1) {
                throw new Error(`file already exists at "/home/me/report.txt", ${overwriteError}`);
            }
        });
        const data: CommandFileCopyData = {
            srcuri: "file:///tmp/report.txt",
            desturi: "wsh://devbox/~/uploads",
            opts: { timeout: 42 },
        };

        const resultPromise = copyWithOverwriteConfirmation(data, "file", {
            copyFile,
            refresh,
            setErrorMsg: (nextOverlay) => {
                overlay = nextOverlay;
            },
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(copyFile).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(overlay?.status).toBe("Confirm Overwrite File(s)");
        expect(overlay?.buttons?.map((button) => button.text)).toEqual(["Delete Then Copy"]);
        await expect(Promise.race([resultPromise, Promise.resolve("pending")])).resolves.toBe("pending");

        await overlay?.buttons?.[0]?.onClick();

        await expect(resultPromise).resolves.toEqual({ ok: true });
        expect(copyFile).toHaveBeenCalledTimes(2);
        expect(refresh).toHaveBeenCalledTimes(2);
        expect(copyCalls[1].opts).toMatchObject({ timeout: 42, overwrite: true });
        expect(data.opts.overwrite).toBeUndefined();
    });

    function makeConfirmationHarness() {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const errorMsgAtom = atom(null) as PrimitiveAtom<ErrorMsg>;
        const copyFile = vi.fn(async (_data: CommandFileCopyData) => {
            if (copyFile.mock.calls.length === 1) {
                throw new Error(`file already exists, ${overwriteError}`);
            }
        });
        const deps = {
            copyFile,
            setErrorMsg: (msg: ErrorMsg) => globalStore.set(errorMsgAtom, msg),
            watchErrorMsg: (listener: (msg: ErrorMsg) => void) =>
                globalStore.sub(errorMsgAtom, () => listener(globalStore.get(errorMsgAtom))),
        };
        const data: CommandFileCopyData = { srcuri: "file:///tmp/a.txt", desturi: "wsh://devbox/~/up" };
        return { errorMsgAtom, copyFile, deps, data };
    }

    async function flushMicrotasks() {
        for (let index = 0; index < 5; index++) {
            await Promise.resolve();
        }
    }

    it("settles as canceled when the overwrite prompt is replaced by another message", async () => {
        const { errorMsgAtom, deps, data } = makeConfirmationHarness();
        const resultPromise = copyWithOverwriteConfirmation(data, "file", deps);
        await flushMicrotasks();
        expect(globalStore.get(errorMsgAtom)?.status).toBe("Confirm Overwrite File(s)");

        globalStore.set(errorMsgAtom, { status: "Rename Failed", text: "boom" });

        await expect(resultPromise).resolves.toMatchObject({ ok: false, canceled: true });
        expect(globalStore.get(errorMsgAtom)?.status).toBe("Rename Failed");
    });

    it("settles as canceled and clears the prompt when aborted (unmount or job cancel)", async () => {
        const { errorMsgAtom, copyFile, deps, data } = makeConfirmationHarness();
        const controller = new AbortController();
        const resultPromise = copyWithOverwriteConfirmation(data, "file", { ...deps, signal: controller.signal });
        await flushMicrotasks();
        expect(globalStore.get(errorMsgAtom)?.status).toBe("Confirm Overwrite File(s)");

        controller.abort();

        await expect(resultPromise).resolves.toMatchObject({ ok: false, canceled: true });
        expect(globalStore.get(errorMsgAtom)).toBeNull();
        expect(copyFile).toHaveBeenCalledTimes(1);
    });

    it("does not prompt when already aborted and keeps a confirmed copy running after the overlay resets", async () => {
        const aborted = makeConfirmationHarness();
        const controller = new AbortController();
        controller.abort();
        await expect(
            copyWithOverwriteConfirmation(aborted.data, "file", { ...aborted.deps, signal: controller.signal })
        ).resolves.toMatchObject({ canceled: true });
        expect(globalStore.get(aborted.errorMsgAtom)).toBeNull();

        const { errorMsgAtom, copyFile, deps, data } = makeConfirmationHarness();
        const resultPromise = copyWithOverwriteConfirmation(data, "file", deps);
        await flushMicrotasks();
        const prompt = globalStore.get(errorMsgAtom);
        prompt.buttons[0].onClick();
        globalStore.set(errorMsgAtom, null);

        await expect(resultPromise).resolves.toEqual({ ok: true });
        expect(copyFile).toHaveBeenCalledTimes(2);
    });
});

describe("makeDirectoryDefaultMenuItems", () => {
    it("persists the selected file view mode", async () => {
        const treeViewMode = atom(false);
        const showHiddenFiles = atom(true);
        const defaultSortAtom = atom("name");
        const setConfig = vi.fn(async () => {});
        const model = {
            treeViewMode,
            showHiddenFiles,
            env: {
                getSettingsKeyAtom: vi.fn((key: string) => {
                    if (key === "preview:defaultsort") {
                        return defaultSortAtom;
                    }
                    return atom(null);
                }),
                rpc: {
                    SetConfigCommand: setConfig,
                },
            },
        } as any;

        const fileViewMenu = makeDirectoryDefaultMenuItems(model).find((item) => item.label === "File View");
        const treeItem = fileViewMenu?.submenu?.find((item) => item.label === "Tree");
        treeItem?.click?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(globalStore.get(treeViewMode)).toBe(true);
        expect(setConfig).toHaveBeenCalledWith(undefined, { "preview:fileview": "tree" });
    });
});

describe("delete confirmations", () => {
    it("names the full path for files and folders", () => {
        expect(makeDeleteConfirmation("/srv/app/config.yml", false, null)).toMatchObject({
            text: expect.stringContaining("/srv/app/config.yml"),
            recursive: false,
        });
        expect(makeDeleteConfirmation("/srv/app/empty", true, 0)).toMatchObject({
            text: expect.stringContaining("empty folder /srv/app/empty"),
            recursive: false,
        });
        expect(makeDeleteConfirmation("/srv/app/logs", true, null)).toMatchObject({
            text: expect.stringContaining("/srv/app/logs"),
            recursive: false,
        });
    });

    it("asks for a recursive delete with the item count for non-empty folders", () => {
        const confirmation = makeDeleteConfirmation("/srv/app", true, 1);
        expect(confirmation.recursive).toBe(true);
        expect(confirmation.buttonText).toBe("Delete Recursively");
        expect(confirmation.text).toContain("/srv/app");
        expect(confirmation.text).toContain("1 item ");
        expect(makeRecursiveDeleteConfirmation("/srv/app", null).text).toContain("/srv/app and everything inside it");
    });

    it("ignores the parent directory entry", () => {
        const setErrorMsg = vi.fn();
        expect(isParentDirEntry({ name: "..", path: "/srv" })).toBe(true);
        confirmFileDelete({} as any, { name: "..", path: "/srv", isdir: true }, setErrorMsg);
        expect(setErrorMsg).not.toHaveBeenCalled();
    });

    it("names the path when the backend requires a recursive delete", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const setErrorMsg = vi.fn();
        const fileDelete = vi.fn(async () => {
            throw new Error(recursiveError);
        });
        const model = {
            formatRemoteUri: vi.fn(async (path: string) => `wsh://devbox${path}`),
            refreshCallback: vi.fn(),
            env: {
                rpc: {
                    FileDeleteCommand: fileDelete,
                    FileListStreamCommand: async function* () {
                        yield { fileinfo: [{ name: "a" }, { name: "b" }] };
                    },
                },
            },
        } as any;

        handleFileDelete(model, "/srv/data", false, setErrorMsg);
        await vi.waitFor(() => expect(setErrorMsg).toHaveBeenCalledTimes(1));

        const prompt = setErrorMsg.mock.calls[0][0] as ErrorMsg;
        expect(prompt.text).toContain("/srv/data");
        expect(prompt.text).toContain("2 items");
        expect(prompt.buttons?.[0].text).toBe("Delete Recursively");
    });
});

describe("getDirectoryHiddenColumns", () => {
    it("drops Perm, then Type, then Last Modified as the block narrows", () => {
        expect(getDirectoryHiddenColumns(0)).toEqual([]);
        expect(getDirectoryHiddenColumns(900)).toEqual([]);
        expect(getDirectoryHiddenColumns(700)).toEqual(["modestr"]);
        expect(getDirectoryHiddenColumns(560)).toEqual(["modestr", "mimetype"]);
        expect(getDirectoryHiddenColumns(400)).toEqual(["modestr", "mimetype", "modtime"]);
    });

    it("gives the hidden columns' width to Name", () => {
        const sizing = getDirectoryColumnSizing(700, {}, ["modestr"]);
        const used = sizing.logo + sizing.modtime + sizing.size + sizing.mimetype + sizing.name;
        expect(used).toBe(700 - 12);
    });
});
