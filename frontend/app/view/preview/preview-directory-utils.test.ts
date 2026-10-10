// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
    confirmFileDelete,
    copyWithOverwriteConfirmation,
    getLastModifiedTime,
    handleFileDelete,
    isFileCopyFailure,
    isParentDirEntry,
    makeDeleteConfirmation,
    makeDirectoryDefaultMenuItems,
    makeRecursiveDeleteConfirmation,
    overwriteError,
    recursiveError,
} from "./preview-directory-utils";

describe("getLastModifiedTime", () => {
    it("shows month, padded day, and local time for files from the current year", () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));

            expect(getLastModifiedTime(new Date(2026, 0, 5, 9, 7, 0).getTime())).toBe("Jan  5 09:07");
        } finally {
            vi.useRealTimers();
        }
    });

    it("shows the date for files from a different year", () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));

            expect(getLastModifiedTime(new Date(2025, 11, 31, 23, 59, 0).getTime())).toBe("2025-12-31");
        } finally {
            vi.useRealTimers();
        }
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
