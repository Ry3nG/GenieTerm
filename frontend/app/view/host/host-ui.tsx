// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { Sparkline } from "./host-sparkline";
import { clampPct, HostHistoryLength, isValidNumber, usageTone } from "./hostutil";

export const ToneColor: Record<string, string> = {
    normal: "var(--accent-color)",
    warning: "var(--warning-color)",
    error: "var(--error-color)",
    none: "var(--grey-text-color)",
};

export function toneColor(pct: number): string {
    return ToneColor[usageTone(pct)];
}

export function Card({
    className,
    children,
    onClick,
    label,
}: {
    className?: string;
    children: React.ReactNode;
    onClick?: () => void;
    label?: string;
}) {
    const base = "@container/card min-w-0 rounded-xl border border-border bg-panel px-4 py-3.5 text-left";
    if (onClick == null) {
        return <section className={cn(base, className)}>{children}</section>;
    }
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
                base,
                // not Tailwind "block": every block frame in the app has that class and its own styles
                "flex w-full cursor-pointer flex-col items-stretch outline-none transition-colors hover:border-foreground/20 hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent",
                className
            )}
        >
            {children}
        </button>
    );
}

export function CardHeader({
    icon,
    title,
    detail,
    value,
    valueColor,
    large,
}: {
    icon: string;
    title: string;
    detail?: React.ReactNode;
    value?: string;
    valueColor?: string;
    large?: boolean;
}) {
    return (
        <div className="flex items-start gap-3">
            <div
                className={cn(
                    "flex shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent",
                    large ? "h-9 w-9" : "h-7 w-7"
                )}
            >
                <i className={cn("fa-solid", large ? "text-[15px]" : "text-[12px]", icon)} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
                <div
                    className={cn(
                        "font-semibold text-primary",
                        large ? "text-[16px] leading-6" : "text-[13px] leading-5"
                    )}
                >
                    {title}
                </div>
                {detail && (
                    <div
                        className={cn("text-[12px] leading-4 text-muted", large ? "line-clamp-2" : "truncate")}
                        title={typeof detail === "string" ? detail : undefined}
                    >
                        {detail}
                    </div>
                )}
            </div>
            {value != null && (
                <div
                    className={cn(
                        "shrink-0 font-semibold tabular-nums",
                        large ? "text-[30px] leading-9" : "text-[22px] leading-7"
                    )}
                    style={{ color: valueColor ?? "var(--main-text-color)" }}
                >
                    {value}
                </div>
            )}
        </div>
    );
}

export function Meter({ pct, color, className }: { pct: number; color?: string; className?: string }) {
    return (
        <div className={cn("h-1.5 overflow-hidden rounded-full bg-foreground/10", className)}>
            <div
                className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${clampPct(pct)}%`, backgroundColor: color ?? toneColor(pct) }}
            />
        </div>
    );
}

export function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[11px] leading-4 text-muted">{label}</div>
            <div
                className="truncate text-[13px] font-medium leading-5 tabular-nums"
                style={{ color: tone ? ToneColor[tone] : "var(--main-text-color)" }}
            >
                {value}
            </div>
            {sub && <div className="truncate text-[11px] leading-4 text-muted">{sub}</div>}
        </div>
    );
}

export function coreKeys(values: { [key: string]: number }): string[] {
    return Object.keys(values ?? {})
        .filter((k) => k.startsWith("cpu:"))
        .sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
}

export function coreCellColor(pct: number): string {
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

export function formatGpuPower(gpu: GpuData): string {
    if (isValidNumber(gpu.power) && isValidNumber(gpu.powerlimit)) {
        return `${Math.round(gpu.power)}/${Math.round(gpu.powerlimit)} W`;
    }
    if (isValidNumber(gpu.power)) {
        return `${Math.round(gpu.power)} W`;
    }
    return "—";
}

// Summary-card chart: the frame and midline keep a low, flat series reading as a chart, not empty space.
export function MiniChart({
    series,
    max = 100,
    label,
    className,
}: {
    series: { values: number[]; color: string; fill?: boolean }[];
    max?: number;
    label: string;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "relative h-14 overflow-hidden rounded-md border border-border/60 bg-background/40",
                className
            )}
        >
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-foreground/[0.07]" />
            <Sparkline className="absolute inset-0 h-full" series={series} max={max} label={label} />
        </div>
    );
}

type ChartSeries = { values: number[]; color: string; fill?: boolean; label?: string };

// A larger chart for detail views: gridlines at quarters, a y-axis label, and the time span.
export function DetailChart({
    series,
    max = 100,
    topLabel = "100%",
    title,
    className,
}: {
    series: ChartSeries[];
    max?: number;
    topLabel?: string;
    title: string;
    className?: string;
}) {
    return (
        <div className={cn("min-w-0", className)}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[11px] text-muted">
                <span>{title}</span>
                <span className="flex items-center gap-3">
                    {series
                        .filter((s) => s.label)
                        .map((s) => (
                            <span key={s.label} className="flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                                {s.label}
                            </span>
                        ))}
                    <span className="tabular-nums">{topLabel}</span>
                </span>
            </div>
            <div className="relative h-28 rounded-lg border border-border bg-background/40 @[560px]:h-40">
                {[25, 50, 75].map((y) => (
                    <div
                        key={y}
                        className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/[0.07]"
                        style={{ top: `${y}%` }}
                    />
                ))}
                <Sparkline className="absolute inset-0 h-full" series={series} max={max} label={title} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted/80">
                <span>{HostHistoryLength} s ago</span>
                <span>now</span>
            </div>
        </div>
    );
}
