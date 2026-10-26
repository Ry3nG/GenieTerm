// Copyright 2026, GenieTerm. Apache-2.0.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    listeners: new Map<string, (...args: any[]) => void>(),
    showMessageBox: vi.fn(),
    confirmedQuit: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    send: vi.fn(),
    readConfig: vi.fn(),
    setConfig: vi.fn(),
}));

vi.mock("electron", () => ({
    app: { getVersion: () => "0.4.94-beta.2" },
    dialog: { showMessageBox: mocks.showMessageBox },
    ipcMain: { on: vi.fn() },
    net: { fetch: vi.fn() },
    Notification: vi.fn(),
    shell: { openExternal: vi.fn() },
}));
vi.mock("electron-updater", () => ({
    autoUpdater: {
        channel: "latest",
        checkForUpdates: mocks.checkForUpdates,
        quitAndInstall: mocks.quitAndInstall,
        removeAllListeners: () => mocks.listeners.clear(),
        on: (event: string, listener: (...args: any[]) => void) => mocks.listeners.set(event, listener),
    },
}));
vi.mock("fs", () => ({ existsSync: () => true, readFileSync: mocks.readConfig }));
vi.mock("../frontend/app/store/wshclientapi", () => ({ RpcApi: { SetConfigCommand: mocks.setConfig } }));
vi.mock("../frontend/util/isdev", () => ({ isDev: () => false }));
vi.mock("./emain-activity", () => ({ setUserConfirmedQuit: mocks.confirmedQuit }));
vi.mock("./emain-util", () => ({ delay: () => Promise.resolve() }));
vi.mock("./emain-wavesrv", () => ({ getWaveSrvProc: () => null }));
vi.mock("./emain-window", () => {
    const window = { allLoadedTabViews: new Map([["tab", { webContents: { send: mocks.send } }]]) };
    return { focusedWaveWindow: window, getAllWaveWindows: () => [window] };
});
vi.mock("./emain-wsh", () => ({ ElectronWshClient: {} }));
vi.mock("./mac-update-installer", () => ({
    getDownloadedUpdateSha512: (event: { sha512: string }) => event.sha512,
    getMacAppBundlePath: vi.fn(),
    getMacInstallLocationProblem: vi.fn(),
    hasDeveloperIdSignature: vi.fn(),
    isMacCodeSignatureError: vi.fn(),
    launchMacUpdateInstaller: vi.fn(),
}));

import { autoUpdater } from "electron-updater";
import { Updater } from "./updater";

const Settings = {
    "autoupdate:enabled": true,
    "autoupdate:installonquit": false,
    "autoupdate:intervalms": 3600000,
    "autoupdate:channel": "latest",
} as SettingsType;
const DownloadedUpdate = {
    version: "1.5.0",
    downloadedFile: "C:\\Users\\me\\AppData\\Local\\genieterm-updater\\pending\\update.exe",
    sha512: "verified-installer-hash",
    releaseNotes: "# GenieTerm 1.5\n\nWindows is now available.",
};
const OriginalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const OriginalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");

describe("Windows updater", () => {
    beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "win32", configurable: true });
        Object.defineProperty(process, "resourcesPath", { value: "C:\\GenieTerm\\resources", configurable: true });
        vi.clearAllMocks();
        mocks.listeners.clear();
        mocks.readConfig.mockReturnValue("provider: generic\nchannel: latest\n");
        mocks.showMessageBox.mockResolvedValue({ response: 1 });
        mocks.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false });
        mocks.quitAndInstall.mockReset();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        Object.defineProperty(process, "platform", OriginalPlatform);
        if (OriginalResourcesPath) {
            Object.defineProperty(process, "resourcesPath", OriginalResourcesPath);
        } else {
            Reflect.deleteProperty(process, "resourcesPath");
        }
        vi.restoreAllMocks();
    });

    it("downloads Windows updates without allowing downgrades or opting into install-on-quit", () => {
        new Updater(Settings);
        expect(autoUpdater.autoDownload).toBe(true);
        expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
        expect(autoUpdater.allowDowngrade).toBe(false);
        expect(autoUpdater.channel).toBe("latest");
        new Updater({ ...Settings, "autoupdate:installonquit": true });
        expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    it("keeps a beta user's channel and prevents a stable install from silently rewriting it", () => {
        new Updater({ ...Settings, "autoupdate:channel": "beta" });
        expect(autoUpdater.channel).toBe("beta");
        expect(autoUpdater.allowDowngrade).toBe(false);
        expect(mocks.setConfig).not.toHaveBeenCalled();
    });

    it("leaves a downloaded installer ready when a later check lacks channel metadata", async () => {
        const updater = new Updater(Settings);
        mocks.listeners.get("update-downloaded")(DownloadedUpdate);
        await Promise.resolve();
        mocks.listeners.get("error")(Object.assign(new Error("404"), { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" }));
        mocks.listeners.get("checking-for-update")();
        mocks.listeners.get("download-progress")();
        expect(updater.status).toBe("ready");
        expect(updater.availableUpdateFilePath).toBe(DownloadedUpdate.downloadedFile);
        expect(mocks.send).toHaveBeenCalledWith("app-update-status", "ready");
        expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    });

    it("invokes the NSIS updater only after an installer is downloaded", async () => {
        const updater = new Updater(Settings);
        await updater.installUpdate();
        expect(mocks.quitAndInstall).not.toHaveBeenCalled();
        mocks.listeners.get("update-downloaded")(DownloadedUpdate);
        await updater.installUpdate();
        expect(updater.status).toBe("installing");
        expect(mocks.confirmedQuit).toHaveBeenCalledWith(true);
        expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1);
        await updater.installUpdate();
        expect(mocks.quitAndInstall).toHaveBeenCalledTimes(1);
    });

    it("retains a downloaded installer for retry when launching NSIS fails", async () => {
        const updater = new Updater(Settings);
        mocks.listeners.get("update-downloaded")(DownloadedUpdate);
        mocks.quitAndInstall.mockImplementationOnce(() => {
            throw new Error("installer access denied");
        });
        await updater.installUpdate();
        expect(updater.status).toBe("ready");
        expect(updater.availableUpdateFilePath).toBe(DownloadedUpdate.downloadedFile);
        expect(mocks.showMessageBox).toHaveBeenCalledWith(
            expect.objectContaining({ type: "error", message: "GenieTerm could not start the update installer." })
        );
        await updater.installUpdate();
        expect(mocks.quitAndInstall).toHaveBeenCalledTimes(2);
        expect(updater.status).toBe("installing");
    });

    it("reports network failures instead of telling users they are up to date", async () => {
        const updater = new Updater(Settings);
        mocks.checkForUpdates.mockRejectedValueOnce(new Error("network unavailable"));
        await updater.checkForUpdates(true);
        expect(mocks.showMessageBox).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ type: "warning", message: "GenieTerm couldn't check for updates." })
        );
    });
});
