// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const MaxCwdLabelSegments = 3;

function trimTrailingSlash(path: string): string {
    if (path.length > 1 && path.endsWith("/")) {
        return path.slice(0, -1);
    }
    return path;
}

// "/Users/me/Code/app" -> "~/Code/app"; deep paths keep only the last segments ("…/src/view/term")
export function formatCwdLabel(cwd: string, homeDir?: string): string {
    if (!cwd) {
        return "";
    }
    let path = trimTrailingSlash(cwd);
    const home = homeDir ? trimTrailingSlash(homeDir) : "";
    if (home && (path === home || path.startsWith(home + "/"))) {
        path = "~" + path.slice(home.length);
    }
    const segments = path.split("/").filter((seg) => seg !== "" && seg !== "~");
    if (segments.length <= MaxCwdLabelSegments) {
        return path;
    }
    return "…/" + segments.slice(-MaxCwdLabelSegments).join("/");
}

// the folder name used to label a tab: "~" for home, "/" for root, otherwise the last segment
export function cwdBasename(cwd: string, homeDir?: string): string {
    if (!cwd) {
        return "";
    }
    const path = trimTrailingSlash(cwd);
    if (path === "/") {
        return "/";
    }
    if (path === "~" || (homeDir && path === trimTrailingSlash(homeDir))) {
        return "~";
    }
    const last = path.split("/").filter(Boolean).pop();
    return last ?? path;
}

const DefaultTabNameRe = /^T\d+$/;

export function isDefaultTabName(name: string): boolean {
    return !name || DefaultTabNameRe.test(name);
}

// a tab still carrying its generated name ("T3") is labeled by the folder its first terminal is in
export function getTabDisplayName(name: string, firstBlockMeta: MetaType, homeDir?: string): string {
    if (!isDefaultTabName(name) || firstBlockMeta?.view !== "term") {
        return name ?? "";
    }
    const folder = cwdBasename(firstBlockMeta?.["cmd:cwd"] as string, homeDir);
    return folder || name || "";
}
