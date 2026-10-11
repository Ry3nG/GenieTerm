// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { app, dialog, ipcMain, net, Notification, shell } from "electron";
import type { UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import { autoUpdater } from "electron-updater";
import { existsSync, readFileSync } from "fs";
import path from "path";
import semver from "semver";
import YAML from "yaml";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { isDev } from "../frontend/util/isdev";
import { fireAndForget } from "../frontend/util/util";
import { setUserConfirmedQuit } from "./emain-activity";
import { delay } from "./emain-util";
import { getWaveSrvProc } from "./emain-wavesrv";
import { focusedWaveWindow, getAllWaveWindows } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import {
    getDownloadedUpdateSha512,
    getMacAppBundlePath,
    getMacInstallLocationProblem,
    hasDeveloperIdSignature,
    isMacCodeSignatureError,
    launchMacUpdateInstaller,
} from "./mac-update-installer";
import { formatReleaseNotes } from "./update-release-notes";
import { usesPackageManagerUpdates } from "./updater-platform";

const ReleasesUrl = "https://github.com/Ry3nG/GenieTerm/releases";
const UpdateFeedUrl = "https://github.com/Ry3nG/GenieTerm/releases/latest/download/";
const ChannelFileNotFoundCode = "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND";

export let updater: Updater;

function isChannelFileNotFoundError(error: unknown): boolean {
    return (error as { code?: string })?.code == ChannelFileNotFoundCode;
}

async function checkMacDeveloperIdSignature(): Promise<boolean> {
    if (process.platform != "darwin") {
        return false;
    }
    try {
        return await hasDeveloperIdSignature(getMacAppBundlePath(process.execPath));
    } catch (error) {
        console.warn("unable to check the macOS code signature", error);
        return false;
    }
}

function getUpdateChannel(settings: SettingsType): string {
    const updaterConfigPath = path.join(process.resourcesPath!, "app-update.yml");
    // package-managed Linux builds ship without updater config; they follow the stable feed
    const updaterConfig = existsSync(updaterConfigPath)
        ? YAML.parse(readFileSync(updaterConfigPath, { encoding: "utf8" }).toString())
        : {};
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
    if (retVal != "latest") {
        // The feed only serves the latest stable GitHub Release; its channel metadata points at the stable build.
        console.log(`Prereleases are not served on the ${retVal} channel; install them manually from ${ReleasesUrl}.`);
    }
    return retVal;
}

export class Updater {
    autoCheckInterval: NodeJS.Timeout | null;
    intervalms: number;
    autoCheckEnabled: boolean;
    availableUpdateReleaseName: string | null;
    availableUpdateReleaseNotes: string | null;
    availableUpdateInfo: UpdateInfo | null;
    availableUpdateFilePath: string | null;
    availableUpdateSha512: string | null;
    installPromptInProgress: boolean;
    installOnQuitSetting: boolean;
    macDeveloperIdSigned: Promise<boolean>;
    squirrelRejectedUpdate: boolean;
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
        this.availableUpdateFilePath = null;
        this.availableUpdateSha512 = null;
        this.installPromptInProgress = false;
        this.installOnQuitSetting = settings["autoupdate:installonquit"];
        this.squirrelRejectedUpdate = false;

        autoUpdater.autoDownload = !usesPackageManagerUpdates();
        // On macOS, install-on-quit goes through Squirrel.Mac, which rejects builds without a Developer ID
        // signature. Keep it off until the signature check below confirms Squirrel can be used.
        autoUpdater.autoInstallOnAppQuit =
            process.platform != "darwin" && !usesPackageManagerUpdates() && this.installOnQuitSetting;
        console.log("Download update automatically:", autoUpdater.autoDownload);
        this.macDeveloperIdSigned = checkMacDeveloperIdSignature();
        if (process.platform == "darwin") {
            fireAndForget(async () => {
                const signed = await this.macDeveloperIdSigned;
                if (signed) {
                    autoUpdater.autoInstallOnAppQuit = this.installOnQuitSetting;
                    console.log("Install update on quit:", this.installOnQuitSetting);
                    return;
                }
                console.log(
                    "Install update on quit: unavailable (no Developer ID signature); updates install via Restart Now"
                );
            });
        } else {
            console.log("Install update on quit:", this.installOnQuitSetting);
        }

        // Only update the release channel if it's specified, otherwise use the one configured in the updater.
        autoUpdater.channel = getUpdateChannel(settings);
        autoUpdater.allowDowngrade = false;

        autoUpdater.removeAllListeners();

        autoUpdater.on("error", (err) => {
            console.log("updater error");
            console.log(err);
            if (process.platform == "darwin" && isMacCodeSignatureError(err)) {
                this.squirrelRejectedUpdate = true;
                if (!this.availableUpdateFilePath) {
                    return;
                }
                console.warn("Squirrel.Mac rejected the update; the verified fallback installer will be used.");
                const wasInstalling = this.status == "installing";
                this.status = "ready";
                if (wasInstalling) {
                    fireAndForget(this.installUpdate.bind(this));
                }
                return;
            }
            if (isChannelFileNotFoundError(err)) {
                console.log("the latest release has no update metadata for this platform and channel");
                if (this.status != "ready" && this.status != "installing") {
                    this.status = "up-to-date";
                }
                return;
            }
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
            this.availableUpdateFilePath = null;
            this.availableUpdateSha512 = null;
            this.status = "up-to-date";
        });

        autoUpdater.on("update-downloaded", (event: UpdateDownloadedEvent) => {
            console.log("update-downloaded", [event]);
            this.setAvailableUpdate(event);
            this.availableUpdateFilePath = event.downloadedFile;
            this.availableUpdateSha512 = getDownloadedUpdateSha512(event);

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

    // .deb installs only need to know a newer version exists; the AppImage manifest for this
    // architecture carries the released version
    async checkPackageFeed(): Promise<{ isUpdateAvailable: boolean }> {
        if (this.status != "manual") {
            this.status = "checking";
        }
        const manifest = process.arch == "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";
        const resp = await net.fetch(UpdateFeedUrl + manifest);
        if (!resp.ok) {
            throw new Error(`update feed returned ${resp.status} for ${manifest}`);
        }
        const info = YAML.parse(await resp.text()) as UpdateInfo;
        const current = app.getVersion();
        const isUpdateAvailable = semver.valid(info?.version) != null && semver.gt(info.version, current);
        if (!isUpdateAvailable) {
            this.status = "up-to-date";
            return { isUpdateAvailable };
        }
        this.setAvailableUpdate(info);
        this.status = "manual";
        return { isUpdateAvailable };
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
        if (userInput && this.status == "manual") {
            await this.showPackageUpdateDialog();
            return;
        }
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
            let result: { isUpdateAvailable: boolean };
            try {
                result = usesPackageManagerUpdates()
                    ? await this.checkPackageFeed()
                    : await autoUpdater.checkForUpdates();
            } catch (error) {
                if (!isChannelFileNotFoundError(error)) {
                    throw error;
                }
                result = null;
            }

            if (userInput && !result?.isUpdateAvailable) {
                const channel = autoUpdater.channel ?? "latest";
                const dialogOpts: Electron.MessageBoxOptions = {
                    type: "info",
                    message: "There are currently no updates available.",
                    detail:
                        channel == "latest"
                            ? undefined
                            : `Automatic updates on the ${channel} channel deliver stable releases. Prereleases are installed manually from ${ReleasesUrl}.`,
                };
                if (focusedWaveWindow) {
                    dialog.showMessageBox(focusedWaveWindow, dialogOpts);
                }
            }
            if (userInput && result?.isUpdateAvailable) {
                if (this.status == "ready" || this.status == "manual") {
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
        if (this.status == "manual") {
            await this.showPackageUpdateDialog();
            return;
        }
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
        const installOnQuitAvailable = autoUpdater.autoInstallOnAppQuit && !this.squirrelRejectedUpdate;
        const laterNote = installOnQuitAvailable
            ? " If you choose Later, it installs when you quit GenieTerm."
            : " If you choose Later, GenieTerm will ask again; this build does not install updates on quit.";
        const dialogOpts: Electron.MessageBoxOptions = {
            type: "info",
            buttons: ["Restart Now", "Later"],
            defaultId: 0,
            cancelId: 1,
            title: "GenieTerm Update",
            message: `${releaseTitle} is ready to install.`,
            detail: `Restart GenieTerm now to finish installing the update.${laterNote}${releaseNotes}`,
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
        if (this.status != "ready") {
            return;
        }
        if (process.platform == "darwin" && (this.squirrelRejectedUpdate || !(await this.macDeveloperIdSigned))) {
            await this.installMacUpdateWithHelper();
            return;
        }

        this.status = "installing";
        try {
            await delay(1000);
            setUserConfirmedQuit(true);
            autoUpdater.quitAndInstall();
        } catch (error) {
            await this.showInstallerLaunchError(error);
        }
    }

    /**
     * Installs a downloaded macOS update without Squirrel.Mac, which requires a Developer ID signature.
     * GenieTerm only quits once the app location is known to be replaceable and the helper is running.
     */
    async installMacUpdateWithHelper() {
        let appPath: string;
        try {
            appPath = getMacAppBundlePath(process.execPath);
        } catch (error) {
            await this.showManualInstallDialog(String(error));
            return;
        }
        const locationProblem = getMacInstallLocationProblem(appPath);
        if (locationProblem) {
            await this.showManualInstallDialog(locationProblem);
            return;
        }

        this.status = "installing";
        try {
            if (!this.availableUpdateFilePath || !this.availableUpdateInfo?.version || !this.availableUpdateSha512) {
                throw new Error("The downloaded macOS update is missing required installer metadata.");
            }
            await launchMacUpdateInstaller({
                execPath: process.execPath,
                updateZipPath: this.availableUpdateFilePath,
                expectedVersion: this.availableUpdateInfo.version,
                expectedSha512: this.availableUpdateSha512,
                logPath: path.join(app.getPath("logs"), "updater-helper.log"),
                waveSrvPid: getWaveSrvProc()?.pid,
            });
            autoUpdater.autoInstallOnAppQuit = false;
            setUserConfirmedQuit(true);
            app.quit();
        } catch (error) {
            await this.showInstallerLaunchError(error);
        }
    }

    async showInstallerLaunchError(error: unknown) {
        console.error("unable to launch update installer", error);
        this.status = "ready";
        await dialog.showMessageBox({
            type: "error",
            title: "GenieTerm Update",
            message: "GenieTerm could not start the update installer.",
            detail: "The update is still downloaded. Try Restart Now again or install the latest release manually.",
        });
    }

    async showPackageUpdateDialog() {
        const version = this.availableUpdateInfo?.version;
        const releasePageUrl = version ? `${ReleasesUrl}/tag/v${version}` : `${ReleasesUrl}/latest`;
        const arch = process.arch == "arm64" ? "arm64" : "amd64";
        const { response } = await dialog.showMessageBox({
            type: "info",
            buttons: ["Open Release Page", "Later"],
            defaultId: 0,
            cancelId: 1,
            title: "GenieTerm Update",
            message: `${this.availableUpdateReleaseName ?? `GenieTerm ${version ?? ""}`.trim()} is available.`,
            detail: `This copy of GenieTerm was installed with a system package, so it updates the same way: download the new .deb for ${arch} from the release page and open it, or install it with\n\nsudo apt install ./<downloaded .deb>\n\nThe AppImage build updates itself instead.`,
        });
        if (response == 0) {
            await shell.openExternal(releasePageUrl);
        }
    }

    async showManualInstallDialog(reason: string) {
        console.warn("macOS update cannot be installed in place:", reason);
        const version = this.availableUpdateInfo?.version;
        const releasePageUrl = version ? `${ReleasesUrl}/tag/v${version}` : `${ReleasesUrl}/latest`;
        const canRevealDownload = this.availableUpdateFilePath != null;
        const buttons = canRevealDownload
            ? ["Open Release Page", "Show Downloaded Update", "Cancel"]
            : ["Open Release Page", "Cancel"];
        const { response } = await dialog.showMessageBox({
            type: "warning",
            buttons,
            defaultId: 0,
            cancelId: buttons.length - 1,
            title: "GenieTerm Update",
            message: "GenieTerm can't install this update automatically.",
            detail: `${reason}\n\nGenieTerm is still running. To install manually, download the macOS zip from the release page, quit GenieTerm, and replace GenieTerm.app with the one in the zip.`,
        });
        if (response == 0) {
            await shell.openExternal(releasePageUrl);
            return;
        }
        if (canRevealDownload && response == 1) {
            shell.showItemInFolder(this.availableUpdateFilePath);
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
