// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { HostViewModel } from "./host-model";
import { makeSavedService, serviceForward, servicePortNote } from "./host-services-util";
import { forwardUrl, isLikelyHttp } from "./hostutil";

const Button =
    "inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50";
const Input =
    "h-8 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-[12px] text-primary outline-none placeholder:text-muted focus:border-accent";

function ServiceEditor({ model, draft }: { model: HostViewModel; draft: SavedPortService }) {
    const [name, setName] = useState(draft.name);
    const [host, setHost] = useState(draft.remotehost);
    const [remote, setRemote] = useState(draft.remoteport ? String(draft.remoteport) : "");
    const [local, setLocal] = useState(draft.localport ? String(draft.localport) : "");
    const [restore, setRestore] = useState(draft.restore);
    const [error, setError] = useState("");
    const action = useAtomValue(model.serviceActionAtom);
    const submit = async () => {
        try {
            const service = makeSavedService(draft.id, name, host, remote, local, restore);
            setError("");
            await model.saveService(service);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    return (
        <form
            className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/5 p-3.5"
            onSubmit={(event) => {
                event.preventDefault();
                fireAndForget(submit);
            }}
        >
            <label className="flex flex-col gap-1.5 text-[11px] text-secondary">
                Service name
                <input
                    autoFocus
                    maxLength={80}
                    className={Input}
                    placeholder="Development API"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
            </label>
            <div className="grid grid-cols-2 gap-3 @[600px]:grid-cols-[2fr_1fr_1fr]">
                <label className="col-span-2 flex flex-col gap-1.5 text-[11px] text-secondary @[600px]:col-span-1">
                    Remote address
                    <input
                        className={Input}
                        value={host}
                        placeholder="127.0.0.1"
                        onChange={(event) => setHost(event.target.value)}
                    />
                </label>
                <label className="flex flex-col gap-1.5 text-[11px] text-secondary">
                    Remote port
                    <input
                        className={Input}
                        inputMode="numeric"
                        value={remote}
                        placeholder="3000"
                        onChange={(event) => setRemote(event.target.value)}
                    />
                </label>
                <label className="flex flex-col gap-1.5 text-[11px] text-secondary">
                    Local port
                    <input
                        className={Input}
                        inputMode="numeric"
                        value={local}
                        placeholder="Automatic"
                        onChange={(event) => setLocal(event.target.value)}
                    />
                </label>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-secondary">
                <input
                    className="mt-0.5 cursor-pointer accent-accent"
                    type="checkbox"
                    checked={restore}
                    onChange={(event) => setRestore(event.target.checked)}
                />
                <span>
                    Restore when this host connects
                    <span className="mt-0.5 inline-block text-[11px] leading-4 text-muted">
                        Reopens the local tunnel on a new SSH connection, including after restarting GenieTerm.
                    </span>
                </span>
            </label>
            {error && (
                <p role="alert" className="text-[12px] text-error">
                    {error}
                </p>
            )}
            <div className="flex gap-2">
                <button
                    className="h-7 cursor-pointer rounded-md bg-accent/80 px-3 text-[12px] font-medium text-primary transition-colors hover:bg-accent disabled:opacity-50"
                    disabled={action.busy}
                    type="submit"
                >
                    {action.busy ? "Saving…" : "Save service"}
                </button>
                <button
                    type="button"
                    className={Button}
                    disabled={action.busy}
                    onClick={() => globalStore.set(model.serviceDraftAtom, null)}
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}

export function HostServices({ model }: { model: HostViewModel }) {
    const services = useAtomValue(model.savedServicesAtom);
    const forwards = useAtomValue(model.forwardsAtom);
    const canForward = useAtomValue(model.canForwardAtom);
    const status = useAtomValue(model.connStatus);
    const draft = useAtomValue(model.serviceDraftAtom);
    const action = useAtomValue(model.serviceActionAtom);
    const forwardAction = useAtomValue(model.forwardActionAtom);
    const connected = status?.status === "connected" || model.env.isMock;
    if (!canForward) {
        return null;
    }
    return (
        <section className="@container flex flex-col gap-3 border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-[13px] font-semibold text-primary">
                        Saved services{" "}
                        <span className="ml-1 text-[11px] font-normal text-muted">{services.length || ""}</span>
                    </h3>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                        Named tunnels for this host, remembered across restarts.
                    </p>
                </div>
                <button className={Button} disabled={action.busy} onClick={() => model.editService()}>
                    <i className="fa-solid fa-plus text-[10px]" aria-hidden="true" />
                    New
                </button>
            </div>
            {draft && <ServiceEditor key={draft.id} model={model} draft={draft} />}
            {action.error && (
                <p role="alert" className="text-[12px] text-error">
                    {action.error}
                </p>
            )}
            {!services.length && !draft && (
                <div className="rounded-lg border border-dashed border-border px-3 py-3 text-[12px] leading-5 text-muted">
                    Save a service here, or use the bookmark beside an active forward. Automatic restore is off until
                    you enable it.
                </div>
            )}
            {services.map((service) => {
                const forward = serviceForward(service, forwards);
                const failedRestore = forward?.id.startsWith("saved:");
                const running = forward != null && !failedRestore;
                const busy =
                    forwardAction?.busy &&
                    forwardAction.port === service.remoteport &&
                    forwardAction.remoteHost === service.remotehost;
                const error =
                    forward?.error ||
                    (!forwardAction?.busy &&
                    forwardAction?.port === service.remoteport &&
                    forwardAction?.remoteHost === service.remotehost
                        ? forwardAction.error
                        : "");
                const note = servicePortNote(service, forward);
                const label = error
                    ? "Needs attention"
                    : !running
                      ? "Saved · stopped"
                      : !connected
                        ? "Connection lost"
                        : forward.status === "active"
                          ? "Traffic active"
                          : "Forward ready";
                return (
                    <article key={service.id} className="rounded-xl border border-border bg-panel px-3.5 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="min-w-0 truncate text-[13px] font-medium text-primary">{service.name}</h4>
                            <span
                                className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                                    error
                                        ? "bg-error/10 text-error"
                                        : running && connected
                                          ? "bg-success/10 text-success"
                                          : "bg-hover text-muted"
                                )}
                            >
                                {label}
                            </span>
                        </div>
                        <div className="mt-1.5 break-all font-mono text-[11px] leading-5 text-secondary">
                            localhost:{running ? forward.localport : service.localport || "auto"}{" "}
                            <span className="text-muted">→</span> {service.remotehost}:{service.remoteport}
                        </div>
                        <div className="mt-1 text-[11px] text-muted">
                            {service.restore ? "Restores on a new connection" : "Starts manually"}
                        </div>
                        {error && (
                            <div role="alert" className="mt-2 text-[12px] leading-5 text-error">
                                {error}
                            </div>
                        )}
                        {note && <div className="mt-2 text-[11px] leading-5 text-warning">{note}</div>}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {!running && (
                                <button
                                    className={Button}
                                    disabled={!connected || busy}
                                    title={
                                        !connected
                                            ? "Connect to this host to start the saved service"
                                            : "Start saved tunnel"
                                    }
                                    onClick={() =>
                                        fireAndForget(() =>
                                            model.startForward(
                                                service.remoteport,
                                                service.localport,
                                                false,
                                                service.remotehost
                                            )
                                        )
                                    }
                                >
                                    {busy ? "Starting…" : failedRestore ? "Retry" : "Start"}
                                </button>
                            )}
                            {running && (
                                <>
                                    <button
                                        className={Button}
                                        onClick={() => fireAndForget(() => model.stopForward(forward))}
                                    >
                                        Stop
                                    </button>
                                    <button
                                        className={Button}
                                        onClick={() =>
                                            fireAndForget(() => navigator.clipboard.writeText(forwardUrl(forward)))
                                        }
                                    >
                                        Copy address
                                    </button>
                                    {connected && isLikelyHttp(service.remoteport, "") && (
                                        <button
                                            className={Button}
                                            onClick={() => model.openLocalPort(forward.localport)}
                                        >
                                            Open
                                        </button>
                                    )}
                                </>
                            )}
                            <button
                                className={Button}
                                disabled={action.busy}
                                onClick={() => {
                                    globalStore.set(model.serviceDraftAtom, service);
                                    globalStore.set(model.serviceActionAtom, { busy: false, error: "" });
                                }}
                            >
                                Edit
                            </button>
                            <button
                                className={cn(Button, "ml-auto border-transparent text-muted")}
                                disabled={action.busy}
                                title="Forget the saved definition; any running tunnel stays open"
                                onClick={() => fireAndForget(() => model.saveService(service, true))}
                            >
                                Forget
                            </button>
                        </div>
                    </article>
                );
            })}
        </section>
    );
}
