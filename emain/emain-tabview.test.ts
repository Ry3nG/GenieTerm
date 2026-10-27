// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setKeyUtilPlatform } from "@/util/keyutil";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getConfig: vi.fn(),
    configHandler: null as (event: unknown) => void,
    unsubscribe: vi.fn(),
    nextId: 0,
    platform: "win32",
    closeWindow: vi.fn(),
    getWindow: vi.fn(),
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
                send: vi.fn(),
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
vi.mock("./emain-platform", () => ({
    getElectronAppBasePath: () => "/app",
    get unamePlatform() {
        return mocks.platform;
    },
    isDevVite: false,
}));
vi.mock("./emain-window", () => ({ getWaveWindowById: mocks.getWindow }));
vi.mock("./emain-wsh", () => ({ ElectronWshClient: {} }));
vi.mock("./authkey", () => ({ configureAuthKeyRequestInjection: vi.fn() }));
vi.mock("./emain-util", () => ({ handleCtrlShiftState: vi.fn(), shNavHandler: vi.fn(), shFrameNavHandler: vi.fn() }));

import { getOrCreateWebViewForTab } from "./emain-tabview";

beforeEach(() => {
    vi.clearAllMocks();
    setKeyUtilPlatform("win32");
    mocks.platform = "win32";
    mocks.getWindow.mockReturnValue({ close: mocks.closeWindow });
    mocks.getConfig.mockResolvedValue({ settings: { "app:ctrlvpaste": true } });
});

describe("Windows menu accelerators", () => {
    it.each([false, true])(
        "closes the containing window for Alt+F4 before terminal or chord input (chord=%s)",
        async (chord) => {
            const [view] = await getOrCreateWebViewForTab("window", `close-window-${chord}`);
            view.keyboardChordMode = chord;
            const event = { preventDefault: vi.fn() };
            view.webContents.emit("before-input-event", event, {
                type: "keyDown",
                key: "F4",
                code: "F4",
                alt: true,
                control: false,
                shift: false,
                meta: false,
            });
            expect(mocks.getWindow).toHaveBeenCalledWith("window");
            expect(mocks.closeWindow).toHaveBeenCalledOnce();
            expect(event.preventDefault).toHaveBeenCalledOnce();
            expect(view.webContents.send).not.toHaveBeenCalled();
        }
    );

    it.each([{ type: "keyUp" }, { control: true }, { shift: true }, { meta: true }, { alt: false }])(
        "preserves other F4 key combinations: %j",
        async (overrides) => {
            const [view] = await getOrCreateWebViewForTab("window", `other-f4-${JSON.stringify(overrides)}`);
            const event = { preventDefault: vi.fn() };
            view.webContents.emit("before-input-event", event, {
                type: "keyDown",
                key: "F4",
                code: "F4",
                alt: true,
                control: false,
                shift: false,
                meta: false,
                ...overrides,
            });
            expect(mocks.closeWindow).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
    );

    it("leaves non-Windows Alt+F4 handling unchanged", async () => {
        mocks.platform = "darwin";
        setKeyUtilPlatform("darwin");
        const [view] = await getOrCreateWebViewForTab("window", "mac-alt-f4");
        const event = { preventDefault: vi.fn() };
        view.webContents.emit("before-input-event", event, {
            type: "keyDown",
            key: "F4",
            code: "F4",
            alt: true,
            control: false,
            shift: false,
            meta: false,
        });
        expect(mocks.closeWindow).not.toHaveBeenCalled();
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

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
