// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import type { HostViewModel } from "./host-model";
import { canForwardPorts } from "./hostutil";

const SessionLabels = {
    connected: "Connected",
    disconnected: "Disconnected",
    starting: "Starting",
    finished: "Finished",
};
const SessionTones = {
    connected: "text-success bg-success/10",
    disconnected: "text-warning bg-warning/10",
    starting: "text-accent bg-accent/10",
    finished: "text-muted bg-hover",
};
const ActionButton =
    "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50";

export function HostSessions({ model }: { model: HostViewModel }) {
    const sessions = useAtomValue(model.sessionsAtom);
    const state = useAtomValue(model.sessionsStateAtom);
    const connection = useAtomValue(model.connection);
    const connStatus = useAtomValue(model.connStatus);
    const connected = connStatus?.status === "connected";
    const live = sessions.filter((session) => session.status === "connected").length;
    const disconnected = sessions.filter((session) => session.status === "disconnected").length;
    if (!canForwardPorts(connection)) {
        return (
            <div className="px-6 py-12 text-center text-[13px] text-muted">
                Durable sessions are available on SSH hosts.
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold text-primary">Durable sessions</h3>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                        Sessions known to GenieTerm on this host. Reconnect attaches to the existing session.
                    </p>
                </div>
                <button
                    className={ActionButton}
                    disabled={state.loading}
                    onClick={() => fireAndForget(() => model.refreshSessions())}
                    aria-label="Refresh sessions"
                >
                    <i
                        className={cn("fa-solid fa-arrows-rotate text-[11px]", state.loading && "animate-spin")}
                        aria-hidden="true"
                    />
                    Refresh
                </button>
            </div>
            {sessions.length > 0 && (
                <div className="rounded-lg border border-border bg-panel px-3 py-2.5 text-[12px] leading-5 text-secondary">
                    {connected
                        ? `${live} connected · ${disconnected} disconnected · ${sessions.length - live - disconnected} starting or finished`
                        : "Host disconnected. Session states below are last known; remote processes may have changed."}
                    {state.updated > 0 && (
                        <span className="ml-2 text-muted">
                            Checked{" "}
                            {new Date(state.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                    )}
                </div>
            )}
            {state.error && (
                <div
                    role="alert"
                    className="rounded-lg border border-error/25 bg-error/5 px-3 py-2 text-[12px] text-error"
                >
                    {state.error}
                </div>
            )}
            {!state.loading && sessions.length === 0 && !state.error && (
                <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
                    <i className="fa-solid fa-terminal mb-3 text-xl text-muted" aria-hidden="true" />
                    <div className="text-[13px] font-medium text-primary">No durable sessions yet</div>
                    <p className="mx-auto mt-1 max-w-sm text-[12px] leading-5 text-muted">
                        Enable Keep running in a remote terminal to keep its session available across disconnections.
                    </p>
                </div>
            )}
            {sessions.map((session) => {
                const status = !connected && session.status === "connected" ? "disconnected" : session.status;
                return (
                    <article
                        key={session.id}
                        className="rounded-xl border border-border bg-panel px-3.5 py-3 transition-colors hover:border-foreground/20"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span
                                className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", SessionTones[status])}
                            >
                                {SessionLabels[status]}
                            </span>
                            {session.started > 0 && (
                                <time
                                    className="text-[11px] text-muted"
                                    dateTime={new Date(session.started).toISOString()}
                                >
                                    {new Date(session.started).toLocaleString()}
                                </time>
                            )}
                        </div>
                        <div className="mt-2 truncate font-mono text-[12px] text-primary" title={session.command}>
                            {session.command}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-muted">
                            {status === "disconnected"
                                ? "Last known session · remote state unverified"
                                : session.detail}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            {session.blockid && (
                                <button
                                    className={ActionButton}
                                    disabled={!!state.busy}
                                    onClick={() => fireAndForget(() => model.openSession(session))}
                                >
                                    <i
                                        className="fa-solid fa-arrow-up-right-from-square text-[10px]"
                                        aria-hidden="true"
                                    />
                                    Open terminal
                                </button>
                            )}
                            {status === "disconnected" && (
                                <button
                                    className={ActionButton}
                                    disabled={!!state.busy}
                                    onClick={() => fireAndForget(() => model.openSession(session, true))}
                                >
                                    {state.busy === session.id ? "Reconnecting…" : "Reconnect"}
                                </button>
                            )}
                            {!session.blockid && <span className="text-[11px] text-muted">No attached terminal</span>}
                        </div>
                    </article>
                );
            })}
        </div>
    );
}
