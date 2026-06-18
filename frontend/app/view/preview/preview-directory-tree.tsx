// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createBlock } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import * as React from "react";
import { isIconValid } from "./preview-directory-utils";
import { type PreviewModel } from "./preview-model";
import type { PreviewEnv } from "./previewenv";

const IndentPx = 14;

type TreeCtx = {
    model: PreviewModel;
    rpc: PreviewEnv["rpc"];
    connName: string;
    showHidden: boolean;
    expanded: Set<string>;
    iconClass: (mimeType: string) => string;
    iconColor: (mimeType: string) => string;
};

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

function FileTreeNode({ ctx, fileInfo, depth }: { ctx: TreeCtx; fileInfo: FileInfo; depth: number }) {
    const isDir = !!fileInfo.isdir;
    const isExpanded = isDir && ctx.expanded.has(fileInfo.path);
    const [children, setChildren] = React.useState<FileInfo[]>(null);
    const [loading, setLoading] = React.useState(false);

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

    const onClick = () => {
        if (isDir) {
            ctx.model.toggleTreeExpanded(fileInfo.path);
            return;
        }
        fireAndForget(() =>
            createBlock({ meta: { view: "preview", file: fileInfo.path, connection: ctx.connName } })
        );
    };

    return (
        <>
            <div
                className="flex items-center gap-1.5 h-[22px] pr-2 rounded hover:bg-hoverbg cursor-pointer"
                style={{ paddingLeft: depth * IndentPx + 6 }}
                onClick={onClick}
                title={fileInfo.path}
            >
                <span className="w-3 shrink-0 text-center text-muted text-[10px]">
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
                visibleChildren.map((c) => <FileTreeNode key={c.path} ctx={ctx} fileInfo={c} depth={depth + 1} />)}
        </>
    );
}

export function DirectoryTreeView({ model, data }: { model: PreviewModel; data: FileInfo[] }) {
    const env = useWaveEnv<PreviewEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const connName = useAtomValue(model.connectionImmediate);
    const showHidden = useAtomValue(model.showHiddenFiles);
    const expandedArr = useAtomValue(model.treeExpanded);
    const expanded = React.useMemo(() => new Set(expandedArr), [expandedArr]);

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

    const ctx: TreeCtx = { model, rpc: env.rpc, connName, showHidden, expanded, iconClass, iconColor };
    const rootEntries = React.useMemo(() => sortEntries((data ?? []).filter((f) => f.name !== "..")), [data]);

    return (
        <div className="flex h-full flex-col overflow-y-auto py-1 text-[13px]">
            {rootEntries.map((fi) => (
                <FileTreeNode key={fi.path} ctx={ctx} fileInfo={fi} depth={0} />
            ))}
        </div>
    );
}
