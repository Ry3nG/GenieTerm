// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

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

type ConnectionEntry = {
    connName: string;
    connConfig: ConnKeywords;
    discovered: boolean;
};

function getConnectionEntries(
    fullConfig: Pick<FullConfigType, "connections">,
    discoveredConnections: string[]
): ConnectionEntry[] {
    const entries = new Map<string, ConnectionEntry>();

    for (const [connName, connConfig] of Object.entries(fullConfig?.connections ?? {})) {
        entries.set(connName, { connName, connConfig, discovered: false });
    }

    for (const connName of discoveredConnections) {
        if (!entries.has(connName)) {
            entries.set(connName, { connName, connConfig: {}, discovered: true });
        }
    }

    return Array.from(entries.values()).sort((entryA, entryB) => {
        const orderA = entryA.connConfig?.["display:order"] ?? 0;
        const orderB = entryB.connConfig?.["display:order"] ?? 0;
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        const labelA = entryA.connConfig?.["display:name"] || entryA.connName;
        const labelB = entryB.connConfig?.["display:name"] || entryB.connName;
        return labelA.localeCompare(labelB);
    });
}

type ConnectionRowProps = {
    model: WaveConfigViewModel;
    connName: string;
    connConfig: ConnKeywords;
    discovered: boolean;
};

const ConnectionRow = memo(({ model, connName, connConfig, discovered }: ConnectionRowProps) => {
    const configDisplayName = connConfig?.["display:name"] ?? "";
    const [displayName, setDisplayName] = useState(configDisplayName);
    const [savedDisplayName, setSavedDisplayName] = useState(configDisplayName);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setDisplayName(configDisplayName);
        setSavedDisplayName(configDisplayName);
        setError("");
        setSaved(false);
    }, [configDisplayName, connName]);

    const trimmedDisplayName = displayName.trim();
    const dirty = trimmedDisplayName !== savedDisplayName;
    const canImport = discovered && savedDisplayName === "" && Object.keys(connConfig ?? {}).length === 0;

    const saveDisplayName = () => {
        if ((!dirty && !canImport) || isSaving) {
            return;
        }
        setIsSaving(true);
        setSaved(false);
        setError("");
        const nextDisplayName = trimmedDisplayName || (canImport ? connName : "");
        const value = nextDisplayName === "" ? null : nextDisplayName;
        model.env.rpc
            .SetConnectionsConfigCommand(TabRpcClient, {
                host: connName,
                metamaptype: { "display:name": value },
            })
            .then(() => {
                const nextContent = updateConnectionsJsonDisplayName(
                    globalStore.get(model.fileContentAtom),
                    connName,
                    nextDisplayName
                );
                globalStore.set(model.fileContentAtom, nextContent);
                globalStore.set(model.originalContentAtom, nextContent);
                globalStore.set(model.hasEditedAtom, false);
                setDisplayName(nextDisplayName);
                setSavedDisplayName(nextDisplayName);
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
                placeholder={canImport ? "Optional display name" : connName}
            />
            <div className="flex items-center justify-end gap-2 @max-w600:justify-start">
                {canImport && <span className="text-[11px] text-muted">Detected from SSH config</span>}
                {error && <span className="text-[11px] text-error max-w-40 truncate">{error}</span>}
                {saved && !dirty && !error && <span className="text-[11px] text-success">Saved</span>}
                <button
                    type="button"
                    onClick={saveDisplayName}
                    disabled={(!dirty && !canImport) || isSaving}
                    className={cn(
                        "px-3 py-1.5 rounded text-sm transition-colors",
                        (dirty || canImport) && !isSaving
                            ? "bg-accent/80 text-primary hover:bg-accent cursor-pointer"
                            : "border border-border text-muted opacity-60"
                    )}
                >
                    {isSaving ? "Saving..." : canImport ? "Add" : "Save"}
                </button>
            </div>
        </div>
    );
});

ConnectionRow.displayName = "ConnectionRow";

type AddConnectionFormProps = {
    model: WaveConfigViewModel;
    existingConnectionNames: string[];
    onAdded: (connName: string) => void;
};

const AddConnectionForm = memo(({ model, existingConnectionNames, onAdded }: AddConnectionFormProps) => {
    const [address, setAddress] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");

    const addConnection = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmedAddress = address.trim();
        const trimmedDisplayName = displayName.trim();
        if (trimmedAddress === "") {
            setError("Enter an SSH address or host alias.");
            return;
        }
        if (existingConnectionNames.includes(trimmedAddress)) {
            setError("This connection is already listed.");
            return;
        }

        setIsSaving(true);
        setError("");
        const persistedDisplayName = trimmedDisplayName || trimmedAddress;
        try {
            await model.env.rpc.SetConnectionsConfigCommand(TabRpcClient, {
                host: trimmedAddress,
                metamaptype: { "display:name": persistedDisplayName },
            });
            const nextContent = updateConnectionsJsonDisplayName(
                globalStore.get(model.fileContentAtom),
                trimmedAddress,
                persistedDisplayName
            );
            globalStore.set(model.fileContentAtom, nextContent);
            globalStore.set(model.originalContentAtom, nextContent);
            globalStore.set(model.hasEditedAtom, false);
            onAdded(trimmedAddress);
            setAddress("");
            setDisplayName("");
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : String(saveError);
            setError(message);
            globalStore.set(model.errorMessageAtom, `Failed to add ${trimmedAddress}: ${message}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={addConnection} className="mt-4 border border-border bg-panel rounded-lg p-4">
            <div className="text-sm font-semibold">Add connection</div>
            <div className="text-xs text-muted mt-1">
                Add an SSH alias from your config or a direct address such as user@host:22.
            </div>
            <div className="mt-3 flex gap-2 @max-w600:flex-col">
                <input
                    aria-label="SSH address"
                    value={address}
                    onChange={(event) => {
                        setAddress(event.target.value);
                        setError("");
                    }}
                    className="flex-1 min-w-0 bg-white/8 border border-border rounded px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
                    placeholder="user@host:22 or host alias"
                />
                <input
                    aria-label="Connection display name"
                    value={displayName}
                    onChange={(event) => {
                        setDisplayName(event.target.value);
                        setError("");
                    }}
                    className="flex-1 min-w-0 bg-white/8 border border-border rounded px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
                    placeholder="Display name (optional)"
                />
                <button
                    type="submit"
                    disabled={isSaving}
                    className={cn(
                        "px-3 py-1.5 rounded text-sm transition-colors shrink-0",
                        isSaving
                            ? "border border-border text-muted opacity-60"
                            : "bg-accent/80 text-primary hover:bg-accent cursor-pointer"
                    )}
                >
                    {isSaving ? "Adding..." : "Add"}
                </button>
            </div>
            {error && <div className="text-xs text-error mt-2">{error}</div>}
        </form>
    );
});

AddConnectionForm.displayName = "AddConnectionForm";

const ConnectionsContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const fullConfig = useAtomValue(model.env.atoms.fullConfigAtom);
    const [discoveredConnections, setDiscoveredConnections] = useState<string[]>([]);
    const [isDiscovering, setIsDiscovering] = useState(true);
    const [discoveryError, setDiscoveryError] = useState("");

    const refreshConnections = useCallback(async () => {
        setIsDiscovering(true);
        setDiscoveryError("");
        try {
            const connections = await model.env.rpc.ConnListCommand(TabRpcClient, { timeout: 2000 });
            setDiscoveredConnections(connections ?? []);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setDiscoveryError(`Unable to read SSH config: ${message}`);
        } finally {
            setIsDiscovering(false);
        }
    }, [model]);

    useEffect(() => {
        void refreshConnections();
    }, [refreshConnections]);

    const connections = useMemo(
        () => getConnectionEntries(fullConfig, discoveredConnections),
        [fullConfig, discoveredConnections]
    );
    const connectionNames = useMemo(() => connections.map((entry) => entry.connName), [connections]);

    return (
        <div className="h-full overflow-y-auto bg-background text-primary">
            <div className="max-w-4xl p-6">
                <div className="text-xl font-semibold">Connections</div>
                <div className="text-sm text-muted mt-2">
                    SSH hosts from your local SSH config are detected automatically. Saved names and custom connections
                    are stored in connections.json.
                </div>
                <div className="flex items-center gap-3 mt-3">
                    <button
                        type="button"
                        onClick={() => void refreshConnections()}
                        disabled={isDiscovering}
                        className={cn(
                            "px-3 py-1.5 rounded text-sm transition-colors",
                            isDiscovering
                                ? "border border-border text-muted opacity-60"
                                : "bg-accent/80 text-primary hover:bg-accent cursor-pointer"
                        )}
                    >
                        {isDiscovering ? "Reading SSH config..." : "Refresh SSH hosts"}
                    </button>
                    {discoveryError && <span className="text-xs text-error">{discoveryError}</span>}
                </div>
                <AddConnectionForm
                    model={model}
                    existingConnectionNames={connectionNames}
                    onAdded={(connName) => {
                        setDiscoveredConnections((current) =>
                            current.includes(connName) ? current : [...current, connName]
                        );
                    }}
                />
                <div className="mt-5 border border-border bg-panel rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[minmax(12rem,1fr)_minmax(14rem,1fr)_auto] @max-w600:hidden gap-3 px-4 py-2 border-b border-border text-[11px] uppercase text-muted">
                        <div>Address</div>
                        <div>Name</div>
                        <div className="text-right">Status</div>
                    </div>
                    {isDiscovering && connections.length === 0 ? (
                        <div className="px-4 py-8 text-sm text-muted">Reading SSH hosts...</div>
                    ) : connections.length === 0 ? (
                        <div className="px-4 py-8 text-sm text-muted">No connections found</div>
                    ) : (
                        connections.map(({ connName, connConfig, discovered }) => (
                            <ConnectionRow
                                key={connName}
                                model={model}
                                connName={connName}
                                connConfig={connConfig}
                                discovered={discovered}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
});

ConnectionsContent.displayName = "ConnectionsContent";

export { ConnectionsContent, getConnectionEntries, updateConnectionsJsonDisplayName };
