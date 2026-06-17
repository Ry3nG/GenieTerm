import { beforeEach, describe, expect, it, vi } from "vitest";

describe("addOpenMenuItems", () => {
    let downloadFile: ReturnType<typeof vi.fn>;
    let downloadFolder: ReturnType<typeof vi.fn>;
    let openNativePath: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        downloadFile = vi.fn();
        downloadFolder = vi.fn();
        openNativePath = vi.fn();
        vi.doMock("@/app/store/global", () => ({
            createBlock: vi.fn(),
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
});
