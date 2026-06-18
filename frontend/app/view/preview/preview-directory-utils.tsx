// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, isBlank } from "@/util/util";
import dayjs from "dayjs";
import React from "react";
import { type PreviewModel } from "./preview-model";

export const recursiveError = "recursive flag must be set for directory operations";
export const overwriteError = "set overwrite flag to delete the existing file";
export const mergeError = "set overwrite flag to delete the existing contents or set merge flag to merge the contents";

export type FileCopyResult = { ok: true } | { ok: false; errorText: string; retryable: boolean; canceled?: boolean };
export type FileCopyFailureResult = Extract<FileCopyResult, { ok: false }>;

export function isFileCopyFailure(result: FileCopyResult): result is FileCopyFailureResult {
    return result.ok === false;
}

type CopyWithOverwriteConfirmationDeps = {
    copyFile: (data: CommandFileCopyData) => Promise<void>;
    refresh?: () => void;
    setErrorMsg: (msg: ErrorMsg) => void;
};

export const displaySuffixes = {
    B: "b",
    kB: "k",
    MB: "m",
    GB: "g",
    TB: "t",
    KiB: "k",
    MiB: "m",
    GiB: "g",
    TiB: "t",
};

export function getBestUnit(bytes: number, si = false, sigfig = 3): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes === 0) return "0B";

    const units = si ? ["kB", "MB", "GB", "TB"] : ["KiB", "MiB", "GiB", "TiB"];
    const divisor = si ? 1000 : 1024;

    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(divisor)), units.length);
    const unit = idx === 0 ? "B" : units[idx - 1];
    const value = bytes / Math.pow(divisor, idx);

    return `${parseFloat(value.toPrecision(sigfig))}${displaySuffixes[unit] ?? unit}`;
}

function padDay(day: number) {
    return String(day).padStart(2, " ");
}

export function getLastModifiedTime(unixMillis: number): string {
    const file = dayjs(unixMillis);
    const now = dayjs();

    const day = padDay(file.date());
    const time = file.format("HH:mm");

    if (now.isSame(file, "year")) {
        return `${file.format("MMM")} ${day} ${time}`;
    }

    return `${file.format("YYYY-MM-DD")}`;
}

const iconRegex = /^[a-z0-9- ]+$/;

export function isIconValid(icon: string): boolean {
    if (isBlank(icon)) {
        return false;
    }
    return icon.match(iconRegex) != null;
}

export function getSortIcon(sortType: string | boolean): React.ReactNode {
    switch (sortType) {
        case "asc":
            return <i className="fa-solid fa-chevron-up dir-table-head-direction"></i>;
        case "desc":
            return <i className="fa-solid fa-chevron-down dir-table-head-direction"></i>;
        default:
            return null;
    }
}

export function cleanMimetype(input: string): string {
    const truncated = input.split(";")[0];
    return truncated.trim();
}

export async function copyWithOverwriteConfirmation(
    data: CommandFileCopyData,
    itemType: "file" | "folder",
    deps: CopyWithOverwriteConfirmationDeps
): Promise<FileCopyResult> {
    const initialResult = await runFileCopy(data, deps);
    if (initialResult.ok) {
        return initialResult;
    }
    if (!isFileCopyFailure(initialResult)) {
        return initialResult;
    }
    if (!initialResult.retryable) {
        deps.setErrorMsg({
            status: "Copy Failed",
            text: initialResult.errorText,
            level: "error",
        });
        return initialResult;
    }

    return new Promise<FileCopyResult>((resolve) => {
        let settled = false;
        const settle = (result: FileCopyResult) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };
        const runConfirmedCopy = async (opts: Partial<CommandFileCopyData["opts"]>) => {
            const result = await runFileCopy(
                {
                    ...data,
                    opts: {
                        ...(data.opts ?? {}),
                        ...opts,
                    },
                },
                deps
            );
            if (isFileCopyFailure(result)) {
                deps.setErrorMsg({
                    status: "Copy Failed",
                    text: result.errorText,
                    level: "error",
                });
            }
            settle(result);
        };
        const buttons: ErrorButtonDef[] = [
            {
                text: "Delete Then Copy",
                onClick: () => {
                    void runConfirmedCopy({ overwrite: true, merge: undefined });
                },
            },
        ];
        if (itemType === "folder") {
            buttons.push({
                text: "Sync",
                onClick: () => {
                    void runConfirmedCopy({ overwrite: undefined, merge: true });
                },
            });
        }
        deps.setErrorMsg({
            status: "Confirm Overwrite File(s)",
            text: "This copy operation will overwrite an existing file. Would you like to continue?",
            level: "warning",
            buttons,
            closeAction: () => {
                settle({
                    ok: false,
                    errorText: "Upload confirmation dismissed.",
                    retryable: false,
                    canceled: true,
                });
            },
        });
    });
}

async function runFileCopy(
    data: CommandFileCopyData,
    deps: CopyWithOverwriteConfirmationDeps
): Promise<FileCopyResult> {
    try {
        await deps.copyFile(data);
        return { ok: true };
    } catch (e) {
        const copyError = `${e}`;
        console.warn("Copy failed:", e);
        return {
            ok: false,
            errorText: copyError,
            retryable: copyError.includes(overwriteError) || copyError.includes(mergeError),
        };
    } finally {
        deps.refresh?.();
    }
}

export function handleRename(
    model: PreviewModel,
    path: string,
    newPath: string,
    isDir: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        try {
            let srcuri = await model.formatRemoteUri(path, globalStore.get);
            if (isDir) {
                srcuri += "/";
            }
            await model.env.rpc.FileMoveCommand(TabRpcClient, {
                srcuri,
                desturi: await model.formatRemoteUri(newPath, globalStore.get),
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Rename failed: ${errorText}`);
            const errorMsg: ErrorMsg = {
                status: "Rename Failed",
                text: `${e}`,
            };
            setErrorMsg(errorMsg);
        }
        model.refreshCallback();
    });
}

export function handleFileDelete(
    model: PreviewModel,
    path: string,
    recursive: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        const formattedPath = await model.formatRemoteUri(path, globalStore.get);
        try {
            await model.env.rpc.FileDeleteCommand(TabRpcClient, {
                path: formattedPath,
                recursive,
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Delete failed: ${errorText}`);
            let errorMsg: ErrorMsg;
            if (errorText.includes(recursiveError) && !recursive) {
                errorMsg = {
                    status: "Confirm Delete Directory",
                    text: "Deleting a directory requires the recursive flag. Proceed?",
                    level: "warning",
                    buttons: [
                        {
                            text: "Delete Recursively",
                            onClick: () => handleFileDelete(model, path, true, setErrorMsg),
                        },
                    ],
                };
            } else {
                errorMsg = {
                    status: "Delete Failed",
                    text: `${e}`,
                };
            }
            setErrorMsg(errorMsg);
        }
        model.refreshCallback();
    });
}

export function makeDirectoryDefaultMenuItems(model: PreviewModel): ContextMenuItem[] {
    const defaultSort = globalStore.get(model.env.getSettingsKeyAtom("preview:defaultsort")) ?? "name";
    const showHiddenFiles = globalStore.get(model.showHiddenFiles) ?? true;
    const treeView = globalStore.get(model.treeViewMode) ?? false;
    return [
        {
            label: "File View",
            submenu: [
                {
                    label: "List",
                    type: "checkbox",
                    checked: !treeView,
                    click: () => globalStore.set(model.treeViewMode, false),
                },
                {
                    label: "Tree",
                    type: "checkbox",
                    checked: treeView,
                    click: () => globalStore.set(model.treeViewMode, true),
                },
            ],
        },
        {
            label: "Directory Sort Order",
            submenu: [
                {
                    label: "Name",
                    type: "checkbox",
                    checked: defaultSort === "name",
                    click: () =>
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:defaultsort": "name" })
                        ),
                },
                {
                    label: "Last Modified",
                    type: "checkbox",
                    checked: defaultSort === "modtime",
                    click: () =>
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:defaultsort": "modtime" })
                        ),
                },
            ],
        },
        {
            label: "Show Hidden Files",
            submenu: [
                {
                    label: "On",
                    type: "checkbox",
                    checked: showHiddenFiles,
                    click: () => {
                        globalStore.set(model.showHiddenFiles, true);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": true })
                        );
                    },
                },
                {
                    label: "Off",
                    type: "checkbox",
                    checked: !showHiddenFiles,
                    click: () => {
                        globalStore.set(model.showHiddenFiles, false);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": false })
                        );
                    },
                },
            ],
        },
    ];
}
