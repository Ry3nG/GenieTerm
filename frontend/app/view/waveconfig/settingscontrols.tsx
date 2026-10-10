// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useEffect, useId, useState, type ReactNode } from "react";

type ControlProps<T> = {
    id: string;
    busy?: boolean;
    value: T;
    onCommit: (value: T) => Promise<boolean>;
};

export type SettingsNumberRange = { min: number; max: number; step?: number };

export function parseSettingsNumber(
    input: string,
    current: number,
    { min, max, step = 1 }: SettingsNumberRange
): number {
    const trimmed = input.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
        return current;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
        return current;
    }
    const clamped = Math.min(max, Math.max(min, value));
    return Math.min(max, Math.max(min, Number((Math.round(clamped / step) * step).toFixed(6))));
}

const FocusStyle = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const InputStyle =
    "h-8 rounded-md border border-border bg-background px-2.5 text-sm text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent aria-disabled:opacity-60";

export function SettingsSection({
    title,
    children,
    footer,
}: {
    title: string;
    children: ReactNode;
    footer?: ReactNode;
}) {
    const id = useId();
    return (
        <section aria-labelledby={id} className="space-y-2.5">
            <h2 id={id} className="px-1 text-sm font-semibold">
                {title}
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
                {children}
            </div>
            {footer && <div className="px-1 text-xs leading-5 text-secondary">{footer}</div>}
        </section>
    );
}

export function SettingsRow({
    id,
    label,
    description,
    children,
}: {
    id: string;
    label: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-3">
            <div className="min-w-0 flex-1 basis-56">
                <div id={`${id}-label`} className="text-sm font-medium leading-5">
                    {label}
                </div>
                <div id={`${id}-description`} className="mt-0.5 text-xs leading-5 text-secondary">
                    {description}
                </div>
            </div>
            <div className="ml-auto max-w-full shrink-0">{children}</div>
        </div>
    );
}

export function SettingsToggle({ id, value, onCommit, busy }: ControlProps<boolean>) {
    return (
        <button
            id={id}
            type="button"
            role="switch"
            aria-checked={value}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-description`}
            aria-disabled={busy}
            onClick={() => {
                if (!busy) void onCommit(!value);
            }}
            className={cn(
                "flex h-6 w-10 cursor-pointer items-center rounded-full p-[3px] transition-colors duration-150 motion-reduce:transition-none aria-disabled:opacity-60",
                FocusStyle,
                value ? "bg-accent" : "bg-highlightbg"
            )}
        >
            <span
                className={cn(
                    "h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none",
                    value ? "translate-x-4" : "translate-x-0"
                )}
            />
        </button>
    );
}

export type SettingsOption = { value: string; label: string; image?: string };

export function SettingsSegmented({
    id,
    value,
    options,
    onCommit,
    busy,
}: ControlProps<string> & { options: SettingsOption[] }) {
    return (
        <div
            role="radiogroup"
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-description`}
            className="flex max-w-full gap-0.5 rounded-lg border border-border bg-background p-0.5"
        >
            {options.map((option, index) => (
                <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={value === option.value}
                    aria-disabled={busy}
                    tabIndex={
                        value === option.value || (!options.some((item) => item.value === value) && index === 0)
                            ? 0
                            : -1
                    }
                    onClick={() => {
                        if (!busy && value !== option.value) void onCommit(option.value);
                    }}
                    onKeyDown={(event) => {
                        const direction = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
                        if (direction == null && event.key !== "Home" && event.key !== "End") return;
                        event.preventDefault();
                        if (busy) return;
                        const nextIndex =
                            event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? options.length - 1
                                  : (index + direction + options.length) % options.length;
                        const buttons = event.currentTarget.parentElement.querySelectorAll<HTMLButtonElement>("button");
                        buttons[nextIndex].focus();
                        void onCommit(options[nextIndex].value);
                    }}
                    className={cn(
                        "flex min-h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors duration-150 motion-reduce:transition-none aria-disabled:opacity-60",
                        FocusStyle,
                        value === option.value
                            ? "bg-accent/80 text-primary hover:bg-accent"
                            : "text-secondary hover:bg-hover hover:text-primary"
                    )}
                >
                    {option.image && (
                        <img
                            src={option.image}
                            alt=""
                            draggable={false}
                            className="h-6 w-6 rounded-md border border-border object-cover"
                        />
                    )}
                    {option.label}
                </button>
            ))}
        </div>
    );
}

export function SettingsNumber({
    id,
    value,
    onCommit,
    min,
    max,
    step = 1,
    busy,
}: ControlProps<number> & SettingsNumberRange) {
    const [draft, setDraft] = useState(String(value));
    useEffect(() => setDraft(String(value)), [value]);
    const commit = async () => {
        if (busy) return;
        const next = parseSettingsNumber(draft, value, { min, max, step });
        setDraft(String(next));
        if (next !== value && !(await onCommit(next))) setDraft(String(value));
    };
    return (
        <input
            id={id}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-description`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            readOnly={busy}
            aria-disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                    setDraft(String(value));
                    event.stopPropagation();
                }
            }}
            className={cn(InputStyle, "w-24 text-right tabular-nums")}
        />
    );
}

export function SettingsText({
    id,
    value,
    onCommit,
    placeholder,
    busy,
}: ControlProps<string> & { placeholder: string }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = async () => {
        if (busy) return;
        const next = draft.trim();
        setDraft(next);
        if (next !== value && !(await onCommit(next))) setDraft(value);
    };
    return (
        <input
            id={id}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-description`}
            type="text"
            value={draft}
            readOnly={busy}
            aria-disabled={busy}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                    setDraft(value);
                    event.stopPropagation();
                }
            }}
            className={cn(InputStyle, "w-48 max-w-full placeholder:text-muted")}
        />
    );
}
