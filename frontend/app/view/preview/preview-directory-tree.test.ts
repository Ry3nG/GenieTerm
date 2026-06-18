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

    it("adds a delete action that uses the formatted file URI", async () => {
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

        expect(fileDelete.mock.calls[0][1]).toEqual({
            path: "wsh://devbox/home/me/notes.txt",
            recursive: false,
        });
        expect(refreshCallback).toHaveBeenCalledTimes(1);
        expect(setErrorMsg).not.toHaveBeenCalled();
    });
});
