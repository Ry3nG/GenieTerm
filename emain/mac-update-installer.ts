// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const MacAppName = "GenieTerm.app";

const MacUpdateInstallerScript = String.raw`
set -eu

current_app="$1"
update_zip="$2"
expected_version="$3"
expected_sha512="$4"
parent_pid="$5"
log_file="$6"

exec >>"$log_file" 2>&1

case "$current_app" in
    /*/GenieTerm.app) ;;
    *) exit 10 ;;
esac

current_plist="$current_app/Contents/Info.plist"
[ -f "$current_plist" ]
[ -f "$update_zip" ]

current_bundle_id=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$current_plist")
[ "$current_bundle_id" = "dev.ry3ng.genieterm" ]

actual_sha512=$(/usr/bin/openssl dgst -sha512 -binary "$update_zip" | /usr/bin/openssl base64 -A)
[ "$actual_sha512" = "$expected_sha512" ]

temp_dir=$(/usr/bin/mktemp -d "/tmp/genieterm-update.XXXXXX")
cleanup() {
    /bin/rm -rf "$temp_dir"
}
trap cleanup EXIT

/usr/bin/ditto -x -k "$update_zip" "$temp_dir"
new_app="$temp_dir/GenieTerm.app"
new_plist="$new_app/Contents/Info.plist"
[ -f "$new_plist" ]

new_bundle_id=$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$new_plist")
new_version=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$new_plist")
[ "$new_bundle_id" = "dev.ry3ng.genieterm" ]
[ "$new_version" = "$expected_version" ]

attempt=0
while /bin/kill -0 "$parent_pid" 2>/dev/null; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 300 ] || exit 20
    /bin/sleep 0.1
done

backup_app="$current_app.genieterm-update-$parent_pid.backup"
[ ! -e "$backup_app" ]
/bin/mv "$current_app" "$backup_app"

if /bin/mv "$new_app" "$current_app"; then
    /bin/rm -rf "$backup_app"
    /usr/bin/open "$current_app"
    exit 0
fi

if [ ! -e "$current_app" ]; then
    /bin/mv "$backup_app" "$current_app"
fi
/usr/bin/open "$current_app"
exit 30
`;

export type MacUpdateInstallerOptions = {
    execPath: string;
    updateZipPath: string;
    expectedVersion: string;
    expectedSha512: string;
    logPath: string;
    parentPid?: number;
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

export function hasDeveloperIdSignature(appPath: string): boolean {
    const verification = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
        stdio: "ignore",
    });
    if (verification.status != 0) {
        return false;
    }

    const signature = spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", appPath], {
        encoding: "utf8",
    });
    return isDeveloperIdSignature(signature.status, `${signature.stdout ?? ""}\n${signature.stderr ?? ""}`);
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
