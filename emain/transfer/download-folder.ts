import * as electron from "electron";
import fs from "fs";
import * as child_process from "node:child_process";
import * as path from "path";
import type { TransferError, TransferJobInput, TransferTransport } from "../../frontend/util/transferqueue";
import {
    buildRsyncFolderArgs,
    buildSshOptionArgs,
    formatRemoteCopyOperand,
    getRemotePathBaseName,
    isWslConnection,
    parseSshConnection,
    parseWshRemoteUri,
} from "../../frontend/util/transferutil";
import {
    buildLocalFileUri,
    createDownloadTransferJobId,
    downloadTransferTracker,
    runTransferUpdate,
} from "./download-transfer";
import { clearTransferCancelHandle, registerTransferCancelHandle } from "./transfer-handles";

type ExistsFn = (candidate: string) => boolean;

export type ConnKeywordsResolver = (connection: string) => Promise<ConnKeywords | undefined>;

export type FolderDownloadPlan = {
    folderName: string;
    transport: "rsync" | "scp";
    args: string[];
    cwd?: string;
};

export type FolderDownloadPlanOptions = {
    platform?: NodeJS.Platform;
    connKeywords?: ConnKeywords;
    // rsync >= 3 supports -s (protect-args); macOS /usr/bin/rsync (openrsync, 2.6.9-compatible) does not.
    rsyncProtectArgs?: boolean;
    // OpenSSH >= 9 scp uses the SFTP protocol, where remote paths are not interpreted by a remote shell.
    scpUsesSftp?: boolean;
};

export type FolderDownloadFailureKind = "parse" | "unsupported" | "destination" | "start" | "exit" | "canceled";

export type FolderDownloadError = TransferError & {
    detail?: string;
};

export type FolderDestinationState = "missing" | "empty-folder" | "non-empty-folder" | "not-folder";

const MaxStderrChars = 16 * 1024;
const ToolVersionTimeoutMs = 5000;

let resolveConnKeywords: ConnKeywordsResolver = async () => undefined;
const toolVersionOutputs = new Map<string, Promise<string>>();

export function getRsyncPath(existsFn: ExistsFn = fs.existsSync): string {
    for (const candidate of ["/opt/homebrew/bin/rsync", "/usr/local/bin/rsync", "/usr/bin/rsync"]) {
        if (existsFn(candidate)) {
            return candidate;
        }
    }
    return "rsync";
}

export function getFolderDownloadTransport(platform: NodeJS.Platform = process.platform): "rsync" | "scp" {
    return platform === "win32" ? "scp" : "rsync";
}

export function parseRsyncMajorVersion(versionOutput: string): number | null {
    const match = versionOutput?.match(/\bversion\s+v?(\d+)\.(\d+)/);
    return match ? Number(match[1]) : null;
}

export function parseOpenSshMajorVersion(versionOutput: string): number | null {
    const match = versionOutput?.match(/OpenSSH[A-Za-z_]*?_(\d+)\.(\d+)/);
    return match ? Number(match[1]) : null;
}

export function buildFolderDownloadPlan(
    remoteUri: string,
    destinationPath: string,
    options: FolderDownloadPlanOptions = {}
): FolderDownloadPlan {
    const platform = options.platform ?? process.platform;
    const parsed = parseWshRemoteUri(remoteUri);
    const connection = parseSshConnection(parsed.connection);
    const folderName = getRemotePathBaseName(parsed.remotePath);
    if (getFolderDownloadTransport(platform) === "scp") {
        const destination = path.win32.parse(destinationPath);
        const remotePath = parsed.remotePath.replace(/\/+$/, "") + "/.";
        return {
            folderName,
            transport: "scp",
            args: [
                ...buildSshOptionArgs(connection, options.connKeywords, "-P"),
                "-r",
                "--",
                formatRemoteCopyOperand(connection, remotePath, options.scpUsesSftp ? "none" : "posix-shell"),
                destination.base,
            ],
            cwd: destination.dir,
        };
    }
    return {
        folderName,
        transport: "rsync",
        args: buildRsyncFolderArgs(remoteUri, destinationPath, {
            sshArgs: buildSshOptionArgs(connection, options.connKeywords, "-p"),
            protectArgs: options.rsyncProtectArgs,
        }),
    };
}

export function buildFolderDownloadTransferJobInput(
    remoteUri: string,
    destinationPath: string,
    id: string,
    platform: NodeJS.Platform = process.platform
): TransferJobInput {
    const parsed = parseWshRemoteUri(remoteUri);
    const transport: TransferTransport = getFolderDownloadTransport(platform);
    return {
        id,
        operation: "download",
        itemType: "folder",
        transport,
        source: remoteUri,
        destination: buildLocalFileUri(destinationPath),
        label: getRemotePathBaseName(parsed.remotePath),
    };
}

export function mapFolderDownloadError(kind: FolderDownloadFailureKind, err?: unknown): FolderDownloadError {
    const detail = err instanceof Error ? err.message : err == null ? undefined : String(err);
    const base = (() => {
        switch (kind) {
            case "parse":
                return {
                    code: "invalid_source",
                    message: "Could not parse the remote folder path.",
                    retryable: false,
                };
            case "unsupported":
                return {
                    code: "unsupported_connection",
                    message: "Folder download is not available for this connection.",
                    retryable: false,
                };
            case "destination":
                return {
                    code: "destination_error",
                    message: "Could not prepare the destination folder.",
                    retryable: true,
                };
            case "start":
                return {
                    code: "transfer_start_failed",
                    message: "Could not start the folder transfer.",
                    retryable: true,
                };
            case "exit":
                return {
                    code: "transfer_failed",
                    message: "Folder transfer failed.",
                    retryable: true,
                };
            case "canceled":
                return {
                    code: "download_canceled",
                    message: "Folder download canceled.",
                    retryable: true,
                };
        }
    })();
    return detail ? { ...base, detail } : base;
}

export function describeFolderTransferFailure(detail: string, connKeywords?: ConnKeywords): string {
    const hints: string[] = [];
    if (/permission denied|too many authentication failures|passphrase|password/i.test(detail)) {
        hints.push(
            "Folder downloads use the system ssh client in batch mode, which cannot prompt for passwords or key passphrases. Load your key into ssh-agent (ssh-add) or set up key-based login for this host."
        );
        if (connKeywords?.["ssh:passwordsecretname"]) {
            hints.push(
                "This connection signs in with a password saved in GenieTerm, which the system ssh client cannot use."
            );
        }
    }
    if (/host key verification failed/i.test(detail)) {
        hints.push("Connect to this host once from a terminal (ssh) to accept its host key, then retry.");
    }
    return [detail, ...hints].join("\n\n");
}

export function inspectFolderDestination(destinationPath: string, fsApi: typeof fs = fs): FolderDestinationState {
    let stat: fs.Stats;
    try {
        stat = fsApi.statSync(destinationPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return "missing";
        }
        throw err;
    }
    if (!stat.isDirectory()) {
        return "not-folder";
    }
    return fsApi.readdirSync(destinationPath).length === 0 ? "empty-folder" : "non-empty-folder";
}

export function getUniqueDestinationPath(destinationPath: string, existsFn: ExistsFn = fs.existsSync): string {
    const parsed = path.parse(destinationPath);
    for (let index = 1; index < 10000; index++) {
        const candidate = path.join(parsed.dir, `${parsed.base} (${index})`);
        if (!existsFn(candidate)) {
            return candidate;
        }
    }
    throw new Error(`Could not find a free folder name next to ${destinationPath}`);
}

function showFolderDownloadError(error: FolderDownloadError) {
    console.error(error.message, error.detail ?? "");
    electron.dialog.showErrorBox(
        "Download Folder Failed",
        `${error.message}${error.detail ? `\n\n${error.detail}` : ""}`
    );
}

async function confirmFolderDestination(
    senderWindow: electron.BrowserWindow,
    destinationPath: string
): Promise<string | null> {
    const state = inspectFolderDestination(destinationPath);
    if (state === "not-folder") {
        throw new Error(`Destination exists and is not a folder: ${destinationPath}`);
    }
    if (state !== "non-empty-folder") {
        return destinationPath;
    }
    const uniquePath = getUniqueDestinationPath(destinationPath);
    const options: electron.MessageBoxOptions = {
        type: "question",
        title: "Folder Already Exists",
        message: `"${path.basename(destinationPath)}" already exists and is not empty.`,
        detail: "Merging copies the remote folder into it and overwrites files that have the same name.",
        buttons: [`Download as "${path.basename(uniquePath)}"`, "Merge and Overwrite", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
    };
    const { response } =
        senderWindow != null
            ? await electron.dialog.showMessageBox(senderWindow, options)
            : await electron.dialog.showMessageBox(options);
    if (response === 0) {
        return uniquePath;
    }
    if (response === 1) {
        return destinationPath;
    }
    return null;
}

function readToolVersionOutput(command: string, args: string[]): Promise<string> {
    const key = `${command}\0${args.join("\0")}`;
    let output = toolVersionOutputs.get(key);
    if (output == null) {
        output = new Promise<string>((resolve) => {
            child_process.execFile(
                command,
                args,
                { timeout: ToolVersionTimeoutMs, windowsHide: true },
                (_err, stdout, stderr) => {
                    resolve(`${stdout ?? ""}\n${stderr ?? ""}`);
                }
            );
        });
        toolVersionOutputs.set(key, output);
    }
    return output;
}

async function resolveFolderDownloadPlanOptions(connection: string): Promise<FolderDownloadPlanOptions> {
    let connKeywords: ConnKeywords;
    try {
        connKeywords = await resolveConnKeywords(connection);
    } catch (err) {
        console.error("could not read connection settings for folder download", err);
    }
    if (getFolderDownloadTransport() === "scp") {
        const sshMajor = parseOpenSshMajorVersion(await readToolVersionOutput("ssh", ["-V"]));
        return { connKeywords, scpUsesSftp: sshMajor != null && sshMajor >= 9 };
    }
    const rsyncMajor = parseRsyncMajorVersion(await readToolVersionOutput(getRsyncPath(), ["--version"]));
    return { connKeywords, rsyncProtectArgs: rsyncMajor != null && rsyncMajor >= 3 };
}

async function handleDownloadFolderRequest(sender: electron.WebContents, remoteUri: string) {
    const senderWindow = electron.BrowserWindow.fromWebContents(sender);
    let folderName = "download";
    try {
        const parsed = parseWshRemoteUri(remoteUri);
        if (isWslConnection(parsed.connection)) {
            showFolderDownloadError(
                mapFolderDownloadError(
                    "unsupported",
                    new Error("WSL folders can be copied from File Explorer at \\\\wsl$\\<distro>.")
                )
            );
            return;
        }
        parseSshConnection(parsed.connection);
        folderName = getRemotePathBaseName(parsed.remotePath);
    } catch (err) {
        showFolderDownloadError(mapFolderDownloadError("parse", err));
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

    let destinationPath: string;
    try {
        destinationPath = await confirmFolderDestination(senderWindow, result.filePath);
        if (destinationPath == null) {
            return;
        }
        await fs.promises.mkdir(destinationPath, { recursive: true });
    } catch (err) {
        showFolderDownloadError(mapFolderDownloadError("destination", err));
        return;
    }

    const jobInput = buildFolderDownloadTransferJobInput(
        remoteUri,
        destinationPath,
        createDownloadTransferJobId("folder-download")
    );
    downloadTransferTracker.enqueue(jobInput);
    await startTrackedFolderDownload(jobInput.id, remoteUri, destinationPath);
}

export function registerDownloadFolderHandler(options: { resolveConnKeywords?: ConnKeywordsResolver } = {}) {
    if (options.resolveConnKeywords != null) {
        resolveConnKeywords = options.resolveConnKeywords;
    }
    electron.ipcMain.on("download-folder", (event, payload: { filePath?: string }) => {
        handleDownloadFolderRequest(event.sender, payload?.filePath).catch((err) => {
            showFolderDownloadError(mapFolderDownloadError("start", err));
        });
    });
}

function failFolderDownload(jobId: string, error: FolderDownloadError) {
    runTransferUpdate("fail folder download", () => downloadTransferTracker.fail(jobId, error));
    showFolderDownloadError(error);
}

// Expects a queued job (fresh or retried); it only becomes "running" once the copy process is spawned.
export async function startTrackedFolderDownload(jobId: string, remoteUri: string, destinationPath: string) {
    let plan: FolderDownloadPlan;
    let planOptions: FolderDownloadPlanOptions;
    try {
        const parsed = parseWshRemoteUri(remoteUri);
        planOptions = await resolveFolderDownloadPlanOptions(parsed.connection);
        plan = buildFolderDownloadPlan(remoteUri, destinationPath, planOptions);
    } catch (err) {
        failFolderDownload(jobId, mapFolderDownloadError("parse", err));
        return;
    }
    if (downloadTransferTracker.findJob(jobId)?.status !== "queued") {
        return;
    }
    if (runTransferUpdate("start folder download", () => downloadTransferTracker.start(jobId)) == null) {
        return;
    }

    const command = plan.transport === "rsync" ? getRsyncPath() : "scp";
    let child: child_process.ChildProcess;
    try {
        child = child_process.spawn(command, plan.args, { cwd: plan.cwd, windowsHide: true });
    } catch (err) {
        failFolderDownload(jobId, mapFolderDownloadError("start", err));
        return;
    }
    let stderr = "";
    let settled = false;
    let cancelRequested = false;
    registerTransferCancelHandle(jobId, () => {
        cancelRequested = true;
        child.kill();
    });

    const settle = () => {
        if (settled) {
            return false;
        }
        settled = true;
        clearTransferCancelHandle(jobId);
        return true;
    };

    child.stderr?.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-MaxStderrChars);
    });
    child.on("error", (err) => {
        if (!settle()) {
            return;
        }
        if (plan.transport === "scp" && (err as NodeJS.ErrnoException).code === "ENOENT") {
            failFolderDownload(
                jobId,
                mapFolderDownloadError(
                    "start",
                    new Error("Windows OpenSSH Client (scp.exe) is required for folder downloads.")
                )
            );
            return;
        }
        failFolderDownload(jobId, mapFolderDownloadError("start", err));
    });
    child.on("close", (code, signal) => {
        if (!settle()) {
            return;
        }
        if (cancelRequested) {
            runTransferUpdate("cancel folder download", () => downloadTransferTracker.cancel(jobId));
            return;
        }
        if (code === 0) {
            runTransferUpdate("complete folder download", () => downloadTransferTracker.complete(jobId));
            runTransferUpdate("folder download notification", () => {
                if (!electron.Notification.isSupported()) {
                    return;
                }
                new electron.Notification({
                    title: "Folder Download Complete",
                    body: path.basename(destinationPath),
                }).show();
            });
            return;
        }
        const exitText = signal
            ? `${plan.transport} was terminated by ${signal}.`
            : `${plan.transport} exited with code ${code}.`;
        const detail = describeFolderTransferFailure(stderr.trim() || exitText, planOptions.connKeywords);
        failFolderDownload(jobId, mapFolderDownloadError("exit", new Error(detail)));
    });
}
