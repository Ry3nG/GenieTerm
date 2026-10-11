// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";
import type { HostViewModel } from "./host-model";
import { Sparkline } from "./host-sparkline";
import {
    Card,
    CardHeader,
    coreCellColor,
    coreKeys,
    formatGpuPower,
    Meter,
    Stat,
    ToneColor,
    toneColor,
} from "./host-ui";
import {
    formatBytesAsGiB,
    formatGiB,
    formatGpuMemory,
    formatPct,
    formatRate,
    isValidNumber,
    summarizeGpus,
    temperatureTone,
} from "./hostutil";

const MaxGpuProcesses = 4;
const MaxCoreCells = 256;
const CompactGpuCount = 3;

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
        <Card onClick={() => model.selectResource("cpu")} label="Show CPU details">
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
        <Card onClick={() => model.selectResource("memory")} label="Show memory details">
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
            <div className="mt-3 grid grid-cols-2 gap-3 @[300px]/card:grid-cols-3">
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
    const power = formatGpuPower(gpu);
    return (
        <Card onClick={() => model.selectResource(`gpu:${gpu.index}`)} label={`Show GPU ${gpu.index} details`}>
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
            <div className="mt-3 grid grid-cols-2 gap-3 @[300px]/card:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
                        {shown.map((p) =>
                            !p.command ? (
                                <li
                                    key={p.pid}
                                    className="flex items-center gap-2 py-1 text-[12px]"
                                    title="Owned by another container or user"
                                >
                                    <span className="min-w-0 flex-1 truncate text-muted">
                                        Not visible from here · pid {p.pid}
                                    </span>
                                    <span className="w-16 shrink-0 text-right tabular-nums text-secondary">
                                        {formatBytesAsGiB(p.memused)}
                                    </span>
                                </li>
                            ) : (
                                <li key={p.pid}>
                                    <span
                                        role="link"
                                        tabIndex={-1}
                                        className="-mx-1.5 flex w-[calc(100%+12px)] cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-hoverbg"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            model.showProcess(p.pid);
                                        }}
                                        title={`Show ${p.command} in Processes`}
                                    >
                                        <span className="min-w-0 flex-1 truncate text-secondary">{p.command}</span>
                                        {p.user && <span className="shrink-0 text-muted">{p.user}</span>}
                                        <span className="w-16 shrink-0 text-right tabular-nums text-secondary">
                                            {formatBytesAsGiB(p.memused)}
                                        </span>
                                    </span>
                                </li>
                            )
                        )}
                    </ul>
                )}
                {processes.length > MaxGpuProcesses && (
                    <span
                        role="button"
                        tabIndex={-1}
                        className="mt-1 inline-block cursor-pointer text-[12px] text-muted transition-colors hover:text-primary"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowAll((v) => !v);
                        }}
                    >
                        {showAll ? "Show fewer" : `${processes.length - MaxGpuProcesses} more`}
                    </span>
                )}
            </div>
        </Card>
    );
});
GpuCard.displayName = "GpuCard";

// One line per GPU for narrow blocks on multi-GPU hosts, where full cards would bury CPU and memory.
const GpuRows = memo(({ model, gpus }: { model: HostViewModel; gpus: GpuData[] }) => {
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-panel">
            {gpus.map((gpu) => {
                const tempTone = temperatureTone(gpu.temp);
                return (
                    <button
                        key={gpu.index}
                        type="button"
                        aria-label={`Show GPU ${gpu.index} details`}
                        onClick={() => model.selectResource(`gpu:${gpu.index}`)}
                        className="flex w-full cursor-pointer items-center gap-3 border-b border-border/60 px-3.5 py-2.5 text-left outline-none transition-colors last:border-b-0 hover:bg-hover focus-visible:bg-hover"
                    >
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-baseline gap-2 text-[11px] text-muted">
                                <span className="shrink-0 text-[13px] font-medium text-primary">GPU {gpu.index}</span>
                                <span className="min-w-0 truncate tabular-nums">
                                    {formatGpuMemory(gpu.memused, gpu.memtotal)}
                                    {isValidNumber(gpu.temp) && (
                                        <>
                                            {" · "}
                                            <span
                                                style={
                                                    tempTone === "normal" ? undefined : { color: ToneColor[tempTone] }
                                                }
                                            >
                                                {Math.round(gpu.temp)} °C
                                            </span>
                                        </>
                                    )}
                                    {isValidNumber(gpu.power) && ` · ${Math.round(gpu.power)} W`}
                                </span>
                            </div>
                            <Meter pct={gpu.util} className="mt-1.5" color="var(--accent-color)" />
                        </div>
                        <span className="w-11 shrink-0 text-right text-[15px] font-semibold tabular-nums text-accent">
                            {formatPct(gpu.util)}
                        </span>
                    </button>
                );
            })}
        </div>
    );
});
GpuRows.displayName = "GpuRows";

const GpuSection = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const samples = useAtomValue(model.samplesAtom);
    const hostInfo = useAtomValue(model.hostInfoAtom);
    const gpus = latest?.gpus ?? [];
    if (gpus.length === 0) {
        return null;
    }
    const compact = gpus.length >= CompactGpuCount;
    const driver = [
        hostInfo?.gpudriver ? `Driver ${hostInfo.gpudriver}` : "",
        hostInfo?.cudaversion ? `CUDA ${hostInfo.cudaversion}` : "",
    ]
        .filter(Boolean)
        .join(" · ");
    return (
        <div className="col-span-full flex flex-col gap-3">
            <div className="flex items-baseline gap-2 px-0.5">
                <h3 className="text-[13px] font-semibold text-primary">GPUs</h3>
                <span className="min-w-0 truncate text-[12px] text-muted">
                    {[summarizeGpus(gpus), driver].filter(Boolean).join(" · ")}
                </span>
            </div>
            {compact && (
                <div className="@[680px]:hidden">
                    <GpuRows model={model} gpus={gpus} />
                </div>
            )}
            <div
                className={cn(
                    "grid grid-cols-1 gap-3 @[680px]:grid-cols-2 @[1040px]:grid-cols-3 @[1480px]:grid-cols-4",
                    compact && "hidden @[680px]:grid"
                )}
            >
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
        <Card onClick={() => model.selectResource("network")} label="Show network details">
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
        <Card onClick={() => model.selectResource("disks")} label="Show disk details">
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

// GPU hosts lead with their GPUs: on a workstation or training server they matter most.
export const HostSummary = memo(({ model }: { model: HostViewModel }) => {
    const latest = useAtomValue(model.latestAtom);
    const hasGpus = (latest?.gpus?.length ?? 0) > 0;
    return (
        <div className="@container">
            <div className="grid grid-cols-1 gap-3 p-3 @[420px]:p-4 @[680px]:grid-cols-2">
                {hasGpus && <GpuSection model={model} />}
                <CpuCard model={model} />
                <MemoryCard model={model} />
                <NetworkCard model={model} />
                <DiskCard model={model} />
            </div>
        </div>
    );
});
HostSummary.displayName = "HostSummary";
