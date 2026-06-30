// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { dialog, ipcMain, Notification } from "electron";
import type { UpdateInfo } from "electron-updater";
import { autoUpdater } from "electron-updater";
import { readFileSync } from "fs";
import path from "path";
import YAML from "yaml";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { isDev } from "../frontend/util/isdev";
import { fireAndForget } from "../frontend/util/util";
import { setUserConfirmedQuit } from "./emain-activity";
import { focusedWaveWindow, getAllWaveWindows } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import { formatReleaseNotes } from "./update-release-notes";

export let updater: Updater;

function getUpdateChannel(settings: SettingsType): string {
    const updaterConfigPath = path.join(process.resourcesPath!, "app-update.yml");
    const updaterConfig = YAML.parse(readFileSync(updaterConfigPath, { encoding: "utf8" }).toString());
    console.log("Updater config from binary:", updaterConfig);
    const updaterChannel: string = updaterConfig.channel ?? "latest";
    const settingsChannel = settings["autoupdate:channel"];
    let retVal = settingsChannel;

    // If the user setting doesn't exist yet, set it to the value of the updater config.
    // If the user was previously on the `latest` channel and has downloaded a `beta` version, update their configured channel to `beta` to prevent downgrading.
    if (!settingsChannel || (settingsChannel == "latest" && updaterChannel == "beta")) {
        console.log("Update channel setting does not exist, setting to value from updater config.");
        RpcApi.SetConfigCommand(ElectronWshClient, { "autoupdate:channel": updaterChannel });
        retVal = updaterChannel;
    }
    console.log("Update channel:", retVal);
    return retVal;
}

export class Updater {
    autoCheckInterval: NodeJS.Timeout | null;
    intervalms: number;
    autoCheckEnabled: boolean;
    availableUpdateReleaseName: string | null;
    availableUpdateReleaseNotes: string | null;
    availableUpdateInfo: UpdateInfo | null;
    installPromptInProgress: boolean;
    private _status: UpdaterStatus;
    lastUpdateCheck: Date;

    constructor(settings: SettingsType) {
        this.intervalms = settings["autoupdate:intervalms"];
        console.log("Update check interval in milliseconds:", this.intervalms);
        this.autoCheckEnabled = settings["autoupdate:enabled"];
        console.log("Update check enabled:", this.autoCheckEnabled);

        this._status = "up-to-date";
        this.lastUpdateCheck = new Date(0);
        this.autoCheckInterval = null;
        this.availableUpdateReleaseName = null;
        this.availableUpdateReleaseNotes = null;
        this.availableUpdateInfo = null;
        this.installPromptInProgress = false;

        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = settings["autoupdate:installonquit"];
        console.log("Download update automatically:", autoUpdater.autoDownload);
        console.log("Install update on quit:", settings["autoupdate:installonquit"]);

        // Only update the release channel if it's specified, otherwise use the one configured in the updater.
        autoUpdater.channel = getUpdateChannel(settings);
        autoUpdater.allowDowngrade = false;

        autoUpdater.removeAllListeners();

        autoUpdater.on("error", (err) => {
            console.log("updater error");
            console.log(err);
            if (!err.toString()?.includes("net::ERR_INTERNET_DISCONNECTED")) this.status = "error";
        });

        autoUpdater.on("checking-for-update", () => {
            console.log("checking-for-update");
            if (this.status == "ready" || this.status == "installing") {
                return;
            }
            this.status = "checking";
        });

        autoUpdater.on("update-available", (event) => {
            console.log("update-available", [event]);
            this.setAvailableUpdate(event);
            if (this.status != "ready") {
                this.status = "downloading";
            }
        });

        autoUpdater.on("download-progress", () => {
            if (this.status != "ready" && this.status != "installing") {
                this.status = "downloading";
            }
        });

        autoUpdater.on("update-not-available", () => {
            console.log("update-not-available");
            this.availableUpdateInfo = null;
            this.availableUpdateReleaseName = null;
            this.availableUpdateReleaseNotes = null;
            this.status = "up-to-date";
        });

        autoUpdater.on("update-downloaded", (event) => {
            console.log("update-downloaded", [event]);
            this.setAvailableUpdate(event);

            this.status = "ready";
            const allWindows = getAllWaveWindows();
            if (allWindows.length > 0) {
                fireAndForget(this.promptToInstallUpdate.bind(this));
                return;
            }
            const updateNotification = new Notification({
                title: "GenieTerm Update Ready",
                body: `${this.availableUpdateReleaseName ?? "A new GenieTerm update"} is ready to install.`,
            });
            updateNotification.on("click", () => {
                fireAndForget(this.promptToInstallUpdate.bind(this));
            });
            updateNotification.show();
        });
    }

    /**
     * The status of the Updater.
     */
    get status(): UpdaterStatus {
        return this._status;
    }

    private set status(value: UpdaterStatus) {
        this._status = value;
        getAllWaveWindows().forEach((window) => {
            const allTabs = Array.from(window.allLoadedTabViews.values());
            allTabs.forEach((tab) => {
                tab.webContents.send("app-update-status", value);
            });
        });
    }

    private setAvailableUpdate(updateInfo: UpdateInfo) {
        this.availableUpdateInfo = updateInfo;
        this.availableUpdateReleaseName = updateInfo.releaseName ?? `GenieTerm ${updateInfo.version}`;
        this.availableUpdateReleaseNotes = formatReleaseNotes(updateInfo.releaseNotes);
    }

    /**
     * Check for updates and start the background update check, if configured.
     */
    async start() {
        if (this.autoCheckEnabled) {
            console.log("starting updater");
            this.autoCheckInterval = setInterval(() => {
                fireAndForget(() => this.checkForUpdates(false));
            }, 600000); // intervals are unreliable when an app is suspended so we will check every 10 mins if the interval has passed.
            await this.checkForUpdates(false);
        }
    }

    /**
     * Stop the background update check, if configured.
     */
    stop() {
        console.log("stopping updater");
        if (this.autoCheckInterval) {
            clearInterval(this.autoCheckInterval);
            this.autoCheckInterval = null;
        }
    }

    /**
     * Checks if the configured interval time has passed since the last update check, and if so, checks for updates using the `autoUpdater` object
     * @param userInput Whether the user is requesting this. If so, an alert will report the result of the check.
     */
    async checkForUpdates(userInput: boolean) {
        if (userInput && this.status == "ready") {
            await this.promptToInstallUpdate();
            return;
        }
        if (userInput && (this.status == "available" || this.status == "downloading" || this.status == "checking")) {
            await this.showUpdateDownloadingMessage();
            return;
        }

        const now = new Date();

        // Run an update check always if the user requests it, otherwise only if there's an active update check interval and enough time has elapsed.
        if (
            userInput ||
            (this.autoCheckInterval &&
                (!this.lastUpdateCheck || Math.abs(now.getTime() - this.lastUpdateCheck.getTime()) > this.intervalms))
        ) {
            const result = await autoUpdater.checkForUpdates();

            if (userInput && !result?.isUpdateAvailable) {
                const dialogOpts: Electron.MessageBoxOptions = {
                    type: "info",
                    message: "There are currently no updates available.",
                };
                if (focusedWaveWindow) {
                    dialog.showMessageBox(focusedWaveWindow, dialogOpts);
                }
            }
            if (userInput && result?.isUpdateAvailable) {
                if (this.status == "ready") {
                    await this.promptToInstallUpdate();
                } else {
                    await this.showUpdateDownloadingMessage();
                }
            }

            // Only update the last check time if this is an automatic check. This ensures the interval remains consistent.
            if (!userInput) this.lastUpdateCheck = now;
        }
    }

    async showUpdateDownloadingMessage() {
        if (this.status == "ready") {
            await this.promptToInstallUpdate();
            return;
        }

        const releaseTitle = this.availableUpdateReleaseName ?? "A GenieTerm update";
        const isChecking = this.status == "checking" && !this.availableUpdateInfo;
        const dialogOpts: Electron.MessageBoxOptions = {
            type: "info",
            title: "GenieTerm Update",
            message: isChecking
                ? "GenieTerm is checking for updates."
                : `${releaseTitle} is downloading in the background.`,
            detail: isChecking
                ? "GenieTerm will let you know if an update is available."
                : "GenieTerm will let you know when it is ready to install.",
        };

        const allWindows = getAllWaveWindows();
        if (allWindows.length > 0) {
            await dialog.showMessageBox(focusedWaveWindow ?? allWindows[0], dialogOpts);
        } else {
            const updateNotification = new Notification({
                title: "GenieTerm Update",
                body: isChecking
                    ? "GenieTerm is checking for updates."
                    : `${releaseTitle} is downloading in the background.`,
            });
            updateNotification.show();
        }
    }

    /**
     * Prompts the user to install the downloaded application update and restarts the application
     */
    async promptToInstallUpdate() {
        if (this.status == "available" || this.status == "downloading" || this.status == "checking") {
            await this.showUpdateDownloadingMessage();
            return;
        }
        if (this.status != "ready") {
            return;
        }
        if (this.installPromptInProgress) {
            return;
        }
        this.installPromptInProgress = true;

        const releaseTitle = this.availableUpdateReleaseName ?? "A GenieTerm update";
        const releaseNotes = this.availableUpdateReleaseNotes ? `\n\n${this.availableUpdateReleaseNotes}` : "";
        const dialogOpts: Electron.MessageBoxOptions = {
            type: "info",
            buttons: ["Restart Now", "Later"],
            defaultId: 0,
            cancelId: 1,
            title: "GenieTerm Update",
            message: `${releaseTitle} is ready to install.`,
            detail: `Restart GenieTerm now to finish installing the update.${releaseNotes}`,
        };

        try {
            const allWindows = getAllWaveWindows();
            if (allWindows.length > 0) {
                await dialog.showMessageBox(focusedWaveWindow ?? allWindows[0], dialogOpts).then(({ response }) => {
                    if (response === 0) {
                        fireAndForget(this.installUpdate.bind(this));
                    }
                });
            }
        } finally {
            this.installPromptInProgress = false;
        }
    }

    /**
     * Restarts the app and installs an update if it is available.
     */
    async installUpdate() {
        if (this.status == "ready") {
            this.status = "installing";
            setUserConfirmedQuit(true);
            autoUpdater.quitAndInstall();
        }
    }
}

export function getResolvedUpdateChannel(): string {
    return isDev() ? "dev" : (autoUpdater.channel ?? "latest");
}

ipcMain.on("install-app-update", () => fireAndForget(updater?.promptToInstallUpdate.bind(updater)));
ipcMain.on("get-app-update-status", (event) => {
    event.returnValue = updater?.status;
});
ipcMain.on("get-updater-channel", (event) => {
    event.returnValue = getResolvedUpdateChannel();
});

let autoUpdateLock = false;

/**
 * Configures the auto-updater based on the user's preference
 */
export async function configureAutoUpdater() {
    if (isDev()) {
        console.log("skipping auto-updater in dev mode");
        return;
    }

    // simple lock to prevent multiple auto-update configuration attempts, this should be very rare
    if (autoUpdateLock) {
        console.log("auto-update configuration already in progress, skipping");
        return;
    }
    autoUpdateLock = true;

    try {
        console.log("Configuring updater");
        const settings = (await RpcApi.GetFullConfigCommand(ElectronWshClient)).settings;
        updater = new Updater(settings);
        await updater.start();
    } catch (e) {
        console.warn("error configuring updater", e.toString());
    }

    autoUpdateLock = false;
}
