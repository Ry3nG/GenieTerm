// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { addOpenMenuItems } from "@/util/previewutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import * as React from "react";
import type { DirectorySelection, SelectionModifiers } from "./directory-selection";
import { confirmFileDelete, isIconValid, isParentDirEntry } from "./preview-directory-utils";
import { getPreviewFileName } from "./preview-file-path";
import { type PreviewModel } from "./preview-model";
import type { PreviewEnv } from "./previewenv";

const IndentPx = 14;

export function makeTreeNodeKey(connName: string, path: string): string {
    return `${connName ?? "local"}:${path}`;
}

export function makeTreeNodeRenderKey(connName: string, path: string, refreshVersion: number): string {
    return `${makeTreeNodeKey(connName, path)}:${refreshVersion}`;
}

export type FileTreeNodeMenuCtx = {
    model: PreviewModel;
    connName: string;
    setErrorMsg: (msg: ErrorMsg) => void;
};

type TreeCtx = {
    selectedPaths: Set<string>;
    entries: Map<string, FileInfo>;
    onSelect: (entry: FileInfo, event: React.MouseEvent) => void;
    model: PreviewModel;
    rpc: PreviewEnv["rpc"];
    connName: string;
    showHidden: boolean;
    expanded: Set<string>;
    refreshVersion: number;
    setErrorMsg: (msg: ErrorMsg) => void;
    iconClass: (mimeType: string) => string;
    iconColor: (mimeType: string) => string;
    onUploadFiles: (dataTransfer: DataTransfer, targetDir: string) => void;
};

function hasNativeFiles(dataTransfer: DataTransfer): boolean {
    return dataTransfer.types.includes("Files");
}

// Directories first, then alphabetical — the conventional file-tree ordering.
function sortEntries(entries: FileInfo[]): FileInfo[] {
    return [...entries].sort((a, b) => {
        const ad = a.isdir ? 0 : 1;
        const bd = b.isdir ? 0 : 1;
        if (ad !== bd) {
            return ad - bd;
        }
        return (a.name ?? "").localeCompare(b.name ?? "");
    });
}

export function makeFileTreeNodeContextMenu(ctx: FileTreeNodeMenuCtx, fileInfo: FileInfo): ContextMenuItem[] {
    const fileName = fileInfo.name ?? getPreviewFileName(fileInfo.path, ctx.connName);
    const menu: ContextMenuItem[] = [
        {
            label: "Copy File Name",
            click: () => fireAndForget(() => navigator.clipboard.writeText(fileName)),
        },
        {
            label: "Copy Full File Name",
            click: () => fireAndForget(() => navigator.clipboard.writeText(fileInfo.path)),
        },
    ];
    addOpenMenuItems(menu, ctx.connName, fileInfo);
    if (isParentDirEntry(fileInfo)) {
        return menu;
    }
    menu.push(
        {
            type: "separator",
        },
        {
            label: "Delete",
            click: () => confirmFileDelete(ctx.model, fileInfo, ctx.setErrorMsg),
        }
    );
    return menu;
}

function FileTreeNode({ ctx, fileInfo, depth }: { ctx: TreeCtx; fileInfo: FileInfo; depth: number }) {
    const isDir = !!fileInfo.isdir;
    const isExpanded = isDir && ctx.expanded.has(fileInfo.path);
    const [children, setChildren] = React.useState<FileInfo[]>(null);
    const [loading, setLoading] = React.useState(false);
    React.useEffect(() => {
        ctx.entries.set(fileInfo.path, fileInfo);
        return () => {
            ctx.entries.delete(fileInfo.path);
        };
    }, [ctx.entries, fileInfo]);

    React.useEffect(() => {
        if (!isExpanded || children != null) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        fireAndForget(async () => {
            try {
                const uri = await ctx.model.formatRemoteUri(fileInfo.path, globalStore.get);
                const entries: FileInfo[] = [];
                for await (const chunk of ctx.rpc.FileListStreamCommand(TabRpcClient, { path: uri }, null)) {
                    if (chunk?.fileinfo) {
                        entries.push(...chunk.fileinfo);
                    }
                }
                if (!cancelled) {
                    setChildren(entries);
                }
            } catch (e) {
                if (!cancelled) {
                    setChildren([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [isExpanded, fileInfo.path]);

    const visibleChildren = React.useMemo(() => {
        if (children == null) {
            return [];
        }
        return sortEntries(
            children.filter((c) => c.name !== ".." && (ctx.showHidden || !(c.name ?? "").startsWith(".")))
        );
    }, [children, ctx.showHidden]);

    const [dropOver, setDropOver] = React.useState(false);

    const onClick = (e: React.MouseEvent) => {
        // second click of a double-click: let onDoubleClick handle it so we don't
        // toggle expand back (folders) or open the file twice
        if (e.detail > 1) {
            return;
        }
        ctx.onSelect(fileInfo, e);
    };

    // double-click a folder to enter it: re-roots the tree at that folder (matches
    // the table view's double-click-to-navigate)
    const onDoubleClick = () => {
        if (!isDir) {
            fireAndForget(() =>
                createBlock({ meta: { view: "preview", file: fileInfo.path, connection: ctx.connName } })
            );
            return;
        }
        fireAndForget(() => ctx.model.goHistory(fileInfo.path));
    };

    const onContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const menu = makeFileTreeNodeContextMenu(ctx, fileInfo);
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    // Folders are upload drop targets: stop the drop from bubbling to the root
    // container so files land in THIS folder, not the tree root.
    const onDragOver = (e: React.DragEvent) => {
        if (!isDir || !hasNativeFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDropOver(true);
    };
    const onDragLeave = (e: React.DragEvent) => {
        if (!isDir) {
            return;
        }
        e.stopPropagation();
        setDropOver(false);
    };
    const onDrop = (e: React.DragEvent) => {
        if (!isDir || !hasNativeFiles(e.dataTransfer) || e.dataTransfer.files.length === 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setDropOver(false);
        ctx.onUploadFiles(e.dataTransfer, fileInfo.path);
    };

    return (
        <>
            <div
                className={cn(
                    "flex items-center gap-1.5 h-[22px] pr-2 rounded hover:bg-hoverbg cursor-pointer",
                    ctx.selectedPaths.has(fileInfo.path) && "bg-accent/15 ring-1 ring-inset ring-accent/30",
                    dropOver && "bg-accent/20 ring-1 ring-inset ring-accent/50"
                )}
                style={{ paddingLeft: depth * IndentPx + 6 }}
                onClick={onClick}
                onDoubleClick={onDoubleClick}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onContextMenu={onContextMenu}
                title={fileInfo.path}
                data-selection-path={fileInfo.path}
                aria-selected={ctx.selectedPaths.has(fileInfo.path)}
                role="treeitem"
                aria-level={depth + 1}
                aria-expanded={isDir ? isExpanded : undefined}
            >
                <span
                    className="w-3 shrink-0 text-center text-muted text-[10px]"
                    onClick={(event) => {
                        if (isDir) {
                            event.stopPropagation();
                            ctx.model.toggleTreeExpanded(fileInfo.path);
                        }
                    }}
                >
                    {isDir && (
                        <i className={cn("fa fa-solid fa-fw", isExpanded ? "fa-chevron-down" : "fa-chevron-right")} />
                    )}
                </span>
                <i
                    className={ctx.iconClass(fileInfo.mimetype ?? "")}
                    style={{ color: ctx.iconColor(fileInfo.mimetype ?? "") }}
                />
                <span className="truncate text-secondary">{fileInfo.name}</span>
                {isExpanded && loading && <i className="fa fa-solid fa-spinner fa-spin text-muted text-[10px] ml-1" />}
            </div>
            {isExpanded &&
                visibleChildren.map((c) => (
                    <FileTreeNode
                        key={makeTreeNodeKey(ctx.connName, c.path)}
                        ctx={ctx}
                        fileInfo={c}
                        depth={depth + 1}
                    />
                ))}
        </>
    );
}

export function DirectoryTreeView({
    selection,
    onSelect,
    model,
    data,
    rootDir,
    refreshVersion,
    onUploadFiles,
}: {
    selection: DirectorySelection;
    onSelect: (entry: FileInfo, visible: FileInfo[], modifiers: SelectionModifiers) => void;
    model: PreviewModel;
    data: FileInfo[];
    rootDir: string;
    refreshVersion: number;
    onUploadFiles: (dataTransfer: DataTransfer, targetDir: string) => void;
}) {
    const env = useWaveEnv<PreviewEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const connName = useAtomValue(model.connectionImmediate);
    const showHidden = useAtomValue(model.showHiddenFiles);
    const expandedArr = useAtomValue(model.treeExpanded);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const expanded = React.useMemo(() => new Set(expandedArr), [expandedArr]);
    const treeRef = React.useRef<HTMLDivElement>(null);
    const entries = React.useRef(new Map<string, FileInfo>()).current;
    const selectedPaths = React.useMemo(() => new Set(selection.files.map((file) => file.path)), [selection]);

    const iconClass = React.useCallback(
        (mimeType: string): string => {
            let mt = mimeType ?? "";
            while (mt.length > 0) {
                const icon = fullConfig.mimetypes?.[mt]?.icon ?? null;
                if (isIconValid(icon)) {
                    return `fa fa-solid fa-${icon} fa-fw`;
                }
                mt = mt.slice(0, -1);
            }
            return "fa fa-solid fa-file fa-fw";
        },
        [fullConfig.mimetypes]
    );
    const iconColor = React.useCallback(
        (mimeType: string): string => fullConfig.mimetypes?.[mimeType ?? ""]?.color ?? "inherit",
        [fullConfig.mimetypes]
    );

    const ctx: TreeCtx = {
        selectedPaths,
        entries,
        onSelect: (entry, event) => {
            const visible = Array.from(treeRef.current?.querySelectorAll<HTMLElement>("[data-selection-path]") ?? [])
                .map((element) => entries.get(element.dataset.selectionPath))
                .filter(Boolean);
            onSelect(entry, visible, event);
        },
        model,
        rpc: env.rpc,
        connName,
        showHidden,
        expanded,
        refreshVersion,
        setErrorMsg,
        iconClass,
        iconColor,
        onUploadFiles,
    };
    const rootEntries = React.useMemo(() => sortEntries((data ?? []).filter((f) => f.name !== "..")), [data]);

    // Root drop zone: folder nodes stopPropagation so they win; anything dropped
    // on empty/file rows falls through here and uploads to the current directory.
    const onRootDragOver = (e: React.DragEvent) => {
        if (!hasNativeFiles(e.dataTransfer)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    };
    const onRootDrop = (e: React.DragEvent) => {
        if (!hasNativeFiles(e.dataTransfer) || e.dataTransfer.files.length === 0) {
            return;
        }
        e.preventDefault();
        onUploadFiles(e.dataTransfer, rootDir);
    };

    return (
        <div
            ref={treeRef}
            role="tree"
            aria-label="Files"
            aria-multiselectable="true"
            className="flex h-full flex-col overflow-y-auto py-1 text-[13px]"
            onDragOver={onRootDragOver}
            onDrop={onRootDrop}
        >
            {rootEntries.map((fi) => (
                <FileTreeNode
                    key={makeTreeNodeRenderKey(connName, fi.path, refreshVersion)}
                    ctx={ctx}
                    fileInfo={fi}
                    depth={0}
                />
            ))}
        </div>
    );
}
