// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setKeyUtilPlatform } from "@/util/keyutil";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getConfig: vi.fn(),
    configHandler: null as (event: unknown) => void,
    unsubscribe: vi.fn(),
    nextId: 0,
}));

vi.mock("electron", async () => {
    const { EventEmitter } = await import("node:events");
    return {
        WebContentsView: class {
            webContents = Object.assign(new EventEmitter(), {
                id: ++mocks.nextId,
                loadFile: vi.fn(),
                setWindowOpenHandler: vi.fn(),
                paste: vi.fn(),
                isDestroyed: () => false,
                session: {},
            });
            setBackgroundColor = vi.fn();
        },
    };
});
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { GetFullConfigCommand: mocks.getConfig } }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: ({ handler }: { handler: (event: unknown) => void }) => {
        mocks.configHandler = handler;
        return mocks.unsubscribe;
    },
}));
vi.mock("./emain-platform", () => ({ getElectronAppBasePath: () => "/app", unamePlatform: "win32", isDevVite: false }));
vi.mock("./emain-window", () => ({ getWaveWindowById: () => null }));
vi.mock("./emain-wsh", () => ({ ElectronWshClient: {} }));
vi.mock("./authkey", () => ({ configureAuthKeyRequestInjection: vi.fn() }));
vi.mock("./emain-util", () => ({ handleCtrlShiftState: vi.fn(), shNavHandler: vi.fn(), shFrameNavHandler: vi.fn() }));

import { getOrCreateWebViewForTab } from "./emain-tabview";

beforeEach(() => {
    vi.clearAllMocks();
    setKeyUtilPlatform("win32");
    mocks.getConfig.mockResolvedValue({ settings: { "app:ctrlvpaste": true } });
});

describe("Windows menu accelerators", () => {
    it("applies Ctrl+V configuration changes to an already-open tab", async () => {
        const [view] = await getOrCreateWebViewForTab("window", "paste-config");
        const paste = () => {
            const event = { preventDefault: vi.fn() };
            view.webContents.emit("before-input-event", event, {
                type: "keyDown",
                key: "v",
                code: "KeyV",
                control: true,
                shift: false,
                alt: false,
                meta: false,
            });
            return event;
        };
        expect(paste().preventDefault).toHaveBeenCalledOnce();
        expect(view.webContents.paste).toHaveBeenCalledOnce();

        mocks.configHandler({ data: { fullconfig: { settings: { "app:ctrlvpaste": false } } } });
        expect(paste().preventDefault).not.toHaveBeenCalled();
        expect(view.webContents.paste).toHaveBeenCalledOnce();

        mocks.configHandler({ data: { fullconfig: { settings: {} } } });
        expect(paste().preventDefault).toHaveBeenCalledOnce();
        expect(view.webContents.paste).toHaveBeenCalledTimes(2);
        expect(mocks.getConfig).toHaveBeenCalledOnce();
        view.webContents.emit("destroyed");
        expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    });
});
