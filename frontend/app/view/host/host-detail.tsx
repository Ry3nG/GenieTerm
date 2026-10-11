// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { memo, useEffect, useRef } from "react";
import type { HostResource, HostViewModel } from "./host-model";
import { HostSummary } from "./host-overview";
import { Sparkline } from "./host-sparkline";
import { CardHeader, coreCellColor, coreKeys, DetailChart, formatGpuPower, Meter, Stat, toneColor } from "./host-ui";
import {
    formatBytesAsGiB,
    formatGiB,
    formatGpuMemory,
    formatPct,
    formatRate,
    isValidNumber,
    temperatureTone,
} from "./hostutil";

type ResourceItem = {
    id: HostResource;
    icon: string;
    title: string;
    detail: string;
    value: string;
    valueColor: string;
    history?: number[];
    historyMax?: number;
};

function maxFinite(values: number[], floor: number): number {
    let max = floor;
    for (const v of values) {
        if (Number.isFinite(v) && v > max) {
            max = v;
        }
    }
    return max;
}

function useResourceItems(model: HostViewModel): ResourceItem[] {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const values = latest?.values ?? {};
    const memPct = values["mem:total"] > 0 ? (values["mem:used"] / values["mem:total"]) * 100 : NaN;
    const gpus = latest?.gpus ?? [];
    const disks = latest?.disks ?? [];
    const fullest = disks.reduce((a, d) => (a == null || d.percent > a.percent ? d : a), null as DiskUsageData);
    const items: ResourceItem[] = [
        {
            id: "summary",
            icon: "fa-grid-2",
            title: "Summary",
            detail: "Everything at a glance",
            value: "",
            valueColor: "",
        },
    ];
    for (const gpu of gpus) {
        items.push({
            id: `gpu:${gpu.index}`,
            icon: "fa-display",
            title: `GPU ${gpu.index}`,
            detail: [
                formatGpuMemory(gpu.memused, gpu.memtotal),
                isValidNumber(gpu.temp) ? `${Math.round(gpu.temp)} °C` : "",
            ]
                .filter(Boolean)
                .join(" · "),
            value: formatPct(gpu.util),
            valueColor: "var(--accent-color)",
            history: samples.gpuUtil.get(gpu.index),
        });
    }
    items.push(
        {
            id: "cpu",
            icon: "fa-microchip",
            title: "CPU",
            detail: isValidNumber(values["load:1"])
                ? `Load ${values["load:1"].toFixed(2)}`
                : `${coreKeys(values).length} cores`,
            value: formatPct(values["cpu"]),
            valueColor: toneColor(values["cpu"]),
            history: samples.cpu,
        },
        {
            id: "memory",
            icon: "fa-memory",
            title: "Memory",
            detail: `${formatGiB(values["mem:used"])} of ${formatGiB(values["mem:total"])}`,
            value: formatPct(memPct),
            valueColor: toneColor(memPct),
            history: samples.mem,
        },
        {
            id: "network",
            icon: "fa-arrow-right-arrow-left",
            title: "Network",
            detail: `↓ ${formatRate(values["net:down"])}  ↑ ${formatRate(values["net:up"])}`,
            value: "",
            valueColor: "",
            history: samples.netDown,
            historyMax: maxFinite(samples.netDown, 1024),
        },
        {
            id: "disks",
            icon: "fa-hard-drive",
            title: "Disks",
            detail: fullest ? `${fullest.mount} ${formatPct(fullest.percent)} full` : "",
            value: "",
            valueColor: "",
        }
    );
    return items;
}

const ResourceList = memo(({ model, items }: { model: HostViewModel; items: ResourceItem[] }) => {
    const selected = useAtomValue(model.resourceAtom);
    return (
        <nav aria-label="Host resources" className="flex flex-col gap-0.5 p-2">
            {items.map((item) => (
                <button
                    key={item.id}
                    type="button"
                    aria-current={selected === item.id ? "true" : undefined}
                    onClick={() => model.selectResource(item.id)}
                    className={cn(
                        "flex w-full cursor-pointer flex-col gap-1 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent",
                        selected === item.id ? "bg-hoverbg" : "hover:bg-hover"
                    )}
                >
                    <div className="flex items-center gap-2">
                        <i
                            className={cn("fa-solid w-3.5 text-center text-[11px] text-muted", item.icon)}
                            aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-primary">
                            {item.title}
                        </span>
                        {item.value && (
                            <span
                                className="shrink-0 text-[12px] font-medium tabular-nums"
                                style={{ color: item.valueColor }}
                            >
                                {item.value}
                            </span>
                        )}
                    </div>
                    {item.detail && <div className="truncate pl-[22px] text-[11px] text-muted">{item.detail}</div>}
                    {item.history && (
                        <Sparkline
                            className="ml-[22px] h-5 w-[calc(100%-22px)]"
                            series={[{ values: item.history, color: "var(--accent-color)" }]}
                            max={item.historyMax ?? 100}
                        />
                    )}
                </button>
            ))}
        </nav>
    );
});
ResourceList.displayName = "ResourceList";

// Compact strip for narrow blocks, where a sidebar would crowd the detail.
const ResourceStrip = memo(({ model, items }: { model: HostViewModel; items: ResourceItem[] }) => {
    const selected = useAtomValue(model.resourceAtom);
    const navRef = useRef<HTMLElement>(null);
    // keep the selection visible when it changes from elsewhere (a summary card, the palette)
    useEffect(() => {
        const el = navRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
        el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [selected]);
    return (
        <nav
            ref={navRef}
            aria-label="Host resources"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-24px),transparent)] [scrollbar-width:none]"
        >
            {items.map((item) => (
                <button
                    key={item.id}
                    type="button"
                    aria-current={selected === item.id ? "true" : undefined}
                    onClick={() => model.selectResource(item.id)}
                    className={cn(
                        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent",
                        selected === item.id ? "bg-hoverbg text-primary" : "text-secondary hover:bg-hover"
                    )}
                >
                    {item.title}
                    {item.value && (
                        <span className="tabular-nums" style={{ color: item.valueColor }}>
                            {item.value}
                        </span>
                    )}
                </button>
            ))}
        </nav>
    );
});
ResourceStrip.displayName = "ResourceStrip";

function DetailFrame({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-col gap-5 p-4 @[560px]:p-5">{children}</div>;
}

// process tables drop the pid, then the owner, as they narrow; the name and the number stay
const PidCell = "hidden w-16 shrink-0 tabular-nums text-muted @[400px]/table:inline";
const UserCell = "hidden w-24 shrink-0 truncate text-muted @[480px]/table:inline";

function StatGrid({ children }: { children: React.ReactNode }) {
    return <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-4 gap-y-3">{children}</div>;
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="flex items-baseline gap-2">
            <h3 className="text-[13px] font-semibold text-primary">{title}</h3>
            {detail && <span className="truncate text-[12px] text-muted">{detail}</span>}
        </div>
    );
}

const TopProcesses = memo(({ model, sortBy }: { model: HostViewModel; sortBy: "cpu" | "mem" }) => {
    const top = useAtomValue(model.topProcessesAtom);
    const rows = top?.sortBy === sortBy ? (top.data?.processes ?? []) : [];
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
                <SectionTitle title={sortBy === "cpu" ? "Busiest processes" : "Largest processes"} />
                <button
                    className="cursor-pointer text-[12px] text-muted transition-colors hover:text-primary"
                    onClick={() => model.setTab("processes")}
                >
                    All processes →
                </button>
            </div>
            <div className="@container/table overflow-hidden rounded-lg border border-border">
                {top?.error && <div className="px-3 py-2 text-[12px] text-error">{top.error}</div>}
                {!top?.error && rows.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">Loading…</div>}
                {rows.map((p) => (
                    <button
                        key={p.pid}
                        className="flex w-full cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-1.5 text-left text-[12px] transition-colors last:border-b-0 hover:bg-hover"
                        onClick={() => model.showProcess(p.pid)}
                    >
                        <span className={PidCell}>{p.pid}</span>
                        <span className="min-w-0 flex-1 truncate text-primary">{p.command}</span>
                        <span className={UserCell}>{p.user}</span>
                        <span
                            className={cn(
                                "w-16 shrink-0 text-right tabular-nums",
                                sortBy === "cpu" ? "text-primary" : "text-secondary"
                            )}
                        >
                            {p.cpu >= 0 ? `${p.cpu.toFixed(1)}%` : "—"}
                        </span>
                        <span
                            className={cn(
                                "w-20 shrink-0 text-right tabular-nums",
                                sortBy === "mem" ? "text-primary" : "text-secondary"
                            )}
                        >
                            {p.mem >= 0 ? formatBytesAsGiB(p.mem) : "—"}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
});
TopProcesses.displayName = "TopProcesses";

const CpuDetail = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const hostInfo = useAtomValue(model.hostInfoAtom);
    const values = latest?.values ?? {};
    const cores = coreKeys(values);
    const busiest = cores.reduce((a, k) => (a == null || values[k] > values[a] ? k : a), null as string);
    return (
        <DetailFrame>
            <CardHeader
                large
                icon="fa-microchip"
                title="CPU"
                detail={[hostInfo?.cpumodel, `${cores.length} cores`].filter(Boolean).join(" · ")}
                value={formatPct(values["cpu"])}
                valueColor={toneColor(values["cpu"])}
            />
            <DetailChart title="Utilization" series={[{ values: samples.cpu, color: "var(--accent-color)" }]} />
            <StatGrid>
                <Stat label="Utilization" value={formatPct(values["cpu"])} />
                <Stat
                    label="Load average"
                    value={isValidNumber(values["load:1"]) ? values["load:1"].toFixed(2) : "—"}
                    sub={
                        isValidNumber(values["load:5"])
                            ? `5 min ${values["load:5"].toFixed(2)} · 15 min ${values["load:15"].toFixed(2)}`
                            : ""
                    }
                />
                <Stat label="Cores" value={String(cores.length || hostInfo?.numcpu || "—")} />
                <Stat
                    label="Busiest core"
                    value={busiest ? `${busiest.slice(4)} · ${formatPct(values[busiest])}` : "—"}
                />
            </StatGrid>
            {cores.length > 0 && (
                <div className="flex flex-col gap-2">
                    <SectionTitle title="Per core" />
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(46px,1fr))] gap-1">
                        {cores.map((key) => (
                            <div
                                key={key}
                                title={`Core ${key.slice(4)}`}
                                className="flex h-9 flex-col items-center justify-center rounded-md transition-colors duration-300 motion-reduce:transition-none"
                                style={{ backgroundColor: coreCellColor(values[key]) }}
                            >
                                <span className="text-[9.5px] leading-3 text-primary/70">{key.slice(4)}</span>
                                <span className="text-[11px] font-medium leading-4 tabular-nums text-primary">
                                    {formatPct(values[key])}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <TopProcesses model={model} sortBy="cpu" />
        </DetailFrame>
    );
});
CpuDetail.displayName = "CpuDetail";

const MemoryDetail = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const values = latest?.values ?? {};
    const total = values["mem:total"];
    const used = values["mem:used"];
    const pct = total > 0 ? (used / total) * 100 : NaN;
    const swapTotal = values["swap:total"];
    const swapUsed = values["swap:used"];
    return (
        <DetailFrame>
            <CardHeader
                large
                icon="fa-memory"
                title="Memory"
                detail={`${formatGiB(used)} of ${formatGiB(total)}`}
                value={formatPct(pct)}
                valueColor={toneColor(pct)}
            />
            <DetailChart title="In use" series={[{ values: samples.mem, color: "var(--accent-color)" }]} />
            <StatGrid>
                <Stat label="Used" value={formatGiB(used)} />
                <Stat label="Available" value={formatGiB(values["mem:available"])} />
                <Stat label="Free" value={formatGiB(values["mem:free"])} sub="Not used by apps or caches" />
                <Stat label="Total" value={formatGiB(total)} />
                <Stat
                    label="Swap"
                    value={swapTotal > 0 ? `${formatGiB(swapUsed)} of ${formatGiB(swapTotal)}` : "None"}
                    tone={swapTotal > 0 && swapUsed / swapTotal > 0.5 ? "warning" : undefined}
                />
            </StatGrid>
            <TopProcesses model={model} sortBy="mem" />
        </DetailFrame>
    );
});
MemoryDetail.displayName = "MemoryDetail";

const GpuDetail = memo(({ model, index }: { model: HostViewModel; index: number }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const hostInfo = useAtomValue(model.hostInfoAtom);
    const gpu = (latest?.gpus ?? []).find((g) => g.index === index);
    if (gpu == null) {
        return <div className="p-5 text-[13px] text-muted">GPU {index} is not reporting right now.</div>;
    }
    const memPct = gpu.memtotal > 0 ? (gpu.memused / gpu.memtotal) * 100 : NaN;
    const powerPct = gpu.powerlimit > 0 && gpu.power >= 0 ? (gpu.power / gpu.powerlimit) * 100 : NaN;
    const processes = gpu.processes ?? [];
    const clock = isValidNumber(gpu.clocksm)
        ? isValidNumber(gpu.clocksmmax)
            ? `${Math.round(gpu.clocksm)} / ${Math.round(gpu.clocksmmax)} MHz`
            : `${Math.round(gpu.clocksm)} MHz`
        : "—";
    return (
        <DetailFrame>
            <CardHeader
                large
                icon="fa-display"
                title={`GPU ${gpu.index}`}
                detail={[
                    gpu.name,
                    hostInfo?.gpudriver ? `Driver ${hostInfo.gpudriver}` : "",
                    hostInfo?.cudaversion ? `CUDA ${hostInfo.cudaversion}` : "",
                ]
                    .filter(Boolean)
                    .join(" · ")}
                value={formatPct(gpu.util)}
                valueColor="var(--accent-color)"
            />
            <div className="grid grid-cols-1 gap-4 @[640px]:grid-cols-2">
                <DetailChart
                    title="Utilization"
                    series={[{ values: samples.gpuUtil.get(gpu.index) ?? [], color: "var(--accent-color)" }]}
                />
                <DetailChart
                    title="Memory in use"
                    series={[{ values: samples.gpuMem.get(gpu.index) ?? [], color: "var(--accent-color)" }]}
                />
            </div>
            <StatGrid>
                <div className="min-w-0">
                    <Stat label="Memory" value={formatGpuMemory(gpu.memused, gpu.memtotal)} sub={formatPct(memPct)} />
                    <Meter pct={memPct} className="mt-1" color="var(--accent-color)" />
                </div>
                <div className="min-w-0">
                    <Stat
                        label="Power"
                        value={formatGpuPower(gpu)}
                        sub={isValidNumber(powerPct) ? `${formatPct(powerPct)} of limit` : ""}
                    />
                    {isValidNumber(powerPct) && <Meter pct={powerPct} className="mt-1" color="var(--accent-color)" />}
                </div>
                <Stat
                    label="Temperature"
                    value={isValidNumber(gpu.temp) ? `${Math.round(gpu.temp)} °C` : "—"}
                    tone={temperatureTone(gpu.temp) === "normal" ? undefined : temperatureTone(gpu.temp)}
                />
                <Stat label="Fan" value={isValidNumber(gpu.fan) ? formatPct(gpu.fan) : "Passive"} />
                <Stat label="SM clock" value={clock} />
                <Stat
                    label="Memory clock"
                    value={isValidNumber(gpu.clockmem) ? `${Math.round(gpu.clockmem)} MHz` : "—"}
                />
                <Stat label="Memory bandwidth" value={formatPct(gpu.memutil)} sub="Memory controller busy" />
                <Stat label="Performance state" value={gpu.pstate || "—"} sub={gpu.pstate === "P0" ? "Maximum" : ""} />
            </StatGrid>
            <div className="flex flex-col gap-2">
                <SectionTitle
                    title="Processes"
                    detail={processes.length > 0 ? `${processes.length} using this GPU` : ""}
                />
                <div className="@container/table overflow-hidden rounded-lg border border-border">
                    {processes.length === 0 && (
                        <div className="px-3 py-2 text-[12px] text-muted">Nothing is running on this GPU.</div>
                    )}
                    {processes.map((p) => {
                        const share = gpu.memtotal > 0 && p.memused >= 0 ? (p.memused / gpu.memtotal) * 100 : NaN;
                        const cells = (
                            <>
                                <span className={PidCell}>{p.pid}</span>
                                <span className="min-w-0 flex-1 truncate text-primary">
                                    {p.command || <span className="text-muted">Not visible from here</span>}
                                </span>
                                <span className={UserCell}>{p.user}</span>
                                <span className="hidden w-28 shrink-0 @[560px]/table:inline-block">
                                    <Meter pct={share} color="var(--accent-color)" />
                                </span>
                                <span className="w-20 shrink-0 text-right tabular-nums text-secondary">
                                    {formatBytesAsGiB(p.memused)}
                                </span>
                            </>
                        );
                        const rowClass =
                            "flex w-full items-center gap-3 border-b border-border/60 px-3 py-1.5 text-left text-[12px] last:border-b-0";
                        if (!p.command) {
                            return (
                                <div key={p.pid} className={rowClass} title="Owned by another container or user">
                                    {cells}
                                </div>
                            );
                        }
                        return (
                            <button
                                key={p.pid}
                                className={cn(rowClass, "cursor-pointer transition-colors hover:bg-hover")}
                                onClick={() => model.showProcess(p.pid)}
                                title={`Show ${p.command} in Processes`}
                            >
                                {cells}
                            </button>
                        );
                    })}
                </div>
            </div>
        </DetailFrame>
    );
});
GpuDetail.displayName = "GpuDetail";

const NetworkDetail = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const values = latest?.values ?? {};
    const peakDown = maxFinite(samples.netDown, 0);
    const peakUp = maxFinite(samples.netUp, 0);
    const max = Math.max(1024, peakDown, peakUp);
    return (
        <DetailFrame>
            <CardHeader large icon="fa-arrow-right-arrow-left" title="Network" detail="All interfaces" />
            <DetailChart
                title="Throughput"
                topLabel={formatRate(max)}
                max={max}
                series={[
                    { values: samples.netDown, color: "var(--accent-color)", label: "Download" },
                    { values: samples.netUp, color: "var(--warning-color)", fill: false, label: "Upload" },
                ]}
            />
            <StatGrid>
                <Stat label="Download" value={formatRate(values["net:down"])} />
                <Stat label="Upload" value={formatRate(values["net:up"])} />
                <Stat label="Peak download" value={formatRate(peakDown)} sub="Last minute" />
                <Stat label="Peak upload" value={formatRate(peakUp)} sub="Last minute" />
            </StatGrid>
        </DetailFrame>
    );
});
NetworkDetail.displayName = "NetworkDetail";

const DisksDetail = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const disks = latest?.disks ?? [];
    return (
        <DetailFrame>
            <CardHeader
                large
                icon="fa-hard-drive"
                title="Disks"
                detail={`${disks.length} ${disks.length === 1 ? "volume" : "volumes"}`}
            />
            <div className="flex flex-col gap-4">
                {disks.map((disk) => (
                    <div key={disk.mount} className="min-w-0 rounded-lg border border-border px-4 py-3">
                        <div className="flex items-baseline gap-3">
                            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-primary">
                                {disk.mount}
                            </span>
                            <span
                                className="text-[15px] font-semibold tabular-nums"
                                style={{ color: toneColor(disk.percent) }}
                            >
                                {formatPct(disk.percent)}
                            </span>
                        </div>
                        <Meter pct={disk.percent} className="mt-2 h-2" />
                        <div className="mt-2 grid grid-cols-3 gap-3">
                            <Stat label="Used" value={formatGiB(disk.used)} />
                            <Stat
                                label="Free"
                                value={formatGiB(disk.free)}
                                tone={disk.percent >= 90 ? "error" : undefined}
                            />
                            <Stat label="Size" value={formatGiB(disk.total)} />
                        </div>
                    </div>
                ))}
            </div>
        </DetailFrame>
    );
});
DisksDetail.displayName = "DisksDetail";

function ResourceDetail({ model, resource }: { model: HostViewModel; resource: HostResource }) {
    if (resource.startsWith("gpu:")) {
        return <GpuDetail model={model} index={Number(resource.slice(4))} />;
    }
    switch (resource) {
        case "cpu":
            return <CpuDetail model={model} />;
        case "memory":
            return <MemoryDetail model={model} />;
        case "network":
            return <NetworkDetail model={model} />;
        case "disks":
            return <DisksDetail model={model} />;
    }
    return <HostSummary model={model} />;
}

export const HostOverviewPane = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const resource = useAtomValue(model.resourceAtom);
    const items = useResourceItems(model);
    if (latest == null) {
        return (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">
                <i className="fa-solid fa-circle-notch fa-spin mr-2 text-[12px]" aria-hidden="true" />
                Reading this host…
            </div>
        );
    }
    return (
        <div className="@container flex h-full flex-col">
            <div className="@[760px]:hidden">
                <ResourceStrip model={model} items={items} />
            </div>
            <div className="flex min-h-0 flex-1">
                {/* OverlayScrollbars sets display on its own element, so the wrapper does the hiding */}
                <div className="hidden w-[232px] shrink-0 border-r border-border @[760px]:flex @[1280px]:w-[264px]">
                    <OverlayScrollbarsComponent
                        className="min-w-0 flex-1"
                        options={{ scrollbars: { autoHide: "leave" } }}
                    >
                        <ResourceList model={model} items={items} />
                    </OverlayScrollbarsComponent>
                </div>
                <OverlayScrollbarsComponent className="min-w-0 flex-1" options={{ scrollbars: { autoHide: "leave" } }}>
                    <div className="@container">
                        <ResourceDetail model={model} resource={resource} />
                    </div>
                </OverlayScrollbarsComponent>
            </div>
        </div>
    );
});
HostOverviewPane.displayName = "HostOverviewPane";
