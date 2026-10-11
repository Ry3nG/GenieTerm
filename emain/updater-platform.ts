// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A .deb (or any non-AppImage Linux install) belongs to the system package manager, so GenieTerm
// tells the user about new versions instead of downloading and replacing files it doesn't own.
// AppImage builds update themselves like macOS and Windows.
export function usesPackageManagerUpdates(
    platform: string = process.platform,
    env: Record<string, string | undefined> = process.env
): boolean {
    return platform == "linux" && !env.APPIMAGE;
}

export type FeedResponse = { ok: boolean; status: number; text: () => Promise<string> };

export type PackageFeedDeps = {
    fetch: (url: string) => Promise<FeedResponse>;
    parseManifest: (text: string) => unknown;
    isNewer: (version: string, current: string) => boolean;
    isValidVersion: (version: unknown) => boolean;
    feedUrl: string;
    arch: string;
    currentVersion: string;
    getStatus: () => UpdaterStatus;
    setStatus: (status: UpdaterStatus) => void;
    onUpdateAvailable: (info: { version: string; [key: string]: unknown }) => void;
};

// Checks the stable feed for a newer release on behalf of a package-managed install. A failed check
// (offline, HTTP error, unreadable manifest) must not leave the status at "checking": a manual check
// treats "checking" as in progress and would never retry.
export async function checkPackageFeed(deps: PackageFeedDeps): Promise<{ isUpdateAvailable: boolean }> {
    const previous = deps.getStatus();
    if (previous != "manual") {
        deps.setStatus("checking");
    }
    try {
        const manifest = deps.arch == "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";
        const resp = await deps.fetch(deps.feedUrl + manifest);
        if (!resp.ok) {
            throw new Error(`update feed returned HTTP ${resp.status} for ${manifest}`);
        }
        const info = deps.parseManifest(await resp.text()) as { version?: unknown };
        if (info == null || typeof info != "object" || !deps.isValidVersion(info.version)) {
            throw new Error(`update feed manifest ${manifest} has no valid version`);
        }
        const version = info.version as string;
        if (!deps.isNewer(version, deps.currentVersion)) {
            deps.setStatus("up-to-date");
            return { isUpdateAvailable: false };
        }
        deps.onUpdateAvailable({ ...info, version });
        deps.setStatus("manual");
        return { isUpdateAvailable: true };
    } catch (error) {
        // keep a known pending update visible across a transient failure
        deps.setStatus(previous == "manual" ? "manual" : "error");
        throw error;
    }
}
