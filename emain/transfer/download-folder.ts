import * as electron from "electron";
import fs from "fs";
import * as child_process from "node:child_process";
import * as path from "path";
import { buildRsyncFolderArgs, getRemotePathBaseName, parseWshRemoteUri } from "../../frontend/util/transferutil";

type ExistsFn = (candidate: string) => boolean;

export type FolderDownloadPlan = {
    folderName: string;
    rsyncArgs: string[];
};

export function getRsyncPath(existsFn: ExistsFn = fs.existsSync): string {
    for (const candidate of ["/opt/homebrew/bin/rsync", "/usr/local/bin/rsync", "/usr/bin/rsync"]) {
        if (existsFn(candidate)) {
            return candidate;
        }
    }
    return "rsync";
}

export function buildFolderDownloadPlan(remoteUri: string, destinationPath: string): FolderDownloadPlan {
    const parsed = parseWshRemoteUri(remoteUri);
    return {
        folderName: getRemotePathBaseName(parsed.remotePath),
        rsyncArgs: buildRsyncFolderArgs(remoteUri, destinationPath),
    };
}

function showFolderDownloadError(message: string, err?: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err ?? "");
    console.error(message, err);
    electron.dialog.showErrorBox("Download Folder Failed", `${message}${errMessage ? `\n\n${errMessage}` : ""}`);
}

export function registerDownloadFolderHandler() {
    electron.ipcMain.on("download-folder", async (event, payload: { filePath?: string }) => {
        const senderWindow = electron.BrowserWindow.fromWebContents(event.sender);
        const remoteUri = payload?.filePath;
        let folderName = "download";
        try {
            const parsed = parseWshRemoteUri(remoteUri);
            folderName = getRemotePathBaseName(parsed.remotePath);
        } catch (err) {
            showFolderDownloadError("Could not parse the remote folder path.", err);
            return;
        }

        const result = await electron.dialog.showSaveDialog(senderWindow, {
            title: "Download Folder",
            buttonLabel: "Download",
            defaultPath: folderName,
            properties: ["createDirectory"],
        });
        if (result.canceled || !result.filePath) {
            return;
        }

        try {
            if (fs.existsSync(result.filePath) && !fs.statSync(result.filePath).isDirectory()) {
                throw new Error(`Destination exists and is not a folder: ${result.filePath}`);
            }
            await fs.promises.mkdir(result.filePath, { recursive: true });
        } catch (err) {
            showFolderDownloadError("Could not prepare the destination folder.", err);
            return;
        }

        const plan = buildFolderDownloadPlan(remoteUri, result.filePath);
        const rsyncPath = getRsyncPath();
        const child = child_process.spawn(rsyncPath, plan.rsyncArgs, { windowsHide: true });
        let stderr = "";

        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (err) => {
            showFolderDownloadError(`Could not start rsync at ${rsyncPath}.`, err);
        });
        child.on("close", (code) => {
            if (code === 0) {
                new electron.Notification({
                    title: "Folder Download Complete",
                    body: path.basename(result.filePath),
                }).show();
                return;
            }
            showFolderDownloadError(`rsync exited with code ${code}.`, new Error(stderr.trim() || "No error output from rsync."));
        });
    });
}
