// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { memo, useEffect, useState } from "react";
import { HostOverviewPane } from "./host-detail";
import type { HostViewModel } from "./host-model";
import { HostPorts } from "./host-ports";
import { formatHostSubtitle, HostTab, isLocalConnName, isWslConnName } from "./hostutil";

const TabLabels: Record<HostTab, string> = {
    overview: "Overview",
    processes: "Processes",
    ports: "Ports",
};

function connKindLabel(conn: string): string {
    if (isLocalConnName(conn)) {
        return "This computer";
    }
    if (isWslConnName(conn)) {
        return "WSL";
    }
    return "SSH";
}

function useNow(intervalMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);
    return now;
}

const HostHeader = memo(({ model }: { model: HostViewModel }) => {
    const conn = useAtomValue(model.connection);
    const hostInfo = useAtomValue(model.hostInfoAtom);
    const tab = useAtomValue(model.tabAtom);
    const forwards = useAtomValue(model.forwardsAtom);
    const now = useNow(60_000);
    const activeForwards = forwards.filter((f) => f.status === "active").length;
    const title = hostInfo?.hostname || (isLocalConnName(conn) ? "This computer" : conn);
    const subtitle = formatHostSubtitle(hostInfo, now);
    return (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-[15px] font-semibold leading-5 text-primary">{title}</h2>
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-muted">
                        {connKindLabel(conn)}
                    </span>
                </div>
                <div className="truncate text-[12px] leading-4 text-muted">{subtitle || " "}</div>
            </div>
            <div
                role="tablist"
                aria-label="Host sections"
                className="flex shrink-0 gap-0.5 rounded-lg border border-border bg-background p-0.5"
            >
                {(Object.keys(TabLabels) as HostTab[]).map((key) => (
                    <button
                        key={key}
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => fireAndForget(() => model.setTab(key))}
                        className={cn(
                            "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent",
                            tab === key ? "bg-hoverbg text-primary" : "text-secondary hover:bg-hover hover:text-primary"
                        )}
                    >
                        {TabLabels[key]}
                        {key === "ports" && activeForwards > 0 && (
                            <span className="rounded-full bg-accent/20 px-1.5 text-[10px] leading-4 tabular-nums text-accent">
                                {activeForwards}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
});
HostHeader.displayName = "HostHeader";

const HelperUpdateBanner = memo(({ model }: { model: HostViewModel }) => {
    const outdated = useAtomValue(model.helperOutdatedAtom);
    const update = useAtomValue(model.helperUpdateAtom);
    const conn = useAtomValue(model.connection);
    if (!outdated || isLocalConnName(conn)) {
        return null;
    }
    return (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-accent/8 px-4 py-2.5">
            <i className="fa-solid fa-circle-arrow-up text-[14px] text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-[12px] leading-5">
                <span className="font-medium text-primary">This host's genie helper is out of date.</span>{" "}
                <span className="text-secondary">
                    Update it to see GPUs, host details and listening ports. Your terminals stay connected.
                </span>
                {update.error && <div className="text-error">{update.error}</div>}
            </div>
            <button
                className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-accent/80 px-3 text-[12px] font-medium text-primary transition-colors hover:bg-accent disabled:opacity-60"
                disabled={update.busy}
                onClick={() => fireAndForget(() => model.updateHelper())}
            >
                {update.busy && <i className="fa-solid fa-circle-notch fa-spin text-[11px]" aria-hidden="true" />}
                {update.busy ? "Updating…" : "Update helper"}
            </button>
        </div>
    );
});
HelperUpdateBanner.displayName = "HelperUpdateBanner";

function NotConnected({ model }: { model: HostViewModel }) {
    const conn = useAtomValue(model.connection);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
            <i className="fa-solid fa-plug-circle-xmark mb-1 text-[18px] text-muted" aria-hidden="true" />
            <div className="text-[13px] font-medium text-primary">Not connected to {conn}</div>
            <div className="text-[12px] text-muted">Reconnect from the block header to see this host.</div>
        </div>
    );
}

const ProcessesTab = memo(({ model, props }: { model: HostViewModel; props: ViewComponentProps<HostViewModel> }) => {
    const processModel = useAtomValue(model.processModelAtom);
    if (processModel == null) {
        return null;
    }
    const ProcessView = processModel.viewComponent;
    return (
        <ProcessView
            blockId={props.blockId}
            blockRef={props.blockRef}
            contentRef={props.contentRef}
            model={processModel}
        />
    );
});
ProcessesTab.displayName = "ProcessesTab";

export function HostView(props: ViewComponentProps<HostViewModel>) {
    const { model } = props;
    const tab = useAtomValue(model.tabAtom);
    const connStatus = useAtomValue(model.connStatus);
    const connected = connStatus?.status === "connected" || model.env.isMock;
    let content: React.ReactNode;
    if (!connected) {
        content = <NotConnected model={model} />;
    } else if (tab === "processes") {
        content = <ProcessesTab model={model} props={props} />;
    } else if (tab === "ports") {
        content = (
            <OverlayScrollbarsComponent className="h-full" options={{ scrollbars: { autoHide: "leave" } }}>
                <HostPorts model={model} />
            </OverlayScrollbarsComponent>
        );
    } else {
        content = <HostOverviewPane model={model} />;
    }
    return (
        <div className="flex h-full w-full min-w-0 flex-col">
            <HostHeader model={model} />
            {connected && <HelperUpdateBanner model={model} />}
            <div className="min-h-0 flex-1">{content}</div>
        </div>
    );
}
