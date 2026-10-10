// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWaveWindowById } from "./emain-window";
import { ElectronWshClientType } from "./emain-wsh";

vi.mock("electron", async () => {
    const { EventEmitter } = await import("node:events");
    return {
        Notification: class extends EventEmitter {
            options: unknown;
            show = vi.fn();
            close = vi.fn(() => this.emit("close"));
            constructor(options: unknown) {
                super();
                this.options = options;
            }
        },
    };
});
vi.mock("@/app/store/services", () => ({}));
vi.mock("@/app/store/wshclient", () => ({ WshClient: class {} }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { WorkspaceListCommand: vi.fn(), SetBlockFocusCommand: vi.fn() },
}));
vi.mock("emain/updater", () => ({}));
vi.mock("./emain-platform", () => ({}));
vi.mock("./emain-web", () => ({}));
vi.mock("./emain-window", () => ({ getWaveWindowById: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

function makeWindow() {
    return {
        isDestroyed: vi.fn(() => false),
        isMinimized: vi.fn(() => true),
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        setActiveTab: vi.fn(async () => {}),
    };
}

describe("native command notifications", () => {
    it.each(["click", "close", "failed"])("retains the notification until %s", async (event) => {
        const client = new ElectronWshClientType();
        const focus = vi.spyOn(client, "focusNotification").mockResolvedValue();
        const opts = { title: "make test", body: "Finished in 10s", silent: false, tabid: "tab-2", blockid: "block-2" };
        await client.handle_notify(null, opts);
        expect(client.notifications.size).toBe(1);
        const notification = [...client.notifications][0];
        expect(notification).toHaveProperty("options", { title: opts.title, body: opts.body, silent: false });
        expect(notification.show).toHaveBeenCalledOnce();
        notification.emit(event);
        expect(client.notifications.size).toBe(0);
        expect(focus).toHaveBeenCalledTimes(event === "click" ? 1 : 0);
    });

    it("keeps untargeted notification behavior", async () => {
        const client = new ElectronWshClientType();
        const focus = vi.spyOn(client, "focusNotification").mockResolvedValue();
        await client.handle_notify(null, { title: "hello" });
        [...client.notifications][0].emit("click");
        expect(focus).not.toHaveBeenCalled();
    });

    it("bounds retained notifications even if the OS does not emit close", async () => {
        const client = new ElectronWshClientType();
        await client.handle_notify(null, { title: "first" });
        const first = [...client.notifications][0];
        vi.mocked(first.close).mockImplementation(() => {});
        for (let i = 0; i < 100; i++) {
            await client.handle_notify(null, { title: String(i) });
        }
        expect(first.close).toHaveBeenCalledOnce();
        expect(client.notifications.size).toBe(100);
        expect(client.notifications.has(first)).toBe(false);
    });

    it("finds an inactive tab through workspace ownership and waits for switching before block focus", async () => {
        const client = new ElectronWshClientType();
        const window = makeWindow();
        let switched: () => void;
        window.setActiveTab.mockImplementation(() => new Promise<void>((resolve) => (switched = resolve)));
        vi.mocked(RpcApi.WorkspaceListCommand).mockResolvedValue([
            { windowid: "window-2", workspacedata: { tabids: ["tab-1", "tab-2"] } } as WorkspaceInfoData,
        ]);
        vi.mocked(getWaveWindowById).mockReturnValue(window as unknown as ReturnType<typeof getWaveWindowById>);
        const pending = client.focusNotification({ tabid: "tab-2", blockid: "block-2" });
        await vi.waitFor(() => expect(window.setActiveTab).toHaveBeenCalledWith("tab-2", true));
        expect(getWaveWindowById).toHaveBeenCalledWith("window-2");
        expect(window.restore).toHaveBeenCalledOnce();
        expect(window.show).toHaveBeenCalledOnce();
        expect(window.focus).toHaveBeenCalledOnce();
        expect(RpcApi.SetBlockFocusCommand).not.toHaveBeenCalled();
        switched();
        await pending;
        expect(RpcApi.SetBlockFocusCommand).toHaveBeenCalledWith(client, "block-2", {
            route: "tab:tab-2",
            timeout: 2000,
        });
    });

    it.each(["closed tab", "closed window", "destroyed window"])("ignores a %s", async (state) => {
        const client = new ElectronWshClientType();
        const window = makeWindow();
        window.isDestroyed.mockReturnValue(state === "destroyed window");
        vi.mocked(RpcApi.WorkspaceListCommand).mockResolvedValue(
            state === "closed tab"
                ? []
                : [{ windowid: "window-2", workspacedata: { tabids: ["tab-2"] } } as WorkspaceInfoData]
        );
        vi.mocked(getWaveWindowById).mockReturnValue(
            state === "closed window" ? null : (window as unknown as ReturnType<typeof getWaveWindowById>)
        );
        await client.focusNotification({ tabid: "tab-2", blockid: "block-2" });
        expect(window.show).not.toHaveBeenCalled();
        expect(RpcApi.SetBlockFocusCommand).not.toHaveBeenCalled();
    });
});
