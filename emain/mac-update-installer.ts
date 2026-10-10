// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const MacAppName = "GenieTerm.app";
const execFileAsync = promisify(execFile);

// Runs detached after GenieTerm quits. Every failure path goes through on_exit, which restores the
// original bundle if the swap had started and relaunches it, so a failed update never leaves the user
// without an app. The update is staged next to the app so the swap is a same-volume rename.
export const MacUpdateInstallerScript = String.raw`
set -eu

current_app="$1"
update_zip="$2"
expected_version="$3"
expected_sha512="$4"
parent_pid="$5"
wavesrv_pid="$6"
log_file="$7"
relaunch_cmd=/usr/bin/open
if [ "$#" -ge 8 ]; then
    relaunch_cmd="$8"
fi

exec >>"$log_file" 2>&1

stage_dir=""
backup_app=""
relaunch_allowed=0
swap_started=0
install_done=0

log() {
    echo "$(/bin/date '+%Y-%m-%dT%H:%M:%S') genieterm-update[$$]: $*"
}

pid_running() {
    [ -n "$1" ] && [ "$1" != 0 ] || return 1
    /bin/kill -0 "$1" 2>/dev/null || return 1
    [ -n "$2" ] || return 0
    case "$(/bin/ps -p "$1" -o comm= 2>/dev/null)" in
        $2) return 0 ;;
    esac
    return 1
}

wait_for_exit() {
    attempt=0
    while pid_running "$1" "$3"; do
        attempt=$((attempt + 1))
        [ "$attempt" -lt "$2" ] || return 1
        /bin/sleep 0.1
    done
    return 0
}

stop_wavesrv() {
    wait_for_exit "$wavesrv_pid" 150 "*wavesrv*" && return 0
    log "wavesrv $wavesrv_pid is still running; sending TERM"
    /bin/kill -TERM "$wavesrv_pid" 2>/dev/null || true
    wait_for_exit "$wavesrv_pid" 50 "*wavesrv*" && return 0
    log "wavesrv $wavesrv_pid is still running; sending KILL"
    /bin/kill -KILL "$wavesrv_pid" 2>/dev/null || true
    wait_for_exit "$wavesrv_pid" 20 "*wavesrv*"
}

on_exit() {
    status=$?
    set +e
    trap - EXIT HUP INT TERM
    if [ "$install_done" = 1 ]; then
        [ -n "$stage_dir" ] && /bin/rm -rf "$stage_dir"
        log "installed $expected_version; relaunching $current_app"
        "$relaunch_cmd" "$current_app"
        exit 0
    fi
    log "update failed with status $status"
    if [ "$swap_started" = 1 ] && [ -d "$backup_app" ]; then
        if [ -e "$current_app" ]; then
            /bin/mv "$current_app" "$stage_dir/GenieTerm.failed.app" || /bin/rm -rf "$current_app"
        fi
        /bin/mv "$backup_app" "$current_app" && log "restored the original app"
    fi
    if [ -n "$backup_app" ] && [ -e "$backup_app" ]; then
        log "could not restore the original app; it is kept at $backup_app"
    elif [ -n "$stage_dir" ]; then
        /bin/rm -rf "$stage_dir"
    fi
    [ "$relaunch_allowed" = 1 ] || exit "$status"
    if ! wait_for_exit "$parent_pid" 300 ""; then
        log "GenieTerm is still running; not relaunching"
        exit "$status"
    fi
    stop_wavesrv || log "wavesrv $wavesrv_pid did not exit"
    log "relaunching the original app"
    "$relaunch_cmd" "$current_app"
    exit "$status"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

log "installing $expected_version into $current_app"
case "$current_app" in
    /*/GenieTerm.app) ;;
    *) exit 10 ;;
esac
current_plist="$current_app/Contents/Info.plist"
[ -f "$current_plist" ] || exit 11
current_bundle_id=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$current_plist")
[ "$current_bundle_id" = "dev.ry3ng.genieterm" ] || exit 12
relaunch_allowed=1

[ -f "$update_zip" ] || exit 13
app_parent=$(/usr/bin/dirname "$current_app")
stage_dir=$(/usr/bin/mktemp -d "$app_parent/.genieterm-update.XXXXXX")
staged_zip="$stage_dir/update.zip"
/bin/cp "$update_zip" "$staged_zip"
actual_sha512=$(/usr/bin/openssl dgst -sha512 -binary "$staged_zip" | /usr/bin/openssl base64 -A)
[ "$actual_sha512" = "$expected_sha512" ] || { log "sha512 mismatch for $update_zip"; exit 14; }

/bin/mkdir "$stage_dir/extracted"
/usr/bin/ditto -x -k "$staged_zip" "$stage_dir/extracted"
new_app="$stage_dir/extracted/GenieTerm.app"
new_plist="$new_app/Contents/Info.plist"
[ -f "$new_plist" ] || exit 15
new_bundle_id=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$new_plist")
new_version=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$new_plist")
[ "$new_bundle_id" = "dev.ry3ng.genieterm" ] || exit 16
[ "$new_version" = "$expected_version" ] || { log "expected $expected_version, update contains $new_version"; exit 17; }
/usr/bin/codesign --verify --deep --strict "$new_app" || { log "code signature of the new app is invalid"; exit 18; }
/usr/bin/xattr -dr com.apple.quarantine "$new_app" 2>/dev/null || true

wait_for_exit "$parent_pid" 300 "" || { log "GenieTerm did not quit"; exit 20; }
stop_wavesrv || { log "wavesrv $wavesrv_pid did not exit"; exit 21; }

backup_app="$stage_dir/GenieTerm.backup.app"
swap_started=1
/bin/mv "$current_app" "$backup_app"
/bin/mv "$new_app" "$current_app"
install_done=1
exit 0
`;

export type MacUpdateInstallerOptions = {
    execPath: string;
    updateZipPath: string;
    expectedVersion: string;
    expectedSha512: string;
    logPath: string;
    parentPid?: number;
    waveSrvPid?: number;
};

export type DownloadedUpdateChecksumInfo = {
    downloadedFile: string;
    files: Array<{
        url: string;
        sha512?: string;
    }>;
};

export function getMacAppBundlePath(execPath: string): string {
    const appPath = path.dirname(path.dirname(path.dirname(path.resolve(execPath))));
    if (path.basename(appPath) != MacAppName) {
        throw new Error(`Unexpected macOS application path: ${appPath}`);
    }
    return appPath;
}

export function isMacCodeSignatureError(error: unknown): boolean {
    const message = String(error);
    return (
        message.includes("SQRLCodeSignatureErrorDomain") ||
        (message.includes("Code signature") && message.includes("did not pass validation"))
    );
}

export function getDownloadedUpdateSha512(update: DownloadedUpdateChecksumInfo): string | null {
    const downloadedFileName = path.basename(update.downloadedFile);
    const matchingFile = update.files.find((file) => {
        const fileUrlPath = file.url.split(/[?#]/, 1)[0];
        return path.basename(fileUrlPath) == downloadedFileName;
    });
    return matchingFile?.sha512 ?? null;
}

export function isDeveloperIdSignature(verificationStatus: number | null, signatureDetails: string): boolean {
    if (verificationStatus != 0) {
        return false;
    }
    return (
        /^Authority=Developer ID Application:/m.test(signatureDetails) &&
        /^TeamIdentifier=[A-Z0-9]{10}$/m.test(signatureDetails)
    );
}

export async function hasDeveloperIdSignature(appPath: string): Promise<boolean> {
    try {
        await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", appPath]);
        const { stdout, stderr } = await execFileAsync("/usr/bin/codesign", ["-d", "--verbose=4", appPath]);
        return isDeveloperIdSignature(0, `${stdout ?? ""}\n${stderr ?? ""}`);
    } catch {
        return false;
    }
}

function isWritableDirectory(dirPath: string): boolean {
    try {
        fs.accessSync(dirPath, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns why the helper cannot replace the app in place, or null when it can. The helper renames the
 * bundle within its parent directory, which needs write access to both the parent and the bundle.
 */
export function getMacInstallLocationProblem(
    appPath: string,
    canWrite: (dirPath: string) => boolean = isWritableDirectory
): string | null {
    if (appPath.includes("/AppTranslocation/")) {
        return "macOS is running GenieTerm from a temporary, read-only copy (App Translocation). Move GenieTerm.app to your Applications folder with Finder, open it from there, and try again.";
    }
    const parentDir = path.dirname(appPath);
    if (!canWrite(parentDir) || !canWrite(appPath)) {
        if (appPath.startsWith("/Volumes/")) {
            return `GenieTerm is running from ${parentDir}, which is a disk image or read-only volume. Copy GenieTerm.app to your Applications folder, open it from there, and try again.`;
        }
        return `GenieTerm can't replace itself in ${parentDir} because that folder or the app is not writable by your user account.`;
    }
    return null;
}

export async function launchMacUpdateInstaller(options: MacUpdateInstallerOptions): Promise<void> {
    const currentAppPath = getMacAppBundlePath(options.execPath);
    if (!path.isAbsolute(options.updateZipPath) || path.extname(options.updateZipPath) != ".zip") {
        throw new Error(`Unexpected macOS update path: ${options.updateZipPath}`);
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.expectedVersion)) {
        throw new Error(`Unexpected macOS update version: ${options.expectedVersion}`);
    }
    if (!/^[A-Za-z0-9+/]{86}==$/.test(options.expectedSha512)) {
        throw new Error("Unexpected macOS update checksum");
    }
    if (!path.isAbsolute(options.logPath)) {
        throw new Error(`Unexpected macOS updater log path: ${options.logPath}`);
    }

    const child = spawn(
        "/bin/sh",
        [
            "-c",
            MacUpdateInstallerScript,
            "genieterm-update",
            currentAppPath,
            options.updateZipPath,
            options.expectedVersion,
            options.expectedSha512,
            String(options.parentPid ?? process.pid),
            String(options.waveSrvPid ?? 0),
            options.logPath,
        ],
        {
            detached: true,
            stdio: "ignore",
        }
    );
    await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}
