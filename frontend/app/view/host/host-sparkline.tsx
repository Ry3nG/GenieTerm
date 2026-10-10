// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useId } from "react";
import { HostHistoryLength } from "./hostutil";

type SparklineSeries = {
    values: number[];
    color: string;
    fill?: boolean;
};

type SparklineProps = {
    series: SparklineSeries[];
    max?: number;
    length?: number;
    className?: string;
    label?: string;
};

// Points are laid out right-aligned on a fixed time axis so a short history grows in from the right
// instead of stretching across the whole width.
function makePaths(values: number[], max: number, length: number): { line: string; area: string } {
    const offset = length - values.length;
    let line = "";
    let area = "";
    let segStart = -1;
    let prevX = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const x = offset + i;
        if (!Number.isFinite(v)) {
            if (segStart >= 0) {
                area += `L${prevX},100L${segStart},100Z`;
                segStart = -1;
            }
            continue;
        }
        const y = 100 - (Math.max(0, Math.min(max, v)) / max) * 100;
        if (segStart < 0) {
            line += `M${x},${y}`;
            area += `M${x},100L${x},${y}`;
            segStart = x;
        } else {
            line += `L${x},${y}`;
            area += `L${x},${y}`;
        }
        prevX = x;
    }
    if (segStart >= 0) {
        area += `L${prevX},100L${segStart},100Z`;
    }
    return { line, area };
}

export const Sparkline = memo(({ series, max = 100, length = HostHistoryLength, className, label }: SparklineProps) => {
    const id = useId();
    const safeMax = max > 0 ? max : 1;
    return (
        <svg
            // "block" is also the class of every block frame in this app, so display is set inline
            className={cn("w-full overflow-visible", className)}
            style={{ display: "block" }}
            viewBox={`0 0 ${Math.max(1, length - 1)} 100`}
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
        >
            {series.map((s, idx) => {
                const { line, area } = makePaths(s.values, safeMax, length);
                const gradId = `${id}-g${idx}`;
                return (
                    <g key={idx}>
                        {s.fill !== false && (
                            <>
                                <defs>
                                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <path d={area} fill={`url(#${gradId})`} stroke="none" />
                            </>
                        )}
                        <path
                            d={line}
                            fill="none"
                            stroke={s.color}
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            vectorEffect="non-scaling-stroke"
                        />
                    </g>
                );
            })}
        </svg>
    );
});
Sparkline.displayName = "Sparkline";
