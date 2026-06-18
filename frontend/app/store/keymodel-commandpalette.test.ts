// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

describe("keymodel command palette commands", () => {
    it("surfaces reload tab and runs the Electron refresh API", async () => {
        const doRefresh = vi.fn();
        const registerGlobalWebviewKeys = vi.fn();

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
            getApi: vi.fn(() => ({
                doRefresh,
                registerGlobalWebviewKeys,
                setKeyboardChordMode: vi.fn(),
                closeTab: vi.fn(),
                setActiveTab: vi.fn(),
            })),
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
                SetConfigCommand: vi.fn(),
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
                pushModal: vi.fn(),
            },
        }));
        vi.doMock("./windowtype", () => ({
            isBuilderWindow: vi.fn(() => false),
            isTabWindow: vi.fn(() => false),
        }));

        const { getCommandPaletteCommands, registerGlobalKeys } = await import("./keymodel");
        registerGlobalKeys();

        const reloadCommand = getCommandPaletteCommands().find((cmd) => cmd.id === "tab:reload");

        expect(reloadCommand).toMatchObject({
            label: "Reload Tab",
            binding: "Shift:Cmd:r",
        });

        reloadCommand?.run();

        expect(doRefresh).toHaveBeenCalledTimes(1);
        expect(registerGlobalWebviewKeys).toHaveBeenCalledWith(expect.arrayContaining(["Shift:Cmd:r"]));
    });
});
