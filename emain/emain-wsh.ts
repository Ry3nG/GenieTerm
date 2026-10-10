// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WindowService } from "@/app/store/services";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { Notification, net, safeStorage, shell } from "electron";
import { getResolvedUpdateChannel } from "emain/updater";
import { unamePlatform } from "./emain-platform";
import { getWebContentsByBlockId, webGetSelector } from "./emain-web";
import { createBrowserWindow, getWaveWindowById, getWaveWindowByWorkspaceId } from "./emain-window";

const MaxRetainedNotifications = 100;

export class ElectronWshClientType extends WshClient {
    notifications = new Set<Notification>();

    constructor() {
        super("electron");
    }

    async handle_webselector(rh: RpcResponseHelper, data: CommandWebSelectorData): Promise<string[]> {
        if (!data.tabid || !data.blockid || !data.workspaceid) {
            throw new Error("tabid and blockid are required");
        }
        const ww = getWaveWindowByWorkspaceId(data.workspaceid);
        if (ww == null) {
            throw new Error(`no window found with workspace ${data.workspaceid}`);
        }
        const wc = await getWebContentsByBlockId(ww, data.tabid, data.blockid);
        if (wc == null) {
            throw new Error(`no webcontents found with blockid ${data.blockid}`);
        }
        const rtn = await webGetSelector(wc, data.selector, data.opts);
        return rtn;
    }

    async handle_notify(rh: RpcResponseHelper, notificationOptions: WaveNotificationOptions) {
        const notification = new Notification({
            title: notificationOptions.title,
            body: notificationOptions.body,
            silent: notificationOptions.silent,
        });
        const release = () => this.notifications.delete(notification);
        notification.once("close", release);
        notification.once("failed", release);
        notification.once("click", () => {
            release();
            if (notificationOptions.tabid) {
                this.focusNotification(notificationOptions).catch((e) => console.log("notification focus failed", e));
            }
        });
        // Electron must retain the native notification's JS wrapper for click handlers to survive.
        this.notifications.add(notification);
        if (this.notifications.size > MaxRetainedNotifications) {
            const oldest = this.notifications.values().next().value;
            oldest.close();
            this.notifications.delete(oldest);
        }
        try {
            notification.show();
        } catch (e) {
            release();
            throw e;
        }
    }

    async focusNotification({ tabid, blockid }: WaveNotificationOptions) {
        // Shared renderers only register their initial tab in allLoadedTabViews.
        const workspaces = await RpcApi.WorkspaceListCommand(this, { timeout: 5000 });
        const owner = workspaces?.find((entry) => entry.workspacedata?.tabids?.includes(tabid));
        const ww = owner?.windowid ? getWaveWindowById(owner.windowid) : null;
        if (ww == null || ww.isDestroyed()) {
            return;
        }
        if (ww.isMinimized()) {
            ww.restore();
        }
        ww.show();
        ww.focus();
        await ww.setActiveTab(tabid, true);
        if (blockid) {
            await RpcApi.SetBlockFocusCommand(this, blockid, { route: `tab:${tabid}`, timeout: 2000 });
        }
    }

    async handle_getupdatechannel(rh: RpcResponseHelper): Promise<string> {
        return getResolvedUpdateChannel();
    }

    async handle_focuswindow(rh: RpcResponseHelper, windowId: string) {
        console.log(`focuswindow ${windowId}`);
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        let ww = getWaveWindowById(windowId);
        if (ww == null) {
            const window = await WindowService.GetWindow(windowId);
            if (window == null) {
                throw new Error(`window ${windowId} not found`);
            }
            ww = await createBrowserWindow(window, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
        }
        ww.focus();
    }

    async handle_electronencrypt(
        rh: RpcResponseHelper,
        data: CommandElectronEncryptData
    ): Promise<CommandElectronEncryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = safeStorage.encryptString(data.plaintext);
        const ciphertext = encrypted.toString("base64");

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            ciphertext,
            storagebackend,
        };
    }

    async handle_electrondecrypt(
        rh: RpcResponseHelper,
        data: CommandElectronDecryptData
    ): Promise<CommandElectronDecryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = Buffer.from(data.ciphertext, "base64");
        const plaintext = safeStorage.decryptString(encrypted);

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            plaintext,
            storagebackend,
        };
    }

    async handle_networkonline(rh: RpcResponseHelper): Promise<boolean> {
        return net.isOnline();
    }

    async handle_electronsystembell(rh: RpcResponseHelper): Promise<void> {
        shell.beep();
    }

    // async handle_workspaceupdate(rh: RpcResponseHelper) {
    //     console.log("workspaceupdate");
    //     fireAndForget(async () => {
    //         console.log("workspace menu clicked");
    //         const updatedWorkspaceMenu = await getWorkspaceMenu();
    //         const workspaceMenu = Menu.getApplicationMenu().getMenuItemById("workspace-menu");
    //         workspaceMenu.submenu = Menu.buildFromTemplate(updatedWorkspaceMenu);
    //     });
    // }
}

export let ElectronWshClient: ElectronWshClientType;

export function initElectronWshClient() {
    ElectronWshClient = new ElectronWshClientType();
}
