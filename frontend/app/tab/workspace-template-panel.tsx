// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv, type WaveEnv, type WaveEnvSubset } from "@/app/waveenv/waveenv";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import {
    captureTemplateTab,
    instantiateTemplateLayout,
    MaxWorkspaceTemplates,
    readWorkspaceTemplates,
    resolveTemplateMeta,
    WorkspaceTemplatePrefix,
    type WorkspaceTemplate,
    type WorkspaceTemplateNode,
} from "./workspace-templates";

function SetupLayoutPreview({ node, blocks }: { node: WorkspaceTemplateNode; blocks: MetaType[] }) {
    if (!node) return null;
    if (node.block != null) {
        const view = blocks[node.block]?.view;
        const label = view === "term" ? "Terminal" : view === "preview" ? "Files" : view === "web" ? "Web" : "Host";
        return (
            <div
                className="flex min-w-0 items-center justify-center rounded border border-accent/20 bg-accent/5 px-1 text-[9px] text-muted"
                style={{ flex: node.size }}
            >
                <span className="truncate">{label}</span>
            </div>
        );
    }
    return (
        <div className="flex min-w-0 gap-1" style={{ flex: node.size, flexDirection: node.direction }}>
            {node.children?.map((child, index) => (
                <SetupLayoutPreview key={index} node={child} blocks={blocks} />
            ))}
        </div>
    );
}

export type WorkspaceTemplateEnv = WaveEnvSubset<{
    services: {
        workspace: WaveEnv["services"]["workspace"];
        object: WaveEnv["services"]["object"];
        client: WaveEnv["services"]["client"];
    };
    rpc: { CreateBlockCommand: WaveEnv["rpc"]["CreateBlockCommand"] };
    electron: { switchWorkspace: WaveEnv["electron"]["switchWorkspace"] };
    atoms: { fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"] };
}>;

export function WorkspaceTemplatePanel({ workspace }: { workspace: Workspace }) {
    const env = useWaveEnv<WorkspaceTemplateEnv>();
    const config = useAtomValue(env.atoms.fullConfigAtom);
    const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
    const [selected, setSelected] = useState<WorkspaceTemplate>(null);
    const [name, setName] = useState(workspace.name || "My setup");
    const [connection, setConnection] = useState("");
    const [folder, setFolder] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);

    const refresh = async () => {
        const client = await env.services.client.GetClientData();
        setTemplates(readWorkspaceTemplates(client.meta));
    };
    useEffect(() => {
        refresh().catch((err) => setError(String(err)));
    }, []);

    const capture = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
            const client = await env.services.client.GetClientData();
            if (readWorkspaceTemplates(client.meta).length >= MaxWorkspaceTemplates)
                throw new Error("Remove a setup before saving another.");
            if (workspace.tabids.length > 20) throw new Error("Setups support up to 20 tabs.");
            const tabs = [];
            for (const tabid of workspace.tabids) {
                const tab = (await env.services.object.GetObject(`tab:${tabid}`)) as Tab;
                const objects = await env.services.object.GetObjects([
                    `layout:${tab.layoutstate}`,
                    ...tab.blockids.map((id) => `block:${id}`),
                ]);
                const layout = objects.find(
                    (object) => object.otype === "layout" && object.oid === tab.layoutstate
                ) as LayoutState;
                const blocksById = new Map(
                    objects.filter((object) => object.otype === "block").map((object) => [object.oid, object as Block])
                );
                const blocks = tab.blockids.map((id) => blocksById.get(id)).filter(Boolean);
                if (!layout || blocks.length !== tab.blockids.length)
                    throw new Error("The workspace changed during capture. Try saving again.");
                tabs.push(captureTemplateTab(tab.name, layout.rootnode, blocks));
            }
            const template: WorkspaceTemplate = {
                version: 1,
                id: crypto.randomUUID(),
                name: name.trim(),
                icon: workspace.icon || "layer-group",
                color: workspace.color,
                tabs,
            };
            await env.services.object.UpdateObjectMeta(`client:${client.oid}`, {
                [`${WorkspaceTemplatePrefix}${template.id}`]: template,
            } as MetaType);
            await refresh();
            setSaving(false);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (template: WorkspaceTemplate) => {
        setBusy(true);
        try {
            const client = await env.services.client.GetClientData();
            await env.services.object.UpdateObjectMeta(`client:${client.oid}`, {
                [`${WorkspaceTemplatePrefix}${template.id}`]: null,
            } as MetaType);
            await refresh();
            if (selected?.id === template.id) setSelected(null);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    const launch = async () => {
        if (!selected || busy) return;
        setBusy(true);
        setError("");
        let workspaceid: string;
        try {
            workspaceid = await env.services.workspace.CreateWorkspaceSetup(
                selected.name,
                selected.icon,
                selected.color || ""
            );
            const created = await env.services.workspace.GetWorkspace(workspaceid);
            for (const [index, templateTab] of selected.tabs.entries()) {
                const tabid =
                    index === 0
                        ? created.tabids[0]
                        : await env.services.workspace.CreateTabSetup(workspaceid, templateTab.name);
                const tab = (await env.services.object.GetObject(`tab:${tabid}`)) as Tab;
                const blockids: string[] = [];
                for (const meta of templateTab.blocks) {
                    const block = await env.rpc.CreateBlockCommand(TabRpcClient, {
                        tabid,
                        blockdef: { meta: resolveTemplateMeta(meta, connection, folder) },
                    });
                    blockids.push(block.replace(/^block:/, ""));
                }
                const layout = (await env.services.object.GetObject(`layout:${tab.layoutstate}`)) as LayoutState;
                const rootnode = instantiateTemplateLayout(templateTab.layout, blockids);
                await env.services.object.UpdateObject(
                    {
                        ...layout,
                        rootnode,
                        pendingbackendactions: [],
                        leaforder: [],
                        focusednodeid: null,
                        magnifiednodeid: null,
                    } as LayoutState,
                    true
                );
                const populated = (await env.services.object.GetObject(`tab:${tabid}`)) as Tab;
                await env.services.object.UpdateObject({ ...populated, name: templateTab.name } as Tab, true);
            }
            env.electron.switchWorkspace(workspaceid);
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        } catch (err) {
            let cleanup = "";
            if (workspaceid) {
                try {
                    await env.services.workspace.DeleteWorkspace(workspaceid);
                } catch {
                    cleanup = " The incomplete workspace is still available in the workspace list.";
                }
            }
            setError(`${err}${cleanup}`);
        } finally {
            setBusy(false);
        }
    };

    const button = "cursor-pointer rounded px-2 py-1 text-xs hover:bg-hoverbg transition-colors disabled:opacity-40";
    const field =
        "min-w-0 w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs focus:border-accent outline-none";
    return (
        <section className="w-full border-t border-border px-3 py-2" aria-label="Workspace setups">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                <span>Saved setups</span>
                <button
                    className={button}
                    disabled={busy}
                    title="Capture this workspace layout"
                    onClick={() => {
                        setSaving(!saving);
                        setSelected(null);
                    }}
                >
                    <i aria-hidden="true" className="fa-solid fa-plus mr-1" />
                    Save current
                </button>
            </div>
            {saving && (
                <div className="flex flex-col gap-2 pt-2">
                    <input
                        className={field}
                        value={name}
                        maxLength={80}
                        onChange={(e) => setName(e.target.value)}
                        aria-label="Setup name"
                    />
                    <span className="text-[11px] text-muted">
                        Layout, pane types, hosts and folders. Commands and running sessions are excluded.
                    </span>
                    <button
                        className="bg-accent/80 text-primary rounded hover:bg-accent transition-colors cursor-pointer px-2 py-1 text-xs disabled:opacity-40"
                        disabled={busy || !name.trim()}
                        onClick={() => void capture()}
                    >
                        {busy ? "Saving…" : "Save setup"}
                    </button>
                </div>
            )}
            {!templates.length && !saving && (
                <p className="text-[11px] text-muted py-2">Reuse a workspace layout with a different host or folder.</p>
            )}
            <div className="max-h-48 overflow-y-auto">
                {templates.map((template) => (
                    <div key={template.id} className="flex items-center gap-1 mt-1">
                        <button
                            className={cn(
                                button,
                                "flex-1 text-left truncate",
                                selected?.id === template.id && "bg-hoverbg"
                            )}
                            disabled={busy}
                            onClick={() => {
                                setSelected(template);
                                setSaving(false);
                                const meta = template.tabs
                                    .flatMap((tab) => tab.blocks)
                                    .find((block) => block.view !== "web");
                                setConnection(meta?.connection || "");
                                setFolder(meta?.["cmd:cwd"] || (meta?.view === "preview" ? meta.file : "") || "~");
                            }}
                        >
                            {template.name}
                        </button>
                        <button
                            className={button}
                            disabled={busy}
                            aria-label={`Delete setup ${template.name}`}
                            onClick={() => void remove(template)}
                        >
                            <i className="fa-solid fa-xmark text-muted" />
                        </button>
                    </div>
                ))}
            </div>
            {selected && (
                <div className="flex flex-col gap-2 border-t border-border mt-2 pt-2">
                    <div className="text-[11px] text-muted">
                        {selected.tabs.length} tabs · {selected.tabs.reduce((sum, tab) => sum + tab.blocks.length, 0)}{" "}
                        fresh panes
                    </div>
                    <div className="flex h-16 gap-1" aria-label="First tab layout preview">
                        <SetupLayoutPreview node={selected.tabs[0]?.layout} blocks={selected.tabs[0]?.blocks ?? []} />
                    </div>
                    <label className="text-[11px] text-muted">
                        Host
                        <select
                            className={cn(field, "mt-1 text-secondary")}
                            value={connection}
                            onChange={(e) => setConnection(e.target.value)}
                        >
                            <option value="">Local</option>
                            {Array.from(new Set([connection, ...Object.keys(config?.connections ?? {})]))
                                .filter(Boolean)
                                .map((host) => (
                                    <option key={host} value={host}>
                                        {host}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <label className="text-[11px] text-muted">
                        Folder
                        <input
                            className={cn(field, "mt-1 text-secondary")}
                            value={folder}
                            onChange={(e) => setFolder(e.target.value)}
                            placeholder="~"
                        />
                    </label>
                    <div className="flex flex-wrap gap-1">
                        {selected.tabs
                            .flatMap((tab) => tab.blocks)
                            .slice(0, 8)
                            .map((block, index) => (
                                <span key={index} className="rounded bg-hoverbg px-1.5 py-0.5 text-[10px] text-muted">
                                    {block.view === "preview"
                                        ? "Files"
                                        : block.view === "term"
                                          ? "Terminal"
                                          : block.view}
                                </span>
                            ))}
                    </div>
                    <button
                        className="bg-accent/80 text-primary rounded hover:bg-accent transition-colors cursor-pointer px-2 py-1.5 text-xs disabled:opacity-40"
                        disabled={busy}
                        onClick={() => void launch()}
                    >
                        {busy ? "Opening…" : "Open workspace"}
                    </button>
                </div>
            )}
            {error && (
                <p role="alert" className="text-xs text-error pt-2 break-words">
                    {error}
                </p>
            )}
        </section>
    );
}
