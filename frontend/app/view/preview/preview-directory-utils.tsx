// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, isBlank } from "@/util/util";
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
    // Notifies on every error-overlay change so a prompt that gets replaced by another message settles instead of
    // leaving the copy waiting forever.
    watchErrorMsg?: (listener: (msg: ErrorMsg) => void) => () => void;
    signal?: AbortSignal;
};

const ConfirmationCanceledResult: FileCopyResult = {
    ok: false,
    errorText: "Upload confirmation dismissed.",
    retryable: false,
    canceled: true,
};

const ShortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
const SizeUnits = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];

export function getBestUnit(bytes: number): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
    let unit = 0;
    let value = bytes;
    while (value >= 1000 && unit < SizeUnits.length - 1) {
        value /= 1000;
        unit++;
    }
    let rounded = Number(value.toFixed(unit === 0 || value >= 100 ? 0 : 1));
    if (rounded >= 1000 && unit < SizeUnits.length - 1) {
        rounded /= 1000;
        unit++;
    }
    return `${rounded.toFixed(unit === 0 || rounded >= 100 ? 0 : 1)} ${SizeUnits[unit]}`;
}

function padTime(value: number) {
    return String(value).padStart(2, "0");
}

function formatTime(date: Date) {
    return `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
}

export function getLastModifiedTime(unixMillis: number, now = new Date()): string {
    if (unixMillis == null || !Number.isFinite(unixMillis)) return "—";
    const file = new Date(unixMillis);
    if (Number.isNaN(file.getTime())) return "—";
    const time = formatTime(file);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (file.toDateString() === now.toDateString()) {
        return `Today ${time}`;
    }
    if (file.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${time}`;
    }
    const date = `${ShortMonthFormatter.format(file)} ${file.getDate()}`;
    if (now.getFullYear() == file.getFullYear()) {
        return `${date} ${time}`;
    }
    return `${date}, ${file.getFullYear()}`;
}

const ExtensionKinds: Record<string, string> = {
    md: "Markdown",
    markdown: "Markdown",
    mdx: "Markdown",
    json: "JSON",
    jsonc: "JSON",
    yaml: "YAML",
    yml: "YAML",
    ts: "TypeScript",
    tsx: "TypeScript",
    mts: "TypeScript",
    cts: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    mjs: "JavaScript",
    cjs: "JavaScript",
    go: "Go source",
    sh: "Shell script",
    bash: "Shell script",
    zsh: "Shell script",
    png: "PNG image",
    jpg: "JPEG image",
    jpeg: "JPEG image",
    pdf: "PDF",
    txt: "Plain text",
};
const MimeKinds: Record<string, string> = {
    "text/markdown": "Markdown",
    "text/mdx": "Markdown",
    "application/json": "JSON",
    "application/yaml": "YAML",
    "application/x-yaml": "YAML",
    "text/yaml": "YAML",
    "text/x-yaml": "YAML",
    "text/typescript": "TypeScript",
    "application/typescript": "TypeScript",
    "application/x-typescript": "TypeScript",
    "text/javascript": "JavaScript",
    "application/javascript": "JavaScript",
    "application/x-javascript": "JavaScript",
    "text/x-go": "Go source",
    "application/x-sh": "Shell script",
    "text/x-shellscript": "Shell script",
    "image/png": "PNG image",
    "image/jpeg": "JPEG image",
    "application/pdf": "PDF",
};

export function getFileKind(file: Pick<FileInfo, "name" | "mimetype" | "isdir" | "modestr" | "mode">): string {
    const mime = cleanMimetype(file.mimetype ?? "").toLowerCase();
    // Go's FileMode uses L (rather than POSIX l) for symlinks.
    if (/^[Ll]/.test(file.modestr ?? "") || ((file.mode ?? 0) & (1 << 27)) !== 0 || mime === "inode/symlink") {
        return "Symlink";
    }
    if (file.isdir || mime === "directory" || mime === "inode/directory") return "Folder";
    const name = file.name ?? "";
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    if (Object.hasOwn(ExtensionKinds, extension)) return ExtensionKinds[extension];
    if (Object.hasOwn(MimeKinds, mime)) return MimeKinds[mime];
    if (extension) return `${extension.toUpperCase()} file`;
    if (mime === "text/plain") return "Plain text";
    return "Document";
}

export function getDirectoryFocusIndex(index: number, count: number, delta: number, hasParent: boolean): number {
    if (count === 0) return -1;
    if (index < 0) return hasParent && count > 1 ? 1 : 0;
    return Math.max(0, Math.min(index + delta, count - 1));
}

export function parentDirectoryFirst<T extends { original: FileInfo }>(rows: T[]): T[] {
    const parent = rows.find((row) => isParentDirEntry(row.original));
    return parent == null ? rows : [parent, ...rows.filter((row) => row !== parent)];
}

export const DirectoryColumnWidths = { logo: 32, name: 240, modestr: 112, modtime: 160, size: 104, mimetype: 152 };
export const DirectoryNameMinWidth = 160;
export const DirectoryPermMinWidth = 100;

export function getDirectoryColumnSizing(width: number, overrides: Record<string, number>): Record<string, number> {
    const sizes = { ...DirectoryColumnWidths, ...overrides };
    const fixedWidth = sizes.logo + sizes.modestr + sizes.modtime + sizes.size + sizes.mimetype;
    return { ...sizes, name: Math.max(DirectoryNameMinWidth, width - fixedWidth - 12) };
}

export function resizeDirectoryColumns(
    current: Record<string, number>,
    next: Record<string, number>
): Record<string, number> {
    const { name, ...sizes } = next;
    if (name != null && name !== current.name) {
        // The flexible Name column shares its resize boundary with Perm.
        sizes.modestr = Math.max(DirectoryPermMinWidth, current.modestr + current.name - name);
    }
    return sizes;
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

    if (deps.signal?.aborted) {
        return ConfirmationCanceledResult;
    }

    return new Promise<FileCopyResult>((resolve) => {
        let settled = false;
        let promptOpen = true;
        let unwatch: () => void = null;
        let promptMsg: ErrorMsg = null;
        const closePrompt = () => {
            promptOpen = false;
            unwatch?.();
            unwatch = null;
            deps.signal?.removeEventListener("abort", onAbort);
        };
        const settle = (result: FileCopyResult) => {
            closePrompt();
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };
        const onAbort = () => {
            if (!promptOpen) {
                return;
            }
            closePrompt();
            deps.setErrorMsg(null);
            settle(ConfirmationCanceledResult);
        };
        const runConfirmedCopy = async (opts: Partial<CommandFileCopyData["opts"]>) => {
            closePrompt();
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
        promptMsg = {
            status: "Confirm Overwrite File(s)",
            text: "This copy operation will overwrite an existing file. Would you like to continue?",
            level: "warning",
            buttons,
            closeAction: () => {
                settle(ConfirmationCanceledResult);
            },
        };
        deps.signal?.addEventListener("abort", onAbort);
        deps.setErrorMsg(promptMsg);
        if (!promptOpen) {
            return;
        }
        unwatch =
            deps.watchErrorMsg?.((msg) => {
                if (promptOpen && msg !== promptMsg) {
                    settle(ConfirmationCanceledResult);
                }
            }) ?? null;
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

export function isParentDirEntry(finfo: FileInfo): boolean {
    return finfo?.name === "..";
}

function formatItemCount(count: number): string {
    return count === 1 ? "1 item" : `${count} items`;
}

export type DeleteConfirmation = {
    status: string;
    text: string;
    buttonText: string;
    recursive: boolean;
};

// itemCount is the number of direct children (hidden files included) or null when it couldn't be listed
export function makeDeleteConfirmation(path: string, isDir: boolean, itemCount: number): DeleteConfirmation {
    if (!isDir) {
        return {
            status: "Confirm Delete File",
            text: `Permanently delete file ${path}? This cannot be undone.`,
            buttonText: "Delete",
            recursive: false,
        };
    }
    if (itemCount == null) {
        return {
            status: "Confirm Delete Folder",
            text: `Permanently delete folder ${path}? This cannot be undone.`,
            buttonText: "Delete",
            recursive: false,
        };
    }
    if (itemCount === 0) {
        return {
            status: "Confirm Delete Folder",
            text: `Permanently delete empty folder ${path}? This cannot be undone.`,
            buttonText: "Delete",
            recursive: false,
        };
    }
    return makeRecursiveDeleteConfirmation(path, itemCount);
}

export function makeRecursiveDeleteConfirmation(path: string, itemCount: number): DeleteConfirmation {
    const contents = itemCount == null ? "everything inside it" : `the ${formatItemCount(itemCount)} inside it`;
    return {
        status: "Confirm Delete Folder",
        text: `Permanently delete folder ${path} and ${contents}? This cannot be undone.`,
        buttonText: "Delete Recursively",
        recursive: true,
    };
}

async function countDirectoryEntries(model: PreviewModel, path: string): Promise<number> {
    try {
        const remotePath = await model.formatRemoteUri(path, globalStore.get);
        let count = 0;
        for await (const chunk of model.env.rpc.FileListStreamCommand(TabRpcClient, { path: remotePath }, null)) {
            count += chunk?.fileinfo?.length ?? 0;
        }
        return count;
    } catch (e) {
        console.warn(`Cannot list ${path} before delete: ${e}`);
        return null;
    }
}

function showDeleteConfirmation(
    model: PreviewModel,
    path: string,
    confirmation: DeleteConfirmation,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    setErrorMsg({
        status: confirmation.status,
        text: confirmation.text,
        level: "warning",
        buttons: [
            {
                text: confirmation.buttonText,
                onClick: () => handleFileDelete(model, path, confirmation.recursive, setErrorMsg),
            },
        ],
    });
}

export function confirmFileDelete(model: PreviewModel, finfo: FileInfo, setErrorMsg: (msg: ErrorMsg) => void) {
    if (finfo == null || isParentDirEntry(finfo)) {
        return;
    }
    if (!finfo.isdir) {
        showDeleteConfirmation(model, finfo.path, makeDeleteConfirmation(finfo.path, false, null), setErrorMsg);
        return;
    }
    fireAndForget(async () => {
        const itemCount = await countDirectoryEntries(model, finfo.path);
        showDeleteConfirmation(model, finfo.path, makeDeleteConfirmation(finfo.path, true, itemCount), setErrorMsg);
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
                const itemCount = await countDirectoryEntries(model, path);
                const confirmation = makeRecursiveDeleteConfirmation(path, itemCount);
                errorMsg = {
                    status: confirmation.status,
                    text: confirmation.text,
                    level: "warning",
                    buttons: [
                        {
                            text: confirmation.buttonText,
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
                    click: () => {
                        globalStore.set(model.treeViewMode, false);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:fileview": "list" })
                        );
                    },
                },
                {
                    label: "Tree",
                    type: "checkbox",
                    checked: treeView,
                    click: () => {
                        globalStore.set(model.treeViewMode, true);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:fileview": "tree" })
                        );
                    },
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
