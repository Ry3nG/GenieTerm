// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FlexDirection, type LayoutNode } from "@/layout/lib/types";

export const WorkspaceTemplatePrefix = "workspace:template:";
export const MaxWorkspaceTemplates = 30;
const MaxTemplateBlocks = 100;
const SupportedViews = new Set(["term", "preview", "web", "sysinfo", "host", "processviewer", "waveconfig"]);

export type WorkspaceTemplateNode = {
    direction: "row" | "column";
    size: number;
    block?: number;
    children?: WorkspaceTemplateNode[];
};

export type WorkspaceTemplateTab = {
    name: string;
    blocks: MetaType[];
    layout: WorkspaceTemplateNode;
};

export type WorkspaceTemplate = {
    version: 1;
    id: string;
    name: string;
    icon: string;
    color: string;
    tabs: WorkspaceTemplateTab[];
};

export function captureTemplateMeta(meta: MetaType): MetaType {
    const view = SupportedViews.has(meta?.view) ? meta.view : "term";
    const captured: MetaType = { view };
    if (view === "term") captured.controller = "shell";
    for (const key of ["connection", "cmd:cwd", "frame:title"] as const) {
        if (typeof meta?.[key] === "string") captured[key] = meta[key];
    }
    if (view === "preview" && typeof meta.file === "string") captured.file = meta.file;
    if (view === "web" && typeof meta.url === "string" && /^https?:\/\//i.test(meta.url)) {
        try {
            const url = new URL(meta.url);
            url.username = "";
            url.password = "";
            url.search = "";
            url.hash = "";
            captured.url = url.toString();
        } catch {
            return captured;
        }
    }
    return captured;
}

export function captureTemplateTab(name: string, root: LayoutNode, blocks: Block[]): WorkspaceTemplateTab {
    if (blocks.length > MaxTemplateBlocks) throw new Error(`Setups support up to ${MaxTemplateBlocks} panes per tab.`);
    const captured: MetaType[] = [];
    const blockMap = new Map(blocks.map((block) => [block.oid, block]));
    const used = new Set<string>();
    const visit = (node: LayoutNode, depth = 0): WorkspaceTemplateNode => {
        if (!node || depth > 20 || captured.length >= MaxTemplateBlocks) return null;
        const size = Number.isFinite(node.size) && node.size > 0 ? node.size : 10;
        const direction = node.flexDirection === FlexDirection.Column ? "column" : "row";
        const block = blockMap.get(node.data?.blockId);
        if (block && !used.has(block.oid)) {
            used.add(block.oid);
            const index = captured.push(captureTemplateMeta(block.meta)) - 1;
            return { direction, size, block: index };
        }
        const children = node.children?.map((child) => visit(child, depth + 1)).filter(Boolean);
        return children?.length ? { direction, size, children } : null;
    };
    let layout = visit(root);
    for (const block of blocks) {
        if (used.has(block.oid) || captured.length >= MaxTemplateBlocks) continue;
        const index = captured.push(captureTemplateMeta(block.meta)) - 1;
        const node: WorkspaceTemplateNode = { direction: "row", size: 10, block: index };
        layout = layout ? { direction: "row", size: 10, children: [layout, node] } : node;
    }
    return { name, blocks: captured, layout };
}

export function instantiateTemplateLayout(
    node: WorkspaceTemplateNode,
    blockids: string[],
    createId: () => string = () => crypto.randomUUID()
): LayoutNode {
    if (!node) return null;
    return {
        id: createId(),
        flexDirection: node.direction === "column" ? FlexDirection.Column : FlexDirection.Row,
        size: node.size,
        ...(node.block != null
            ? { data: { blockId: blockids[node.block] } }
            : { children: node.children?.map((child) => instantiateTemplateLayout(child, blockids, createId)) ?? [] }),
    };
}

export function resolveTemplateMeta(meta: MetaType, connection?: string, folder = ""): MetaType {
    const resolved = captureTemplateMeta(meta);
    if (resolved.view !== "web" && connection != null) resolved.connection = connection || undefined;
    if (resolved.view === "term") resolved["cmd:cwd"] = folder.trim() || meta["cmd:cwd"] || "~";
    if (resolved.view === "preview" && folder.trim()) resolved.file = folder.trim();
    return resolved;
}

export function readWorkspaceTemplates(meta: MetaType): WorkspaceTemplate[] {
    return Object.entries(meta ?? {})
        .filter(([key, value]) => key.startsWith(WorkspaceTemplatePrefix) && value != null)
        .map(([, value]) => value as unknown as WorkspaceTemplate)
        .filter(
            (value) =>
                value != null &&
                value.version === 1 &&
                typeof value.id === "string" &&
                typeof value.name === "string" &&
                Array.isArray(value.tabs) &&
                value.tabs.length > 0 &&
                value.tabs.length <= 20 &&
                value.tabs.every(
                    (tab) =>
                        tab != null &&
                        typeof tab.name === "string" &&
                        Array.isArray(tab.blocks) &&
                        tab.blocks.length <= MaxTemplateBlocks &&
                        tab.blocks.every((block) => block != null && typeof block === "object")
                )
        )
        .slice(0, MaxWorkspaceTemplates)
        .sort((a, b) => a.name.localeCompare(b.name));
}
