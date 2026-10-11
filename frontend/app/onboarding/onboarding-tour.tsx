// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { cn } from "@/util/util";

export type FeatureItem = {
    icon: string;
    title: string;
    description: React.ReactNode;
};

export function FeatureRow({ icon, title, description, size = "md" }: FeatureItem & { size?: "md" | "lg" }) {
    const large = size === "lg";
    return (
        <div className={cn("flex w-full items-start", large ? "gap-4" : "gap-3.5")}>
            <div
                className={cn(
                    "flex flex-shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent",
                    large ? "h-9 w-9" : "h-8 w-8"
                )}
            >
                <i className={cn("fa-solid", icon, large ? "text-[15px]" : "text-[13px]")} aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
                <div className={cn("font-semibold text-foreground", large ? "text-[14px]" : "text-[13.5px]")}>
                    {title}
                </div>
                <div className="text-pretty text-[13px] leading-5 text-secondary">{description}</div>
            </div>
        </div>
    );
}

export function Keys({ combo }: { combo: string }) {
    return (
        <kbd className="mx-px inline-flex h-[19px] items-center rounded-[5px] border border-border bg-hover px-1.5 align-[1px] font-sans text-[11px] leading-none tracking-[0.04em] text-foreground">
            {combo}
        </kbd>
    );
}

export function TourWindow({
    icon,
    title,
    badge,
    children,
}: {
    icon: string;
    title: string;
    badge?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-black/40 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.7)]">
            <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border px-3 text-[12px] text-secondary">
                <i className={cn("fa-solid text-[11px] text-muted", icon)} aria-hidden="true" />
                <span className="min-w-0 truncate">{title}</span>
                {badge}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-3 font-mono text-[12px] leading-[1.65]">{children}</div>
        </div>
    );
}

export function TourFooter({
    step,
    total,
    onNext,
    onPrev,
    onSkip,
}: {
    step: number;
    total: number;
    onNext: () => void;
    onPrev?: () => void;
    onSkip?: () => void;
}) {
    const isLast = step === total;
    return (
        <footer className="unselectable mt-7 flex flex-shrink-0 items-center justify-between">
            <div className="flex items-center gap-1.5" role="img" aria-label={`Step ${step} of ${total}`}>
                {Array.from({ length: total }, (_, idx) => (
                    <span
                        key={idx}
                        className={cn(
                            "h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none",
                            idx + 1 === step ? "w-5 bg-accent" : "w-1.5 bg-foreground/25"
                        )}
                    />
                ))}
            </div>
            <div className="flex items-center gap-1.5 [&>button:last-child]:!px-5 [&>button:last-child]:!py-2 [&>button:last-child]:text-sm">
                {!isLast && onSkip && (
                    <button
                        className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-muted transition-colors hover:text-foreground"
                        onClick={onSkip}
                    >
                        Skip tour
                    </button>
                )}
                {step > 1 && onPrev && (
                    <button
                        className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] text-secondary transition-colors hover:bg-hover hover:text-foreground"
                        onClick={onPrev}
                    >
                        Back
                    </button>
                )}
                <Button className="font-[600]" onClick={onNext}>
                    {isLast ? "Start using GenieTerm" : "Next"}
                </Button>
            </div>
        </footer>
    );
}

export function TourPage({
    eyebrow,
    title,
    lede,
    features,
    illustration,
    footer,
}: {
    eyebrow: string;
    title: string;
    lede: React.ReactNode;
    features: FeatureItem[];
    illustration: React.ReactNode;
    footer: React.ReactNode;
}) {
    return (
        <div className="flex h-full flex-col">
            <header className="unselectable mb-6 flex-shrink-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">{eyebrow}</div>
                <h2 className="mt-1.5 text-[24px] font-semibold leading-tight text-foreground">{title}</h2>
                <p className="mt-2 max-w-[620px] text-pretty text-[14px] leading-6 text-secondary">{lede}</p>
            </header>
            {/* in a short window the modal is clamped; the middle scrolls so Back/Next stay on screen */}
            <div className="unselectable min-h-0 flex-1 overflow-y-auto">
                <div className="grid h-[292px] grid-cols-[minmax(0,1fr)_372px] gap-8">
                    <div className="flex flex-col justify-center gap-5">
                        {features.map((feature) => (
                            <FeatureRow key={feature.title} {...feature} />
                        ))}
                    </div>
                    <div className="min-h-0">{illustration}</div>
                </div>
            </div>
            {footer}
        </div>
    );
}
