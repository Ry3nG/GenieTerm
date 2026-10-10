// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import * as Plot from "@observablehq/plot";
import * as htl from "htl";
import * as React from "react";

export type DataItem = {
    ts: number;
    [k: string]: number;
};

function padTime(value: number): string {
    return String(value).padStart(2, "0");
}

function formatTimeOfDay(unixMillis: number): string {
    const date = new Date(unixMillis);
    return `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`;
}

function resolveDomainBound(value: number | string, dataItem: DataItem): number | undefined {
    if (typeof value == "number") {
        return value;
    } else if (typeof value == "string") {
        return dataItem?.[value];
    } else {
        return undefined;
    }
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

export function SingleLinePlot({
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
    const plot = React.useMemo(() => {
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
                Plot.pointerX({
                    x: "ts",
                    py: yval,
                    stroke: "var(--grey-text-color)",
                    strokeWidth: 1,
                    strokeDasharray: 2,
                })
            )
        );
        marks.push(
            Plot.ruleY(
                plotData,
                Plot.pointerX({
                    px: "ts",
                    y: yval,
                    stroke: "var(--grey-text-color)",
                    strokeWidth: 1,
                    strokeDasharray: 2,
                })
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
                    title: (d) => `${formatTimeOfDay(d.ts)} ${Number(d[yval]).toFixed(decimalPlaces)}${labelY}`,
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
        return Plot.plot({
            axis: !sparkline,
            x: {
                grid: true,
                label: "time",
                tickFormat: (d) => `${formatTimeOfDay(Number(d))}`,
                domain: [minX, maxX],
            },
            y: { label: labelY, domain: [minY, maxY] },
            width: plotWidth,
            height: plotHeight,
            marks: marks,
        });
    }, [plotData, plotWidth, plotHeight, yval, yvalMeta, blockId, defaultColor, title, sparkline, targetLen]);

    React.useEffect(() => {
        containerRef.current.append(plot);

        return () => {
            plot.remove();
        };
    }, [plot]);

    return <div ref={containerRef} className="min-h-[100px]" />;
}
