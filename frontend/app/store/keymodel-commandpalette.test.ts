// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

describe("keymodel command palette commands", () => {
    async function loadKeymodel() {
        const api = {
            checkForUpdates: vi.fn(),
            clearTabCache: vi.fn(),
            closeTab: vi.fn(),
            doRefresh: vi.fn(),
            openNewWindow: vi.fn(),
            registerGlobalWebviewKeys: vi.fn(),
            relaunchAllWindows: vi.fn(),
            resetZoom: vi.fn(),
            setActiveTab: vi.fn(),
            setKeyboardChordMode: vi.fn(),
            toggleDevTools: vi.fn(),
            toggleFullScreen: vi.fn(),
            zoomIn: vi.fn(),
            zoomOut: vi.fn(),
        };
        const setConfigCommand = vi.fn();
        const pushModal = vi.fn();

        vi.resetModules();
        vi.doMock("@/app/store/global", () => ({
            atoms: {
                staticTabId: "staticTabId",
                fullConfigAtom: "fullConfigAtom",
                workspaceId: "workspaceId",
                controlShiftDelayAtom: "controlShiftDelayAtom",
                modalOpen: "modalOpen",
                workspace: "workspace",
            },
            createBlock: vi.fn(),
            createBlockSplitHorizontally: vi.fn(),
            createBlockSplitVertically: vi.fn(),
            createTab: vi.fn(),
            getAllBlockComponentModels: vi.fn(() => []),
            getApi: vi.fn(() => api),
            getBlockComponentModel: vi.fn(),
            getFocusedBlockId: vi.fn(),
            getOrefMetaKeyAtom: vi.fn((_oref: string, key: string) => `oref:${key}`),
            getSettingsKeyAtom: vi.fn((key: string) => `settings:${key}`),
            globalStore: {
                get: vi.fn((atom: string) => {
                    if (atom === "settings:app:keybindings") {
                        return {};
                    }
                    if (atom === "fullConfigAtom") {
                        return { backgrounds: {} };
                    }
                    return null;
                }),
                set: vi.fn(),
                sub: vi.fn(),
            },
            recordTEvent: vi.fn(),
            refocusNode: vi.fn(),
            replaceBlock: vi.fn(),
            WOS: {
                makeORef: vi.fn((type: string, id: string) => `${type}:${id}`),
                getWaveObjectAtom: vi.fn((oref: string) => `atom:${oref}`),
            },
        }));
        vi.doMock("@/app/store/tab-model", () => ({
            getActiveTabModel: vi.fn(),
        }));
        vi.doMock("@/app/store/wshclientapi", () => ({
            RpcApi: {
                ActivityCommand: vi.fn(),
                SetConfigCommand: setConfigCommand,
                SetMetaCommand: vi.fn(),
            },
        }));
        vi.doMock("@/app/store/wshrpcutil", () => ({
            TabRpcClient: {},
        }));
        vi.doMock("@/app/view/term/command-composer", () => ({
            CommandComposerActionId: "term:command-composer",
            CommandComposerDefaultBinding: "Ctrl:Shift:a",
            isCommandComposerEnabled: vi.fn(() => false),
        }));
        vi.doMock("@/layout/index", () => ({
            deleteLayoutModelForTab: vi.fn(),
            getLayoutModelForStaticTab: vi.fn(() => ({ focusedNode: "focusedNode" })),
            NavigateDirection: {
                Up: "up",
                Down: "down",
                Left: "left",
                Right: "right",
            },
        }));
        vi.doMock("@/util/util", () => ({
            fireAndForget: vi.fn((fn: () => Promise<unknown> | unknown) => {
                fn();
            }),
        }));
        vi.doMock("./modalmodel", () => ({
            modalsModel: {
                hasOpenModals: vi.fn(() => false),
                popModal: vi.fn(),
                isModalOpen: vi.fn(() => false),
                pushModal,
            },
        }));
        vi.doMock("./windowtype", () => ({
            isBuilderWindow: vi.fn(() => false),
            isTabWindow: vi.fn(() => false),
        }));

        const keymodel = await import("./keymodel");
        keymodel.registerGlobalKeys();

        return {
            api,
            commands: keymodel.getCommandPaletteCommands(),
            pushModal,
            setConfigCommand,
        };
    }

    it("surfaces reload tab and runs the Electron refresh API", async () => {
        const { api, commands } = await loadKeymodel();
        const reloadCommand = commands.find((cmd) => cmd.id === "tab:reload");

        expect(reloadCommand).toMatchObject({
            label: "Reload Tab",
            binding: "Shift:Cmd:r",
        });

        reloadCommand?.run();

        expect(api.doRefresh).toHaveBeenCalledTimes(1);
        expect(api.registerGlobalWebviewKeys).toHaveBeenCalledWith(expect.arrayContaining(["Shift:Cmd:r"]));
    });

    it("surfaces app commands and routes them to Electron APIs or app config", async () => {
        const { api, commands, pushModal, setConfigCommand } = await loadKeymodel();
        const expectedCommands = [
            ["app:new-window", "New Window"],
            ["app:toggle-devtools", "Toggle DevTools"],
            ["app:reset-zoom", "Reset Zoom"],
            ["app:zoom-in", "Zoom In"],
            ["app:zoom-out", "Zoom Out"],
            ["app:toggle-fullscreen", "Toggle Full Screen"],
            ["app:launch-fullscreen-on", "Launch On Full Screen: On"],
            ["app:launch-fullscreen-off", "Launch On Full Screen: Off"],
            ["app:clear-tab-cache", "Clear Tab Cache"],
            ["app:relaunch-all-windows", "Relaunch All Windows"],
            ["app:check-for-updates", "Check for Updates"],
            ["app:about", "About GenieTerm"],
        ];

        expect(commands.map((cmd) => [cmd.id, cmd.label])).toEqual(expect.arrayContaining(expectedCommands));

        commands.find((cmd) => cmd.id === "app:new-window")?.run();
        commands.find((cmd) => cmd.id === "app:toggle-devtools")?.run();
        commands.find((cmd) => cmd.id === "app:reset-zoom")?.run();
        commands.find((cmd) => cmd.id === "app:zoom-in")?.run();
        commands.find((cmd) => cmd.id === "app:zoom-out")?.run();
        commands.find((cmd) => cmd.id === "app:toggle-fullscreen")?.run();
        commands.find((cmd) => cmd.id === "app:launch-fullscreen-on")?.run();
        commands.find((cmd) => cmd.id === "app:launch-fullscreen-off")?.run();
        commands.find((cmd) => cmd.id === "app:clear-tab-cache")?.run();
        commands.find((cmd) => cmd.id === "app:relaunch-all-windows")?.run();
        commands.find((cmd) => cmd.id === "app:check-for-updates")?.run();
        commands.find((cmd) => cmd.id === "app:about")?.run();

        expect(api.openNewWindow).toHaveBeenCalledTimes(1);
        expect(api.toggleDevTools).toHaveBeenCalledTimes(1);
        expect(api.resetZoom).toHaveBeenCalledTimes(1);
        expect(api.zoomIn).toHaveBeenCalledTimes(1);
        expect(api.zoomOut).toHaveBeenCalledTimes(1);
        expect(api.toggleFullScreen).toHaveBeenCalledTimes(1);
        expect(api.clearTabCache).toHaveBeenCalledTimes(1);
        expect(api.relaunchAllWindows).toHaveBeenCalledTimes(1);
        expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
        expect(pushModal).toHaveBeenCalledWith("AboutModal");
        expect(setConfigCommand).toHaveBeenCalledWith({}, { "window:fullscreenonlaunch": true });
        expect(setConfigCommand).toHaveBeenCalledWith({}, { "window:fullscreenonlaunch": false });
    });

    it("does not surface system edit or window management roles", async () => {
        const { commands } = await loadKeymodel();
        const labels = commands.map((cmd) => cmd.label);

        expect(labels).not.toEqual(expect.arrayContaining(["Undo", "Redo", "Cut", "Copy", "Paste", "Select All"]));
        expect(labels).not.toEqual(expect.arrayContaining(["Hide GenieTerm", "Hide Others", "Quit", "Minimize"]));
    });
});
