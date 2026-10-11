// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
