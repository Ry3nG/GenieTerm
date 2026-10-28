// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { getRemotePathBaseName, isWslConnection, parseWshRemoteUri } from "../../frontend/util/transferutil";

export type BatchDownloadItem = { path: string; isdir: boolean };
export type BatchDownloadPlan = BatchDownloadItem & { destination: string; label: string };

export function downloadDestinationExists(candidate: string): boolean {
    try {
        fs.lstatSync(candidate);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

export function planBatchDownloads(
    items: BatchDownloadItem[],
    directory: string,
    conflicts: "keep" | "skip",
    exists: (candidate: string) => boolean,
    pathApi = path,
    platform: NodeJS.Platform = pathApi === path.win32 ? "win32" : process.platform
): BatchDownloadPlan[] {
    if (!Array.isArray(items) || items.length === 0 || items.length > 200)
        throw new Error("Choose between 1 and 200 files or folders.");
    const reserved = new Set<string>();
    // Reserve aliases too: typical macOS volumes ignore case and Unicode normalization.
    const normalize = (value: string) =>
        platform === "darwin"
            ? value.normalize("NFD").toLowerCase()
            : platform === "win32"
              ? value.toLowerCase()
              : value;
    const plans: BatchDownloadPlan[] = [];
    for (const item of items) {
        const parsed = parseWshRemoteUri(item.path);
        if (item.isdir && isWslConnection(parsed.connection))
            throw new Error(
                "Folder downloads are not available for WSL. Select files, or copy the folder from File Explorer."
            );
        const label = getRemotePathBaseName(parsed.remotePath);
        if (
            !label ||
            label === "." ||
            label === ".." ||
            /[\\/\0]/.test(label) ||
            (platform === "win32" &&
                (/[:*?"<>|]/.test(label) ||
                    Array.from(label).some((char) => char.charCodeAt(0) < 32) ||
                    /[. ]$/.test(label) ||
                    /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(label)))
        )
            throw new Error(`Cannot use this local file name: ${label}`);
        let destination = pathApi.join(directory, label);
        const occupied = (candidate: string) => exists(candidate) || reserved.has(normalize(candidate));
        if (occupied(destination)) {
            if (conflicts === "skip") continue;
            const extension = item.isdir ? "" : pathApi.extname(label);
            const base = extension ? label.slice(0, -extension.length) : label;
            let suffix = 1;
            do {
                destination = pathApi.join(directory, `${base} (${suffix++})${extension}`);
            } while (occupied(destination) && suffix < 10000);
            if (occupied(destination)) throw new Error(`Could not find an available name for ${label}`);
        }
        reserved.add(normalize(destination));
        plans.push({ ...item, destination, label });
    }
    return plans;
}
