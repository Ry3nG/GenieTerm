// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useMemo, useState } from "react";
import type { HostViewModel } from "./host-model";
import {
    forwardStatusText,
    forwardsWithoutListener,
    forwardUrl,
    isBackgroundListener,
    isForwardable,
    isLikelyHttp,
    makePortRows,
    parsePortInput,
    PortRow,
} from "./hostutil";

const SecondaryButton =
    "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50";
const AccentButton =
    "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-accent/80 px-2.5 text-[12px] font-medium text-primary transition-colors hover:bg-accent disabled:opacity-50";
const IconButton =
    "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-primary";

const StatusDot: Record<string, string> = {
    active: "bg-success",
    waiting: "bg-warning",
    error: "bg-error",
};

function copyText(text: string) {
    fireAndForget(() => navigator.clipboard.writeText(text));
}

function ForwardBadge({ forward }: { forward: PortForwardInfo }) {
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", StatusDot[forward.status] ?? "bg-muted")} />
            <span className="min-w-0 truncate" title={forwardStatusText(forward)}>
                {forward.status === "active" ? `localhost:${forward.localport}` : forwardStatusText(forward)}
            </span>
        </span>
    );
}

function ForwardActions({
    model,
    forward,
    openable,
}: {
    model: HostViewModel;
    forward: PortForwardInfo;
    openable: boolean;
}) {
    return (
        <div className="flex items-center justify-end gap-1">
            {openable && (
                <button className={AccentButton} onClick={() => model.openLocalPort(forward.localport)}>
                    Open
                </button>
            )}
            <Tooltip content="Copy local address" placement="top">
                <button
                    className={IconButton}
                    onClick={() => copyText(forwardUrl(forward))}
                    aria-label="Copy local address"
                >
                    <i className="fa-regular fa-copy text-[12px]" />
                </button>
            </Tooltip>
            <Tooltip content="Stop forwarding" placement="top">
                <button
                    className={IconButton}
                    onClick={() => fireAndForget(() => model.stopForward(forward))}
                    aria-label="Stop forwarding"
                >
                    <i className="fa-solid fa-xmark text-[13px]" />
                </button>
            </Tooltip>
        </div>
    );
}

const PortRowView = memo(({ model, row, canForward }: { model: HostViewModel; row: PortRow; canForward: boolean }) => {
    const action = useAtomValue(model.forwardActionAtom);
    const busy = action?.busy && action.port === row.port;
    const error = !action?.busy && action?.port === row.port ? action.error : "";
    const openable = isLikelyHttp(row.port, row.command);
    let actions: React.ReactNode = null;
    if (row.forward) {
        actions = <ForwardActions model={model} forward={row.forward} openable={openable} />;
    } else if (canForward && isForwardable(row.port, row.command)) {
        actions = (
            <div className="flex justify-end">
                <button
                    className={SecondaryButton}
                    disabled={busy}
                    onClick={() => fireAndForget(() => model.startForward(row.port, 0, openable))}
                >
                    {busy ? (
                        <i className="fa-solid fa-circle-notch fa-spin text-[11px]" aria-hidden="true" />
                    ) : (
                        <i className="fa-solid fa-arrow-right-to-bracket text-[11px]" aria-hidden="true" />
                    )}
                    {busy ? "Forwarding…" : openable ? "Forward & open" : "Forward"}
                </button>
            </div>
        );
    } else if (openable) {
        actions = (
            <div className="flex justify-end">
                <button className={SecondaryButton} onClick={() => model.openLocalPort(row.port)}>
                    Open
                </button>
            </div>
        );
    }
    return (
        <div className="group border-b border-border/60 last:border-b-0">
            <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 transition-colors hover:bg-hover/60 @[640px]:grid-cols-[72px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(150px,auto)]">
                <div className="font-mono text-[13px] font-semibold tabular-nums text-primary">{row.port}</div>
                <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] text-primary">
                            {row.service || row.command || "Unknown process"}
                        </span>
                        {row.forward && <ForwardBadge forward={row.forward} />}
                    </div>
                    <div className="truncate text-[12px] text-muted">
                        {[row.service ? row.command : "", row.pid ? `pid ${row.pid}` : "", row.user]
                            .filter(Boolean)
                            .join(" · ") || "Owner not visible"}
                    </div>
                </div>
                <div
                    className="hidden min-w-0 truncate text-[12px] text-muted @[640px]:block"
                    title={row.addresses.join(", ")}
                >
                    {row.scope.label}
                </div>
                {actions ?? <div />}
            </div>
            {error && <div className="px-4 pb-2 pl-[100px] text-[12px] text-error">{error}</div>}
        </div>
    );
});
PortRowView.displayName = "PortRowView";

function ForwardPortForm({ model, onDone }: { model: HostViewModel; onDone: () => void }) {
    const [remote, setRemote] = useState("");
    const [local, setLocal] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        const remotePort = parsePortInput(remote);
        const localPort = local.trim() === "" ? 0 : parsePortInput(local);
        if (remotePort === 0 || (local.trim() !== "" && localPort === 0)) {
            setError("Ports are numbers from 1 to 65535.");
            return;
        }
        setBusy(true);
        const forward = await model.startForward(remotePort, localPort, false);
        setBusy(false);
        if (forward == null) {
            setError("");
            return;
        }
        onDone();
    };
    const inputClass =
        "h-7 w-24 rounded-md border border-border bg-background px-2 text-[12px] tabular-nums text-primary outline-none placeholder:text-muted focus:border-accent";
    return (
        <form
            className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5"
            onSubmit={(e) => {
                e.preventDefault();
                fireAndForget(submit);
            }}
        >
            <label className="text-[12px] text-secondary" htmlFor={`${model.blockId}-remote-port`}>
                Remote port
            </label>
            <input
                id={`${model.blockId}-remote-port`}
                className={inputClass}
                value={remote}
                autoFocus
                inputMode="numeric"
                placeholder="8888"
                onChange={(e) => setRemote(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && onDone()}
            />
            <label className="text-[12px] text-secondary" htmlFor={`${model.blockId}-local-port`}>
                to localhost:
            </label>
            <input
                id={`${model.blockId}-local-port`}
                className={inputClass}
                value={local}
                inputMode="numeric"
                placeholder="same"
                onChange={(e) => setLocal(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && onDone()}
            />
            <button type="submit" className={AccentButton} disabled={busy}>
                {busy ? "Forwarding…" : "Forward"}
            </button>
            <button type="button" className={SecondaryButton} onClick={onDone}>
                Cancel
            </button>
            {error && <span className="w-full text-[12px] text-error">{error}</span>}
        </form>
    );
}

export const HostPorts = memo(({ model }: { model: HostViewModel }) => {
    const state = useAtomValue(model.portsAtom);
    const forwards = useAtomValue(model.forwardsAtom);
    const canForward = useAtomValue(model.canForwardAtom);
    const action = useAtomValue(model.forwardActionAtom);
    const [formOpen, setFormOpen] = useState(false);
    const [showOther, setShowOther] = useState(false);
    const rows = useMemo(() => makePortRows(state.data?.ports ?? [], forwards), [state.data, forwards]);
    const mainRows = rows.filter((r) => !isBackgroundListener(r));
    const otherRows = rows.filter(isBackgroundListener);
    const orphanForwards = useMemo(() => forwardsWithoutListener(rows, forwards), [rows, forwards]);
    const actionError = action && !action.busy && action.error && !rows.some((r) => r.port === action.port);

    if (state.loading && state.data == null) {
        return (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">
                <i className="fa-solid fa-circle-notch fa-spin mr-2 text-[12px]" aria-hidden="true" />
                Looking for listening ports…
            </div>
        );
    }
    if (state.outdated) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
                <i className="fa-solid fa-plug mb-1 text-[18px] text-muted" aria-hidden="true" />
                <div className="text-[13px] font-medium text-primary">
                    Listening ports need the current genie helper
                </div>
                <div className="max-w-sm text-[12px] text-muted">Use Update helper above; it takes a few seconds.</div>
            </div>
        );
    }
    return (
        <div className="@container flex flex-col">
            <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
                <div className="min-w-0 flex-1 text-[12px] text-muted">
                    {state.error ? (
                        <span className="text-error">{state.error}</span>
                    ) : (
                        `${mainRows.length} listening ${mainRows.length === 1 ? "port" : "ports"}`
                    )}
                </div>
                {canForward && !formOpen && (
                    <button className={SecondaryButton} onClick={() => setFormOpen(true)}>
                        <i className="fa-solid fa-plus text-[11px]" aria-hidden="true" />
                        Forward a port
                    </button>
                )}
                <Tooltip content="Refresh" placement="top">
                    <button
                        className={IconButton}
                        onClick={() => fireAndForget(() => model.refreshPorts())}
                        aria-label="Refresh ports"
                    >
                        <i className="fa-solid fa-arrows-rotate text-[12px]" />
                    </button>
                </Tooltip>
            </div>
            {formOpen && <ForwardPortForm model={model} onDone={() => setFormOpen(false)} />}
            {actionError && (
                <div className="border-b border-border px-4 py-2 text-[12px] text-error">{action.error}</div>
            )}
            {orphanForwards.length > 0 && (
                <div className="border-b border-border">
                    {orphanForwards.map((f) => (
                        <div
                            key={f.id}
                            className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2"
                        >
                            <div className="font-mono text-[13px] font-semibold tabular-nums text-primary">
                                {f.remoteport}
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-[13px] text-primary">
                                    localhost:{f.localport} → {f.remoteport}
                                </div>
                                <div className="truncate text-[12px] text-muted">
                                    {f.status === "error"
                                        ? forwardStatusText(f)
                                        : "Nothing is listening on this port right now"}
                                </div>
                            </div>
                            <ForwardActions model={model} forward={f} openable={false} />
                        </div>
                    ))}
                </div>
            )}
            {mainRows.length === 0 && !state.error ? (
                <div className="px-4 py-10 text-center text-[13px] text-muted">
                    {otherRows.length > 0
                        ? "No servers of yours are listening right now."
                        : "Nothing is listening on TCP ports."}
                </div>
            ) : (
                <div>
                    {mainRows.map((row) => (
                        <PortRowView key={row.key} model={model} row={row} canForward={canForward} />
                    ))}
                </div>
            )}
            {otherRows.length > 0 && (
                <div className="border-t border-border">
                    <button
                        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-[12px] text-muted transition-colors hover:text-primary"
                        aria-expanded={showOther}
                        onClick={() => setShowOther((v) => !v)}
                    >
                        <i
                            className={cn(
                                "fa-solid fa-chevron-right text-[9px] transition-transform",
                                showOther && "rotate-90"
                            )}
                            aria-hidden="true"
                        />
                        Other listeners · {otherRows.length}
                        <span className="text-muted/70">
                            GenieTerm, system services, other users and ephemeral ports
                        </span>
                    </button>
                    {showOther &&
                        otherRows.map((row) => (
                            <PortRowView key={row.key} model={model} row={row} canForward={canForward} />
                        ))}
                </div>
            )}
            {state.data?.partial && (
                <div className="px-4 py-3 text-[12px] text-muted">
                    Some sockets belong to other users, so their processes aren't shown.
                </div>
            )}
        </div>
    );
});
HostPorts.displayName = "HostPorts";
