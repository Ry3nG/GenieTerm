import { describe, expect, it, vi } from "vitest";

describe("ContextMenuModel", () => {
    it("initializes only when getInstance is called", async () => {
        let contextMenuCallback: (menuId: string, id: string | null) => void;
        const onContextMenuClick = vi.fn();
        onContextMenuClick.mockImplementation((callback) => {
            contextMenuCallback = callback;
        });
        const getApi = vi.fn(() => ({
            onContextMenuClick,
            showContextMenu: vi.fn(),
        }));

        vi.resetModules();
        vi.doMock("./global", () => ({
            atoms: {},
            getApi,
            globalStore: { get: vi.fn() },
        }));

        const { ContextMenuModel } = await import("./contextmenu");
        expect(getApi).not.toHaveBeenCalled();

        const firstInstance = ContextMenuModel.getInstance();
        const secondInstance = ContextMenuModel.getInstance();

        expect(firstInstance).toBe(secondInstance);
        expect(getApi).toHaveBeenCalledTimes(1);
        expect(onContextMenuClick).toHaveBeenCalledTimes(1);
        expect(contextMenuCallback).toBeTypeOf("function");
    });

    it("runs select and close callbacks after item handler", async () => {
        let contextMenuCallback: (menuId: string, id: string | null) => void;
        const showContextMenu = vi.fn();
        const onContextMenuClick = vi.fn((callback) => {
            contextMenuCallback = callback;
        });
        const getApi = vi.fn(() => ({
            onContextMenuClick,
            showContextMenu,
        }));
        const workspace = { oid: "workspace-1" };

        vi.resetModules();
        vi.doMock("./global", () => ({
            atoms: { workspace: "workspace", builderId: "builderId" },
            getApi,
            globalStore: {
                get: vi.fn((atom) => {
                    if (atom === "workspace") {
                        return workspace;
                    }
                    return "builder-1";
                }),
            },
        }));

        const { ContextMenuModel } = await import("./contextmenu");
        const model = ContextMenuModel.getInstance();
        const order: string[] = [];
        const itemClick = vi.fn(() => {
            order.push("item");
        });
        const onSelect = vi.fn((item) => {
            order.push(`select:${item.label}`);
        });
        const onClose = vi.fn((item) => {
            order.push(`close:${item?.label ?? "null"}`);
        });

        model.showContextMenu(
            [{ label: "Open", click: itemClick }],
            { stopPropagation: vi.fn() } as any,
            { onSelect, onClose }
        );
        const menuId = showContextMenu.mock.calls[0][1];
        const itemId = showContextMenu.mock.calls[0][2][0].id;
        contextMenuCallback(menuId, itemId);

        expect(order).toEqual(["item", "select:Open", "close:Open"]);
        expect(itemClick).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("runs cancel and close callbacks when no item is selected", async () => {
        let contextMenuCallback: (menuId: string, id: string | null) => void;
        const showContextMenu = vi.fn();
        const onContextMenuClick = vi.fn((callback) => {
            contextMenuCallback = callback;
        });
        const getApi = vi.fn(() => ({
            onContextMenuClick,
            showContextMenu,
        }));
        const workspace = { oid: "workspace-1" };

        vi.resetModules();
        vi.doMock("./global", () => ({
            atoms: { workspace: "workspace", builderId: "builderId" },
            getApi,
            globalStore: {
                get: vi.fn((atom) => {
                    if (atom === "workspace") {
                        return workspace;
                    }
                    return "builder-1";
                }),
            },
        }));

        const { ContextMenuModel } = await import("./contextmenu");
        const model = ContextMenuModel.getInstance();
        const order: string[] = [];
        const onCancel = vi.fn(() => {
            order.push("cancel");
        });
        const onClose = vi.fn((item) => {
            order.push(`close:${item == null ? "null" : item.label}`);
        });

        model.showContextMenu(
            [{ label: "Open", click: vi.fn() }],
            { stopPropagation: vi.fn() } as any,
            { onCancel, onClose }
        );
        const menuId = showContextMenu.mock.calls[0][1];
        contextMenuCallback(menuId, null);

        expect(order).toEqual(["cancel", "close:null"]);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ignores click events from a stale menu", async () => {
        let contextMenuCallback: (menuId: string, id: string | null) => void;
        const showContextMenu = vi.fn();
        const onContextMenuClick = vi.fn((callback) => {
            contextMenuCallback = callback;
        });
        const getApi = vi.fn(() => ({
            onContextMenuClick,
            showContextMenu,
        }));

        vi.resetModules();
        vi.doMock("./global", () => ({
            atoms: { workspaceId: "workspaceId", builderId: "builderId" },
            getApi,
            globalStore: {
                get: vi.fn((atom) => {
                    if (atom === "workspaceId") {
                        return "workspace-1";
                    }
                    return "builder-1";
                }),
            },
        }));

        const { ContextMenuModel } = await import("./contextmenu");
        const model = ContextMenuModel.getInstance();
        const oldClick = vi.fn();
        const newClick = vi.fn();

        model.showContextMenu([{ label: "Old", click: oldClick }], { stopPropagation: vi.fn() } as any);
        const oldMenuId = showContextMenu.mock.calls[0][1];
        model.showContextMenu([{ label: "New", click: newClick }], { stopPropagation: vi.fn() } as any);
        const newMenuId = showContextMenu.mock.calls[1][1];
        expect(oldMenuId).toBeTypeOf("string");
        expect(newMenuId).toBeTypeOf("string");
        const newMenuItems = showContextMenu.mock.calls[1][2] ?? [];
        expect(newMenuItems).toHaveLength(1);
        const newItemId = newMenuItems[0].id;

        contextMenuCallback(oldMenuId, null);
        contextMenuCallback(newMenuId, newItemId);

        expect(oldClick).not.toHaveBeenCalled();
        expect(newClick).toHaveBeenCalledTimes(1);
    });
});
