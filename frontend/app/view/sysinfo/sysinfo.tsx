// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { makeORef } from "@/app/store/wos";
import * as util from "@/util/util";
import * as Plot from "@observablehq/plot";
import clsx from "clsx";
import dayjs from "dayjs";
import * as htl from "htl";
import * as jotai from "jotai";
import * as React from "react";

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";

export type SysinfoEnv = WaveEnvSubset<{
    rpc: {
        EventReadHistoryCommand: WaveEnv["rpc"]["EventReadHistoryCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"graph:numpoints" | "sysinfo:type" | "connection" | "count">;
}>;

const DefaultNumPoints = 120;

type DataItem = {
    ts: number;
    [k: string]: number;
};

function defaultCpuMeta(name: string): TimeSeriesMeta {
    return {
        name: name,
        label: "%",
        miny: 0,
        maxy: 100,
        color: "var(--sysinfo-cpu-color)",
        decimalPlaces: 0,
    };
}

function defaultMemMeta(name: string, maxY: string): TimeSeriesMeta {
    return {
        name: name,
        label: "GB",
        miny: 0,
        maxy: maxY,
        color: "var(--sysinfo-mem-color)",
        decimalPlaces: 1,
    };
}

const PlotTypes: object = {
    Overview: function (_dataItem: DataItem): Array<string> {
        return ["cpu"];
    },
    CPU: function (_dataItem: DataItem): Array<string> {
        return ["cpu"];
    },
    Mem: function (_dataItem: DataItem): Array<string> {
        return ["mem:used"];
    },
    "CPU + Mem": function (_dataItem: DataItem): Array<string> {
        return ["cpu", "mem:used"];
    },
    "All CPU": function (dataItem: DataItem): Array<string> {
        return Object.keys(dataItem)
            .filter((item) => item.startsWith("cpu") && item != "cpu")
            .sort((a, b) => {
                const valA = parseInt(a.replace("cpu:", ""));
                const valB = parseInt(b.replace("cpu:", ""));
                return valA - valB;
            });
    },
};

const DefaultPlotMeta = {
    cpu: defaultCpuMeta("CPU %"),
    "mem:total": defaultMemMeta("Memory Total", "mem:total"),
    "mem:used": defaultMemMeta("Memory Used", "mem:total"),
    "mem:free": defaultMemMeta("Memory Free", "mem:total"),
    "mem:available": defaultMemMeta("Memory Available", "mem:total"),
};
for (let i = 0; i < 32; i++) {
    DefaultPlotMeta[`cpu:${i}`] = defaultCpuMeta(`Core ${i}`);
}

function convertWaveEventToDataItem(event: Extract<WaveEvent, { event: "sysinfo" }>): DataItem {
    const eventData = event.data;
    if (eventData == null || eventData.ts == null || eventData.values == null) {
        return null;
    }
    const dataItem = { ts: eventData.ts };
    for (const key in eventData.values) {
        dataItem[key] = eventData.values[key];
    }
    return dataItem;
}

class SysinfoViewModel implements ViewModel {
    viewType: string;
    termMode: jotai.Atom<string>;
    htmlElemFocusRef: React.RefObject<HTMLInputElement>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    dataAtom: jotai.PrimitiveAtom<Array<DataItem>>;
    addInitialDataAtom: jotai.WritableAtom<unknown, [DataItem[]], void>;
    addContinuousDataAtom: jotai.WritableAtom<unknown, [DataItem], void>;
    incrementCount: jotai.WritableAtom<unknown, [], Promise<void>>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    numPoints: jotai.Atom<number>;
    metrics: jotai.Atom<string[]>;
    connection: jotai.Atom<string>;
    manageConnection: jotai.Atom<boolean>;
    filterOutNowsh: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;
    plotMetaAtom: jotai.PrimitiveAtom<Map<string, TimeSeriesMeta>>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    plotTypeSelectedAtom: jotai.Atom<string>;
    env: SysinfoEnv;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "sysinfo";
        this.blockId = blockId;
        this.env = waveEnv;
        this.addInitialDataAtom = jotai.atom(null, (get, set, points) => {
            const targetLen = get(this.numPoints) + 1;
            try {
                const newDataRaw = [...points];
                if (newDataRaw.length == 0) {
                    return;
                }
                const latestItemTs = newDataRaw[newDataRaw.length - 1]?.ts ?? 0;
                const cutoffTs = latestItemTs - 1000 * targetLen;
                const blankItemTemplate = { ...newDataRaw[newDataRaw.length - 1] };
                for (const key in blankItemTemplate) {
                    blankItemTemplate[key] = NaN;
                }

                const newDataFiltered = newDataRaw.filter((dataItem) => dataItem.ts >= cutoffTs);
                if (newDataFiltered.length == 0) {
                    return;
                }
                const newDataWithGaps: Array<DataItem> = [];
                if (newDataFiltered[0].ts > cutoffTs) {
                    const blankItemStart = { ...blankItemTemplate, ts: cutoffTs };
                    const blankItemEnd = { ...blankItemTemplate, ts: newDataFiltered[0].ts - 1 };
                    newDataWithGaps.push(blankItemStart);
                    newDataWithGaps.push(blankItemEnd);
                }
                newDataWithGaps.push(newDataFiltered[0]);
                for (let i = 1; i < newDataFiltered.length; i++) {
                    const prevIdxItem = newDataFiltered[i - 1];
                    const curIdxItem = newDataFiltered[i];
                    const timeDiff = curIdxItem.ts - prevIdxItem.ts;
                    if (timeDiff > 2000) {
                        const blankItemStart = { ...blankItemTemplate, ts: prevIdxItem.ts + 1, blank: 1 };
                        const blankItemEnd = { ...blankItemTemplate, ts: curIdxItem.ts - 1, blank: 1 };
                        newDataWithGaps.push(blankItemStart);
                        newDataWithGaps.push(blankItemEnd);
                    }
                    newDataWithGaps.push(curIdxItem);
                }
                set(this.dataAtom, newDataWithGaps);
            } catch (e) {
                console.log("Error adding data to sysinfo", e);
            }
        });
        this.addContinuousDataAtom = jotai.atom(null, (get, set, newPoint) => {
            const targetLen = get(this.numPoints) + 1;
            const data = get(this.dataAtom);
            try {
                const latestItemTs = newPoint?.ts ?? 0;
                const cutoffTs = latestItemTs - 1000 * targetLen;
                data.push(newPoint);
                const newData = data.filter((dataItem) => dataItem.ts >= cutoffTs);
                set(this.dataAtom, newData);
            } catch (e) {
                console.log("Error adding data to sysinfo", e);
            }
        });
        this.plotMetaAtom = jotai.atom(new Map(Object.entries(DefaultPlotMeta)));
        this.manageConnection = jotai.atom(true);
        this.filterOutNowsh = jotai.atom(true);
        this.loadingAtom = jotai.atom(true);
        this.numPoints = jotai.atom((get) => {
            const metaNumPoints = get(this.env.getBlockMetaKeyAtom(blockId, "graph:numpoints"));
            if (metaNumPoints == null || metaNumPoints <= 0) {
                return DefaultNumPoints;
            }
            return metaNumPoints;
        });
        this.metrics = jotai.atom((get) => {
            const plotType = get(this.plotTypeSelectedAtom);
            const plotData = get(this.dataAtom);
            try {
                const metrics = PlotTypes[plotType](plotData[plotData.length - 1]);
                if (metrics == null || !Array.isArray(metrics)) {
                    return ["cpu"];
                }
                return metrics;
            } catch (e) {
                return ["cpu"];
            }
        });
        this.plotTypeSelectedAtom = jotai.atom((get) => {
            const plotType = get(this.env.getBlockMetaKeyAtom(blockId, "sysinfo:type"));
            if (plotType == null || typeof plotType != "string") {
                return "Overview";
            }
            return plotType;
        });
        this.viewIcon = jotai.atom((get) => {
            return "chart-line"; // should not be hardcoded
        });
        this.viewName = jotai.atom((get) => {
            return get(this.plotTypeSelectedAtom);
        });
        this.incrementCount = jotai.atom(null, async (get, _set) => {
            const count = get(this.env.getBlockMetaKeyAtom(blockId, "count")) ?? 0;
            await this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { count: count + 1 },
            });
        });
        this.connection = jotai.atom((get) => {
            const connValue = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            if (util.isBlank(connValue)) {
                return "local";
            }
            return connValue;
        });
        this.dataAtom = jotai.atom([]);
        this.loadInitialData();
        this.connStatus = jotai.atom((get) => {
            const connName = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });
    }

    get viewComponent(): ViewComponent {
        return SysinfoView;
    }

    async loadInitialData() {
        globalStore.set(this.loadingAtom, true);
        try {
            const numPoints = globalStore.get(this.numPoints);
            const connName = globalStore.get(this.connection);
            const initialData = await this.env.rpc.EventReadHistoryCommand(TabRpcClient, {
                event: "sysinfo",
                scope: connName,
                maxitems: numPoints,
            });
            if (initialData == null) {
                return;
            }
            this.getDefaultData();
            const initialDataItems: DataItem[] = initialData.map(convertWaveEventToDataItem);
            // splice the initial data into the default data (replacing the newest points)
            //newData.splice(newData.length - initialDataItems.length, initialDataItems.length, ...initialDataItems);
            globalStore.set(this.addInitialDataAtom, initialDataItems);
        } catch (e) {
            console.log("Error loading initial data for sysinfo", e);
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const fullConfig = globalStore.get(this.env.atoms.fullConfigAtom);
        const termThemes = fullConfig?.termthemes ?? {};
        const termThemeKeys = Object.keys(termThemes);
        const plotData = globalStore.get(this.dataAtom);

        termThemeKeys.sort((a, b) => {
            return (termThemes[a]["display:order"] ?? 0) - (termThemes[b]["display:order"] ?? 0);
        });
        const fullMenu: ContextMenuItem[] = [];
        let submenu: ContextMenuItem[];
        if (plotData.length == 0) {
            submenu = [];
        } else {
            submenu = Object.keys(PlotTypes).map((plotType) => {
                const dataTypes = PlotTypes[plotType](plotData[plotData.length - 1]);
                const currentlySelected = globalStore.get(this.plotTypeSelectedAtom);
                const menuItem: ContextMenuItem = {
                    label: plotType,
                    type: "radio",
                    checked: currentlySelected == plotType,
                    click: async () => {
                        await this.env.rpc.SetMetaCommand(TabRpcClient, {
                            oref: makeORef("block", this.blockId),
                            meta: { "graph:metrics": dataTypes, "sysinfo:type": plotType },
                        });
                    },
                };
                return menuItem;
            });
        }

        fullMenu.push({
            label: "Plot Type",
            submenu: submenu,
        });
        fullMenu.push({ type: "separator" });
        return fullMenu;
    }

    getDefaultData(): DataItem[] {
        // set it back one to avoid backwards line being possible
        const numPoints = globalStore.get(this.numPoints);
        const currentTime = Date.now() - 1000;
        const points: DataItem[] = [];
        for (let i = numPoints; i > -1; i--) {
            points.push({ ts: currentTime - i * 1000 });
        }
        return points;
    }
}

const _plotColors = ["#2997FF", "#FFC107", "#FF5722", "#2196F3", "#9C27B0", "#00BCD4", "#FFEB3B", "#795548"];

type SysinfoViewProps = {
    blockId: string;
    model: SysinfoViewModel;
};

function resolveDomainBound(value: number | string, dataItem: DataItem): number | undefined {
    if (typeof value == "number") {
        return value;
    } else if (typeof value == "string") {
        return dataItem?.[value];
    } else {
        return undefined;
    }
}

function SysinfoView({ model, blockId }: SysinfoViewProps) {
    const connName = jotai.useAtomValue(model.connection);
    const lastConnName = React.useRef(connName);
    const connStatus = jotai.useAtomValue(model.connStatus);
    const addContinuousData = jotai.useSetAtom(model.addContinuousDataAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);

    React.useEffect(() => {
        if (connStatus?.status != "connected") {
            return;
        }
        if (lastConnName.current !== connName) {
            lastConnName.current = connName;
            model.loadInitialData();
        }
    }, [connStatus.status, connName]);
    React.useEffect(() => {
        const unsubFn = waveEventSubscribeSingle({
            eventType: "sysinfo",
            scope: connName,
            handler: (event) => {
                const loading = globalStore.get(model.loadingAtom);
                if (loading) {
                    return;
                }
                const dataItem = convertWaveEventToDataItem(event);
                const prevData = globalStore.get(model.dataAtom);
                const prevLastTs = prevData[prevData.length - 1]?.ts ?? 0;
                if (dataItem.ts - prevLastTs > 2000) {
                    model.loadInitialData();
                } else {
                    addContinuousData(dataItem);
                }
            },
        });
        console.log("subscribe to sysinfo", connName);
        return () => {
            unsubFn();
        };
    }, [connName, addContinuousData]);
    if (connStatus?.status != "connected") {
        return null;
    }
    if (loading) {
        return null;
    }
    return <SysinfoViewInner key={connStatus?.connection ?? "local"} blockId={blockId} model={model} />;
}

type SingleLinePlotProps = {
    plotData: Array<DataItem>;
    yval: string;
    yvalMeta: TimeSeriesMeta;
    blockId: string;
    defaultColor: string;
    title?: boolean;
    sparkline?: boolean;
    targetLen: number;
};

function SingleLinePlot({
    plotData,
    yval,
    yvalMeta,
    blockId,
    defaultColor,
    title = false,
    sparkline = false,
    targetLen,
}: SingleLinePlotProps) {
    const containerRef = React.useRef<HTMLInputElement>(null);
    const domRect = useDimensionsWithExistingRef(containerRef, 300);
    const plotHeight = domRect?.height ?? 0;
    const plotWidth = domRect?.width ?? 0;
    const marks: Plot.Markish[] = [];
    const decimalPlaces = yvalMeta?.decimalPlaces ?? 0;
    let color = yvalMeta?.color;
    if (!color) {
        color = defaultColor;
    }
    marks.push(
        () => htl.svg`<defs>
      <linearGradient id="gradient-${blockId}-${yval}" gradientTransform="rotate(90)">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.7" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0" />
      </linearGradient>
	      </defs>`
    );

    marks.push(
        Plot.lineY(plotData, {
            stroke: color,
            strokeWidth: 2,
            x: "ts",
            y: yval,
        })
    );

    // only add the gradient for single items
    marks.push(
        Plot.areaY(plotData, {
            fill: `url(#gradient-${blockId}-${yval})`,
            x: "ts",
            y: yval,
        })
    );
    if (title) {
        marks.push(
            Plot.text([yvalMeta?.name], {
                frameAnchor: "top-left",
                dx: 4,
                fill: "var(--grey-text-color)",
            })
        );
    }
    const labelY = yvalMeta?.label ?? "?";
    marks.push(
        Plot.ruleX(
            plotData,
            Plot.pointerX({ x: "ts", py: yval, stroke: "var(--grey-text-color)", strokeWidth: 1, strokeDasharray: 2 })
        )
    );
    marks.push(
        Plot.ruleY(
            plotData,
            Plot.pointerX({ px: "ts", y: yval, stroke: "var(--grey-text-color)", strokeWidth: 1, strokeDasharray: 2 })
        )
    );
    marks.push(
        Plot.tip(
            plotData,
            Plot.pointerX({
                x: "ts",
                y: yval,
                fill: "var(--main-bg-color)",
                anchor: "middle",
                dy: -30,
                title: (d) =>
                    `${dayjs.unix(d.ts / 1000).format("HH:mm:ss")} ${Number(d[yval]).toFixed(decimalPlaces)}${labelY}`,
                textPadding: 3,
            })
        )
    );
    marks.push(
        Plot.dot(
            plotData,
            Plot.pointerX({ x: "ts", y: yval, fill: color, r: 3, stroke: "var(--main-text-color)", strokeWidth: 1 })
        )
    );
    const maxY = resolveDomainBound(yvalMeta?.maxy, plotData[plotData.length - 1]) ?? 100;
    const minY = resolveDomainBound(yvalMeta?.miny, plotData[plotData.length - 1]) ?? 0;
    const maxX = plotData[plotData.length - 1].ts;
    const minX = maxX - targetLen * 1000;
    const plot = Plot.plot({
        axis: !sparkline,
        x: {
            grid: true,
            label: "time",
            tickFormat: (d) => `${dayjs.unix(d / 1000).format("HH:mm:ss")}`,
            domain: [minX, maxX],
        },
        y: { label: labelY, domain: [minY, maxY] },
        width: plotWidth,
        height: plotHeight,
        marks: marks,
    });

    React.useEffect(() => {
        containerRef.current.append(plot);

        return () => {
            plot.remove();
        };
    }, [plot, plotWidth, plotHeight]);

    return <div ref={containerRef} className="min-h-[100px]" />;
}

// Severity gradient for usage meters: calm accent -> warning -> error, tied to theme tokens.
function usageColor(pct: number): string {
    if (pct == null || isNaN(pct)) {
        return "var(--grey-text-color)";
    }
    if (pct >= 85) {
        return "var(--error-color)";
    }
    if (pct >= 60) {
        return "var(--warning-color)";
    }
    return "var(--accent-color)";
}

// Most-recent non-NaN value for a key (the data is gap-filled with NaN, so scan back).
function latestValidValue(data: Array<DataItem>, key: string): number {
    for (let i = data.length - 1; i >= 0; i--) {
        const v = data[i]?.[key];
        if (v != null && !isNaN(v)) {
            return v;
        }
    }
    return NaN;
}

function cpuCoreKeys(item: DataItem): string[] {
    if (item == null) {
        return [];
    }
    return Object.keys(item)
        .filter((k) => k.startsWith("cpu:"))
        .sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
}

function fmtPct(v: number): string {
    return isNaN(v) ? "—" : `${Math.round(v)}%`;
}

function fmtGB(v: number): string {
    return isNaN(v) ? "—" : v.toFixed(1);
}

function fmtRate(bps: number): string {
    if (bps == null || isNaN(bps)) {
        return "—";
    }
    if (bps < 1024) {
        return `${Math.round(bps)} B/s`;
    }
    if (bps < 1024 * 1024) {
        return `${(bps / 1024).toFixed(1)} KB/s`;
    }
    return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

const CoreMeter = React.memo(({ label, pct }: { label: string; pct: number }) => {
    const width = isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
    return (
        <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted w-[26px] shrink-0">{label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-hoverbg overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: usageColor(pct) }} />
            </div>
            <span className="font-mono text-[11px] text-secondary w-[30px] text-right shrink-0">{fmtPct(pct)}</span>
        </div>
    );
});
CoreMeter.displayName = "CoreMeter";

type SysinfoDashboardProps = {
    model: SysinfoViewModel;
    plotData: Array<DataItem>;
    plotMeta: Map<string, TimeSeriesMeta>;
    targetLen: number;
};

function SysinfoDashboard({ model, plotData, plotMeta, targetLen }: SysinfoDashboardProps) {
    const latest = plotData[plotData.length - 1];
    const cpu = latestValidValue(plotData, "cpu");
    const coreKeys = cpuCoreKeys(latest);
    const memUsed = latestValidValue(plotData, "mem:used");
    const memTotal = latestValidValue(plotData, "mem:total");
    const memAvail = latestValidValue(plotData, "mem:available");
    const memFree = latestValidValue(plotData, "mem:free");
    const memPct = !isNaN(memUsed) && memTotal > 0 ? (memUsed / memTotal) * 100 : NaN;
    const netUp = latestValidValue(plotData, "net:up");
    const netDown = latestValidValue(plotData, "net:down");
    const diskUsed = latestValidValue(plotData, "disk:used");
    const diskTotal = latestValidValue(plotData, "disk:total");
    const diskFree = latestValidValue(plotData, "disk:free");
    const diskPct = latestValidValue(plotData, "disk:percent");
    const [coresExpanded, setCoresExpanded] = React.useState(true);

    return (
        <div className="flex flex-col gap-[10px] p-0.5">
            <div className="bg-modalbg border border-border rounded-[10px] px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                    <i className="fa-sharp fa-solid fa-microchip text-[16px]" style={{ color: "var(--accent-color)" }} />
                    <span className="text-foreground text-[13px]">CPU</span>
                    {coreKeys.length > 0 && (
                        <button
                            className="flex items-center gap-1 bg-transparent border-0 p-0 text-muted text-[12px] cursor-pointer hover:text-secondary"
                            onClick={() => setCoresExpanded((v) => !v)}
                        >
                            {coreKeys.length} cores
                            <i
                                className={clsx(
                                    "fa-sharp fa-solid text-[9px]",
                                    coresExpanded ? "fa-chevron-up" : "fa-chevron-down"
                                )}
                            />
                        </button>
                    )}
                    <span className="ml-auto font-mono text-[26px] font-medium leading-none" style={{ color: usageColor(cpu) }}>
                        {fmtPct(cpu)}
                    </span>
                </div>
                <div className="h-[100px] mt-2">
                    <SingleLinePlot
                        plotData={plotData}
                        yval="cpu"
                        yvalMeta={plotMeta.get("cpu")}
                        blockId={model.blockId}
                        defaultColor="var(--accent-color)"
                        sparkline={true}
                        targetLen={targetLen}
                    />
                </div>
                {coreKeys.length > 0 && coresExpanded && (
                    <div
                        className="mt-2.5 grid gap-x-4 gap-y-1.5"
                        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}
                    >
                        {coreKeys.map((key) => (
                            <CoreMeter key={key} label={`C${key.slice(4)}`} pct={latestValidValue(plotData, key)} />
                        ))}
                    </div>
                )}
            </div>

            <div className="bg-modalbg border border-border rounded-[10px] px-3.5 py-3">
                <div className="flex items-center gap-2.5 mb-2">
                    <i className="fa-sharp fa-solid fa-memory text-[16px]" style={{ color: "var(--accent-color)" }} />
                    <span className="text-foreground text-[13px]">Memory</span>
                    {!isNaN(memTotal) && (
                        <span className="text-muted font-mono text-[12px]">
                            {fmtGB(memUsed)} / {fmtGB(memTotal)} GB
                        </span>
                    )}
                    <span className="ml-auto font-mono text-[20px] font-medium leading-none" style={{ color: usageColor(memPct) }}>
                        {fmtPct(memPct)}
                    </span>
                </div>
                <div className="h-2.5 rounded-full bg-hoverbg overflow-hidden">
                    <div
                        className="h-full rounded-full"
                        style={{ width: `${isNaN(memPct) ? 0 : memPct}%`, backgroundColor: usageColor(memPct) }}
                    />
                </div>
                <div className="flex gap-4 mt-1.5">
                    <span className="text-muted text-[11px]">
                        used <span className="text-secondary font-mono">{fmtGB(memUsed)}G</span>
                    </span>
                    <span className="text-muted text-[11px]">
                        avail <span className="text-secondary font-mono">{fmtGB(memAvail)}G</span>
                    </span>
                    <span className="text-muted text-[11px]">
                        free <span className="text-secondary font-mono">{fmtGB(memFree)}G</span>
                    </span>
                </div>
            </div>

            <div className="bg-modalbg border border-border rounded-[10px] px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                    <i className="fa-sharp fa-solid fa-arrows-up-down text-[16px]" style={{ color: "var(--accent-color)" }} />
                    <span className="text-foreground text-[13px]">Network</span>
                    <span className="ml-auto flex items-center gap-4 font-mono text-[13px]">
                        <span style={{ color: "var(--accent-color)" }}>
                            <i className="fa-sharp fa-solid fa-arrow-down text-[10px] mr-1" />
                            {fmtRate(netDown)}
                        </span>
                        <span className="text-secondary">
                            <i className="fa-sharp fa-solid fa-arrow-up text-[10px] mr-1" />
                            {fmtRate(netUp)}
                        </span>
                    </span>
                </div>
            </div>

            <div className="bg-modalbg border border-border rounded-[10px] px-3.5 py-3">
                <div className="flex items-center gap-2.5 mb-2">
                    <i className="fa-sharp fa-solid fa-hard-drive text-[16px]" style={{ color: "var(--accent-color)" }} />
                    <span className="text-foreground text-[13px]">Disk</span>
                    {!isNaN(diskTotal) && (
                        <span className="text-muted font-mono text-[12px]">
                            {fmtGB(diskUsed)} / {fmtGB(diskTotal)} GB
                        </span>
                    )}
                    <span
                        className="ml-auto font-mono text-[20px] font-medium leading-none"
                        style={{ color: usageColor(diskPct) }}
                    >
                        {fmtPct(diskPct)}
                    </span>
                </div>
                <div className="h-2.5 rounded-full bg-hoverbg overflow-hidden">
                    <div
                        className="h-full rounded-full"
                        style={{ width: `${isNaN(diskPct) ? 0 : diskPct}%`, backgroundColor: usageColor(diskPct) }}
                    />
                </div>
                <div className="flex gap-4 mt-1.5">
                    <span className="text-muted text-[11px]">
                        used <span className="text-secondary font-mono">{fmtGB(diskUsed)}G</span>
                    </span>
                    <span className="text-muted text-[11px]">
                        free <span className="text-secondary font-mono">{fmtGB(diskFree)}G</span>
                    </span>
                </div>
            </div>
        </div>
    );
}

const SysinfoViewInner = React.memo(({ model }: SysinfoViewProps) => {
    const plotData = jotai.useAtomValue(model.dataAtom);
    const yvals = jotai.useAtomValue(model.metrics);
    const plotMeta = jotai.useAtomValue(model.plotMetaAtom);
    const osRef = React.useRef<OverlayScrollbarsComponentRef>(null);
    const targetLen = jotai.useAtomValue(model.numPoints) + 1;
    const plotType = jotai.useAtomValue(model.plotTypeSelectedAtom);
    let title = false;
    let cols2 = false;
    if (yvals.length > 1) {
        title = true;
    }
    if (yvals.length > 2) {
        cols2 = true;
    }

    if (plotType === "Overview") {
        return (
            <OverlayScrollbarsComponent
                ref={osRef}
                className="flex flex-col flex-grow mb-0 overflow-y-auto"
                options={{ scrollbars: { autoHide: "leave" } }}
            >
                {plotData && plotData.length > 0 && (
                    <SysinfoDashboard model={model} plotData={plotData} plotMeta={plotMeta} targetLen={targetLen} />
                )}
            </OverlayScrollbarsComponent>
        );
    }

    return (
        <OverlayScrollbarsComponent
            ref={osRef}
            className="flex flex-col flex-grow mb-0 overflow-y-auto"
            options={{ scrollbars: { autoHide: "leave" } }}
        >
            <div
                className={clsx("w-full h-full grid grid-rows-[repeat(auto-fit,minmax(100px,1fr))] gap-[10px]", {
                    "grid-cols-2": cols2,
                })}
            >
                {plotData &&
                    plotData.length > 0 &&
                    yvals.map((yval, _idx) => {
                        return (
                            <SingleLinePlot
                                key={`plot-${model.blockId}-${yval}`}
                                plotData={plotData}
                                yval={yval}
                                yvalMeta={plotMeta.get(yval)}
                                blockId={model.blockId}
                                defaultColor={"var(--accent-color)"}
                                title={title}
                                targetLen={targetLen}
                            />
                        );
                    })}
            </div>
        </OverlayScrollbarsComponent>
    );
});

export { SysinfoViewModel };
