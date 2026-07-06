// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";

function updateConnectionsJsonDisplayName(content: string, connName: string, displayName: string): string {
    try {
        const parsed = content.trim() === "" ? {} : JSON.parse(content);
        if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
            return content;
        }
        const existing = parsed[connName];
        const connConfig =
            typeof existing === "object" && existing != null && !Array.isArray(existing) ? { ...existing } : {};
        if (displayName === "") {
            delete connConfig["display:name"];
        } else {
            connConfig["display:name"] = displayName;
        }
        if (Object.keys(connConfig).length === 0) {
            delete parsed[connName];
        } else {
            parsed[connName] = connConfig;
        }
        return JSON.stringify(parsed, null, 2);
    } catch {
        return content;
    }
}

type ConnectionRowProps = {
    model: WaveConfigViewModel;
    connName: string;
    connConfig: ConnKeywords;
};

const ConnectionRow = memo(({ model, connName, connConfig }: ConnectionRowProps) => {
    const configDisplayName = connConfig?.["display:name"] ?? "";
    const [displayName, setDisplayName] = useState(configDisplayName);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setDisplayName(configDisplayName);
        setError("");
        setSaved(false);
    }, [configDisplayName, connName]);

    const trimmedDisplayName = displayName.trim();
    const dirty = trimmedDisplayName !== configDisplayName;

    const saveDisplayName = () => {
        if (!dirty || isSaving) {
            return;
        }
        setIsSaving(true);
        setSaved(false);
        setError("");
        const value = trimmedDisplayName === "" ? null : trimmedDisplayName;
        model.env.rpc
            .SetConnectionsConfigCommand(TabRpcClient, {
                host: connName,
                metamaptype: { "display:name": value },
            })
            .then(() => {
                const nextContent = updateConnectionsJsonDisplayName(
                    globalStore.get(model.fileContentAtom),
                    connName,
                    trimmedDisplayName
                );
                globalStore.set(model.fileContentAtom, nextContent);
                globalStore.set(model.originalContentAtom, nextContent);
                globalStore.set(model.hasEditedAtom, false);
                setSaved(true);
            })
            .catch((saveError) => {
                const message = saveError instanceof Error ? saveError.message : String(saveError);
                setError(message);
                globalStore.set(model.errorMessageAtom, `Failed to save ${connName}: ${message}`);
            })
            .finally(() => {
                setIsSaving(false);
            });
    };

    return (
        <div className="grid grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_auto] @max-w600:grid-cols-1 gap-3 px-4 py-3 border-b border-border last:border-b-0 items-center">
            <div className="min-w-0">
                <div className="font-mono text-[12px] text-primary truncate">{connName}</div>
                {connConfig?.["conn:wshenabled"] === false && (
                    <div className="text-[11px] text-muted mt-1">wsh disabled</div>
                )}
            </div>
            <input
                aria-label={`Display name for ${connName}`}
                value={displayName}
                onChange={(e) => {
                    setDisplayName(e.target.value);
                    setSaved(false);
                    setError("");
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        saveDisplayName();
                    }
                }}
                className="w-full min-w-0 bg-white/8 border border-border rounded px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
                placeholder={connName}
            />
            <div className="flex items-center justify-end gap-2 @max-w600:justify-start">
                {error && <span className="text-[11px] text-error max-w-40 truncate">{error}</span>}
                {saved && !dirty && !error && <span className="text-[11px] text-success">Saved</span>}
                <button
                    type="button"
                    onClick={saveDisplayName}
                    disabled={!dirty || isSaving}
                    className={cn(
                        "px-3 py-1.5 rounded text-sm transition-colors",
                        dirty && !isSaving
                            ? "bg-accent/80 text-primary hover:bg-accent cursor-pointer"
                            : "border border-border text-muted opacity-60"
                    )}
                >
                    {isSaving ? "Saving..." : "Save"}
                </button>
            </div>
        </div>
    );
});

ConnectionRow.displayName = "ConnectionRow";

const ConnectionsContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const fullConfig = useAtomValue(model.env.atoms.fullConfigAtom);
    const connections = useMemo(() => {
        return Object.entries(fullConfig?.connections ?? {}).sort(([connNameA, configA], [connNameB, configB]) => {
            const orderA = configA?.["display:order"] ?? 0;
            const orderB = configB?.["display:order"] ?? 0;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            const labelA = configA?.["display:name"] || connNameA;
            const labelB = configB?.["display:name"] || connNameB;
            return labelA.localeCompare(labelB);
        });
    }, [fullConfig]);

    return (
        <div className="h-full overflow-y-auto bg-background text-primary">
            <div className="max-w-4xl p-6">
                <div className="text-xl font-semibold">Connections</div>
                <div className="mt-5 border border-border bg-panel rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_auto] @max-w600:hidden gap-3 px-4 py-2 border-b border-border text-[11px] uppercase text-muted">
                        <div>Address</div>
                        <div>Name</div>
                        <div className="text-right">Status</div>
                    </div>
                    {connections.length === 0 ? (
                        <div className="px-4 py-8 text-sm text-muted">No connections</div>
                    ) : (
                        connections.map(([connName, connConfig]) => (
                            <ConnectionRow key={connName} model={model} connName={connName} connConfig={connConfig} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
});

ConnectionsContent.displayName = "ConnectionsContent";

export { ConnectionsContent, updateConnectionsJsonDisplayName };
