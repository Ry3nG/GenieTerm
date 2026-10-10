// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { makeFileTreeNodeContextMenu, makeTreeNodeKey, makeTreeNodeRenderKey } from "./preview-directory-tree";

describe("preview directory tree", () => {
    it("keys home-shortened paths by connection", () => {
        expect(makeTreeNodeKey("local", "~/projects")).toBe("local:~/projects");
        expect(makeTreeNodeKey("zrgong@paw-5090-ws", "~/projects")).toBe("zrgong@paw-5090-ws:~/projects");
    });

    it("includes the refresh version in render keys so expanded children remount after file operations", () => {
        expect(makeTreeNodeRenderKey("local", "~/projects", 3)).toBe("local:~/projects:3");
    });

    it("confirms before deleting and then uses the formatted file URI", async () => {
        const fileDelete = vi.fn(async (_client: unknown, _data: CommandDeleteFileData) => {});
        const refreshCallback = vi.fn();
        const setErrorMsg = vi.fn();
        const model = {
            formatRemoteUri: vi.fn(async (path: string) => `wsh://devbox${path}`),
            refreshCallback,
            env: {
                rpc: {
                    FileDeleteCommand: fileDelete,
                },
            },
        };

        const menu = makeFileTreeNodeContextMenu(
            {
                model,
                connName: "devbox",
                setErrorMsg,
            } as any,
            {
                name: "notes.txt",
                path: "/home/me/notes.txt",
                isdir: false,
            }
        );
        const deleteItem = menu.find((item) => item.label === "Delete");

        expect(deleteItem).toBeTruthy();
        deleteItem?.click?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(fileDelete).not.toHaveBeenCalled();
        expect(setErrorMsg).toHaveBeenCalledTimes(1);
        const confirmation = setErrorMsg.mock.calls[0][0] as ErrorMsg;
        expect(confirmation.text).toContain("/home/me/notes.txt");
        expect(confirmation.buttons?.map((button) => button.text)).toEqual(["Delete"]);

        confirmation.buttons[0].onClick();
        await vi.waitFor(() => expect(refreshCallback).toHaveBeenCalledTimes(1));

        expect(fileDelete.mock.calls[0][1]).toEqual({
            path: "wsh://devbox/home/me/notes.txt",
            recursive: false,
        });
        expect(setErrorMsg).toHaveBeenCalledTimes(1);
    });

    it("names the folder and its item count before a recursive delete", async () => {
        const fileDelete = vi.fn(async (_client: unknown, _data: CommandDeleteFileData) => {});
        const setErrorMsg = vi.fn();
        const model = {
            formatRemoteUri: vi.fn(async (path: string) => `wsh://devbox${path}`),
            refreshCallback: vi.fn(),
            env: {
                rpc: {
                    FileDeleteCommand: fileDelete,
                    FileListStreamCommand: async function* () {
                        yield { fileinfo: [{ name: "a.txt" }, { name: ".hidden" }] };
                        yield { fileinfo: [{ name: "sub" }] };
                    },
                },
            },
        };
        const menu = makeFileTreeNodeContextMenu({ model, connName: "devbox", setErrorMsg } as any, {
            name: "proj",
            path: "/home/me/proj",
            isdir: true,
        });

        menu.find((item) => item.label === "Delete")?.click?.();
        await vi.waitFor(() => expect(setErrorMsg).toHaveBeenCalledTimes(1));

        const confirmation = setErrorMsg.mock.calls[0][0] as ErrorMsg;
        expect(confirmation.text).toContain("/home/me/proj");
        expect(confirmation.text).toContain("3 items");
        expect(confirmation.buttons?.[0].text).toBe("Delete Recursively");
        expect(fileDelete).not.toHaveBeenCalled();

        confirmation.buttons[0].onClick();
        await vi.waitFor(() => expect(fileDelete).toHaveBeenCalledTimes(1));
        expect(fileDelete.mock.calls[0][1]).toEqual({ path: "wsh://devbox/home/me/proj", recursive: true });
    });

    it("offers no delete action on the parent directory entry", () => {
        const menu = makeFileTreeNodeContextMenu({ model: {}, connName: "devbox", setErrorMsg: vi.fn() } as any, {
            name: "..",
            path: "/home",
            isdir: true,
        });
        expect(menu.find((item) => item.label === "Delete")).toBeUndefined();
    });
});
