// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";
import type { HostViewModel } from "./host-model";
import { Sparkline } from "./host-sparkline";
import {
    clampPct,
    formatBytesAsGiB,
    formatGiB,
    formatGpuMemory,
    formatPct,
    formatRate,
    isValidNumber,
    summarizeGpus,
    temperatureTone,
    usageTone,
} from "./hostutil";

const ToneColor: Record<string, string> = {
    normal: "var(--accent-color)",
    warning: "var(--warning-color)",
    error: "var(--error-color)",
    none: "var(--grey-text-color)",
};

const MaxGpuProcesses = 4;
const MaxCoreCells = 256;

function toneColor(pct: number): string {
    return ToneColor[usageTone(pct)];
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <section className={cn("min-w-0 rounded-xl border border-border bg-panel px-4 py-3.5", className)}>
            {children}
        </section>
    );
}

function CardHeader({
    icon,
    title,
    detail,
    value,
    valueColor,
}: {
    icon: string;
    title: string;
    detail?: React.ReactNode;
    value?: string;
    valueColor?: string;
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                <i className={cn("fa-solid text-[12px]", icon)} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-5 text-primary">{title}</div>
                {detail && <div className="truncate text-[12px] leading-4 text-muted">{detail}</div>}
            </div>
            {value != null && (
                <div
                    className="shrink-0 text-[22px] font-semibold leading-7 tabular-nums"
                    style={{ color: valueColor ?? "var(--main-text-color)" }}
                >
                    {value}
                </div>
            )}
        </div>
    );
}

function Meter({ pct, color, className }: { pct: number; color?: string; className?: string }) {
    return (
        <div className={cn("h-1.5 overflow-hidden rounded-full bg-foreground/10", className)}>
            <div
                className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${clampPct(pct)}%`, backgroundColor: color ?? toneColor(pct) }}
            />
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[11px] leading-4 text-muted">{label}</div>
            <div
                className="truncate text-[13px] font-medium leading-5 tabular-nums"
                style={{ color: tone ? ToneColor[tone] : "var(--main-text-color)" }}
            >
                {value}
            </div>
        </div>
    );
}

function coreKeys(values: { [key: string]: number }): string[] {
    return Object.keys(values ?? {})
        .filter((k) => k.startsWith("cpu:"))
        .sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
}

function coreCellColor(pct: number): string {
    if (!isValidNumber(pct)) {
        return "var(--color-hover)";
    }
    const tone = usageTone(pct);
    if (tone !== "normal") {
        return ToneColor[tone];
    }
    const strength = Math.round(18 + clampPct(pct) * 0.82);
    return `color-mix(in srgb, var(--accent-color) ${strength}%, transparent)`;
}

const CpuCard = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const hostInfo = useAtomValue(model.hostInfoAtom);
    const values = latest?.values ?? {};
    const cpu = values["cpu"];
    const cores = coreKeys(values).slice(0, MaxCoreCells);
    const hasLoad = isValidNumber(values["load:1"]);
    const detail = [hostInfo?.cpumodel, cores.length > 0 ? `${cores.length} cores` : ""].filter(Boolean).join(" · ");
    return (
        <Card>
            <CardHeader
                icon="fa-microchip"
                title="CPU"
                detail={detail}
                value={formatPct(cpu)}
                valueColor={toneColor(cpu)}
            />
            <Sparkline
                className="mt-3 h-14"
                series={[{ values: samples.cpu, color: "var(--accent-color)" }]}
                label="CPU usage over the last minute"
            />
            {hasLoad && (
                <div className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
                    <span>Load average</span>
                    <span className="tabular-nums text-secondary">
                        {values["load:1"].toFixed(2)} · {values["load:5"].toFixed(2)} · {values["load:15"].toFixed(2)}
                    </span>
                </div>
            )}
            {cores.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-[3px]" aria-label="Per-core usage">
                    {cores.map((key) => (
                        <div
                            key={key}
                            title={`Core ${key.slice(4)} · ${formatPct(values[key])}`}
                            className="h-[11px] w-[11px] rounded-[3px] transition-colors duration-300 motion-reduce:transition-none"
                            style={{ backgroundColor: coreCellColor(values[key]) }}
                        />
                    ))}
                </div>
            )}
        </Card>
    );
});
CpuCard.displayName = "CpuCard";

const MemoryCard = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const values = latest?.values ?? {};
    const total = values["mem:total"];
    const used = values["mem:used"];
    const available = values["mem:available"];
    const pct = isValidNumber(used) && total > 0 ? (used / total) * 100 : NaN;
    const swapTotal = values["swap:total"];
    const swapUsed = values["swap:used"];
    const swapPct = isValidNumber(swapUsed) && swapTotal > 0 ? (swapUsed / swapTotal) * 100 : NaN;
    return (
        <Card>
            <CardHeader
                icon="fa-memory"
                title="Memory"
                detail={isValidNumber(total) ? `${formatGiB(used)} of ${formatGiB(total)}` : null}
                value={formatPct(pct)}
                valueColor={toneColor(pct)}
            />
            <Sparkline
                className="mt-3 h-14"
                series={[{ values: samples.mem, color: "var(--accent-color)" }]}
                label="Memory usage over the last minute"
            />
            <div className="mt-3 grid grid-cols-3 gap-3">
                <Stat label="Used" value={formatGiB(used)} />
                <Stat label="Available" value={formatGiB(available)} />
                <div className="min-w-0">
                    <Stat
                        label="Swap"
                        value={swapTotal > 0 ? `${formatGiB(swapUsed)} of ${formatGiB(swapTotal)}` : "None"}
                    />
                    {swapTotal > 0 && <Meter pct={swapPct} className="mt-1" color="var(--warning-color)" />}
                </div>
            </div>
        </Card>
    );
});
MemoryCard.displayName = "MemoryCard";

const GpuCard = memo(({ model, gpu, history }: { model: HostViewModel; gpu: GpuData; history: number[] }) => {
    const [showAll, setShowAll] = useState(false);
    const memPct = gpu.memtotal > 0 && isValidNumber(gpu.memused) ? (gpu.memused / gpu.memtotal) * 100 : NaN;
    const processes = gpu.processes ?? [];
    const shown = showAll ? processes : processes.slice(0, MaxGpuProcesses);
    const power =
        isValidNumber(gpu.power) && isValidNumber(gpu.powerlimit)
            ? `${Math.round(gpu.power)}/${Math.round(gpu.powerlimit)} W`
            : isValidNumber(gpu.power)
              ? `${Math.round(gpu.power)} W`
              : "—";
    return (
        <Card>
            <CardHeader
                icon="fa-display"
                title={`GPU ${gpu.index}`}
                detail={gpu.name}
                value={formatPct(gpu.util)}
                valueColor="var(--accent-color)"
            />
            <Sparkline
                className="mt-3 h-10"
                series={[{ values: history ?? [], color: "var(--accent-color)" }]}
                label={`GPU ${gpu.index} utilization over the last minute`}
            />
            <div className="mt-3 grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
                <div className="min-w-0">
                    <Stat label="Memory" value={formatGpuMemory(gpu.memused, gpu.memtotal)} />
                    <Meter pct={memPct} className="mt-1" color="var(--accent-color)" />
                </div>
                <Stat
                    label="Temperature"
                    value={isValidNumber(gpu.temp) ? `${Math.round(gpu.temp)} °C` : "—"}
                    tone={temperatureTone(gpu.temp) === "normal" ? undefined : temperatureTone(gpu.temp)}
                />
                <Stat label="Power" value={power} />
            </div>
            <div className="mt-3 border-t border-border pt-2">
                {processes.length === 0 ? (
                    <div className="py-1 text-[12px] text-muted">No processes</div>
                ) : (
                    <ul className="flex flex-col">
                        {shown.map((p) => (
                            <li key={p.pid}>
                                <button
                                    className="-mx-1.5 flex w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-hover"
                                    onClick={() => model.showProcess(p.pid)}
                                    title={`Show ${p.command || p.pid} in Processes`}
                                >
                                    <span className="min-w-0 flex-1 truncate text-secondary">
                                        {p.command || `pid ${p.pid}`}
                                    </span>
                                    {p.user && <span className="shrink-0 text-muted">{p.user}</span>}
                                    <span className="w-16 shrink-0 text-right tabular-nums text-secondary">
                                        {formatBytesAsGiB(p.memused)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {processes.length > MaxGpuProcesses && (
                    <button
                        className="mt-1 cursor-pointer text-[12px] text-muted transition-colors hover:text-primary"
                        onClick={() => setShowAll((v) => !v)}
                    >
                        {showAll ? "Show fewer" : `${processes.length - MaxGpuProcesses} more`}
                    </button>
                )}
            </div>
        </Card>
    );
});
GpuCard.displayName = "GpuCard";

const GpuSection = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const hostInfo = useAtomValue(model.hostInfoAtom);
    const gpus = latest?.gpus ?? [];
    if (gpus.length === 0) {
        return null;
    }
    const driver = [
        hostInfo?.gpudriver ? `Driver ${hostInfo.gpudriver}` : "",
        hostInfo?.cudaversion ? `CUDA ${hostInfo.cudaversion}` : "",
    ]
        .filter(Boolean)
        .join(" · ");
    return (
        <div className="col-span-full flex flex-col gap-3">
            <div className="flex items-baseline gap-2 px-0.5 pt-1">
                <h3 className="text-[13px] font-semibold text-primary">GPUs</h3>
                <span className="min-w-0 truncate text-[12px] text-muted">
                    {[summarizeGpus(gpus), driver].filter(Boolean).join(" · ")}
                </span>
            </div>
            <div className="grid grid-cols-1 gap-3 @[660px]:grid-cols-2 @[1100px]:grid-cols-3">
                {gpus.map((gpu) => (
                    <GpuCard key={gpu.index} model={model} gpu={gpu} history={samples.gpuUtil.get(gpu.index)} />
                ))}
            </div>
        </div>
    );
});
GpuSection.displayName = "GpuSection";

const NetworkCard = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const values = latest?.values ?? {};
    const peak = Math.max(1024, ...samples.netDown.filter(Number.isFinite), ...samples.netUp.filter(Number.isFinite));
    return (
        <Card>
            <CardHeader icon="fa-arrow-right-arrow-left" title="Network" />
            <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        Download
                    </div>
                    <div className="text-[15px] font-medium tabular-nums text-primary">
                        {formatRate(values["net:down"])}
                    </div>
                </div>
                <div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: "var(--warning-color)" }}
                        />
                        Upload
                    </div>
                    <div className="text-[15px] font-medium tabular-nums text-primary">
                        {formatRate(values["net:up"])}
                    </div>
                </div>
            </div>
            <Sparkline
                className="mt-3 h-10"
                max={peak}
                series={[
                    { values: samples.netDown, color: "var(--accent-color)" },
                    { values: samples.netUp, color: "var(--warning-color)", fill: false },
                ]}
                label="Network throughput over the last minute"
            />
        </Card>
    );
});
NetworkCard.displayName = "NetworkCard";

const DiskCard = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const disks = latest?.disks ?? [];
    return (
        <Card>
            <CardHeader
                icon="fa-hard-drive"
                title="Disks"
                detail={disks.length > 0 ? `${disks.length} ${disks.length === 1 ? "volume" : "volumes"}` : null}
            />
            <div className="mt-3 flex flex-col gap-3">
                {disks.length === 0 && <div className="text-[12px] text-muted">No volumes reported</div>}
                {disks.map((disk) => (
                    <div key={disk.mount} className="min-w-0">
                        <div className="flex items-baseline gap-2 text-[12px]">
                            <span className="min-w-0 flex-1 truncate font-mono text-secondary" title={disk.mount}>
                                {disk.mount}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted">
                                {formatGiB(disk.used)} of {formatGiB(disk.total)}
                            </span>
                            <span
                                className="w-9 shrink-0 text-right tabular-nums"
                                style={{ color: toneColor(disk.percent) }}
                            >
                                {formatPct(disk.percent)}
                            </span>
                        </div>
                        <Meter pct={disk.percent} className="mt-1.5" />
                    </div>
                ))}
            </div>
        </Card>
    );
});
DiskCard.displayName = "DiskCard";

export const HostOverview = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    if (latest == null) {
        return (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">
                <i className="fa-solid fa-circle-notch fa-spin mr-2 text-[12px]" aria-hidden="true" />
                Reading this host…
            </div>
        );
    }
    return (
        <div className="@container">
            <div className="grid grid-cols-1 gap-3 p-4 @[760px]:grid-cols-2">
                <CpuCard model={model} />
                <MemoryCard model={model} />
                <GpuSection model={model} />
                <NetworkCard model={model} />
                <DiskCard model={model} />
            </div>
        </div>
    );
});
HostOverview.displayName = "HostOverview";
