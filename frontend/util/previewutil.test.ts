import { beforeEach, describe, expect, it, vi } from "vitest";

describe("addOpenMenuItems", () => {
    let createBlock: ReturnType<typeof vi.fn>;
    let downloadFile: ReturnType<typeof vi.fn>;
    let downloadFolder: ReturnType<typeof vi.fn>;
    let openNativePath: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        createBlock = vi.fn();
        downloadFile = vi.fn();
        downloadFolder = vi.fn();
        openNativePath = vi.fn();
        vi.doMock("@/app/store/global", () => ({
            createBlock,
            getApi: () => ({
                downloadFile,
                downloadFolder,
                openNativePath,
            }),
        }));
    });

    it("downloads remote files with Download File", async () => {
        const { addOpenMenuItems } = await import("./previewutil");
        const menu = addOpenMenuItems([], "paw-5090-ws", {
            path: "~/projects/out.txt",
            dir: "~/projects",
            isdir: false,
        } as FileInfo);
        const item = menu.find((entry) => entry.label === "Download File");

        expect(item).toBeTruthy();
        item.click();

        expect(downloadFile).toHaveBeenCalledWith("wsh://paw-5090-ws/~/projects/out.txt");
        expect(downloadFolder).not.toHaveBeenCalled();
    });

    it("downloads remote directories with Download Folder", async () => {
        const { addOpenMenuItems } = await import("./previewutil");
        const menu = addOpenMenuItems([], "paw-5090-ws", {
            path: "~/projects/out",
            dir: "~/projects",
            isdir: true,
        } as FileInfo);
        const item = menu.find((entry) => entry.label === "Download Folder");

        expect(item).toBeTruthy();
        item.click();

        expect(downloadFolder).toHaveBeenCalledWith("wsh://paw-5090-ws/~/projects/out");
        expect(downloadFile).not.toHaveBeenCalled();
    });

    it("opens terminal in the provided current directory instead of the selected entry", async () => {
        const { addOpenMenuItems } = await import("./previewutil");
        const menu = addOpenMenuItems(
            [],
            "",
            {
                path: "/Users/gongzerui",
                dir: "/Users",
                isdir: true,
            } as FileInfo,
            { terminalCwd: "/Users/gongzerui/projects" }
        );
        const item = menu.find((entry) => entry.label === "Open Terminal Here");

        expect(item).toBeTruthy();
        item.click();

        expect(createBlock).toHaveBeenCalledWith({
            meta: {
                controller: "shell",
                view: "term",
                "cmd:cwd": "/Users/gongzerui/projects",
                connection: "",
            },
        });
    });

    it("opens terminal in the selected directory when no current directory override is provided", async () => {
        const { addOpenMenuItems } = await import("./previewutil");
        const menu = addOpenMenuItems([], "", {
            path: "/Users/gongzerui/projects/GenieTerm",
            dir: "/Users/gongzerui/projects",
            isdir: true,
        } as FileInfo);
        const item = menu.find((entry) => entry.label === "Open Terminal Here");

        expect(item).toBeTruthy();
        item.click();

        expect(createBlock).toHaveBeenCalledWith({
            meta: {
                controller: "shell",
                view: "term",
                "cmd:cwd": "/Users/gongzerui/projects/GenieTerm",
                connection: "",
            },
        });
    });
});
