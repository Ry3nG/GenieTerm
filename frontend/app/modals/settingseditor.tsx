// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { modalsModel } from "@/app/store/modalmodel";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useMemo, useRef, useState, useEffect } from "react";

type SettingControl =
    | { kind: "toggle" }
    | { kind: "select"; options: { value: string; label: string }[] }
    | { kind: "number"; min?: number; max?: number; step?: number };

type SettingDescriptor = {
    key: string;
    label: string;
    hint?: string;
    control: SettingControl;
};

type SettingGroup = { title: string; items: SettingDescriptor[] };

// Curated, high-value subset surfaced as a GUI. The full set remains editable via
// Command Palette → "Config: Edit settings.json".
const SETTING_GROUPS: SettingGroup[] = [
    {
        title: "Terminal",
        items: [
            {
                key: "term:presentation",
                label: "Command presentation",
                hint: "Semantic command blocks or classic xterm",
                control: {
                    kind: "select",
                    options: [
                        { value: "semantic", label: "Semantic blocks" },
                        { value: "classic", label: "Classic xterm" },
                    ],
                },
            },
            {
                key: "term:commandcomposer",
                label: "AI command composer",
                hint: "Natural language → command",
                control: { kind: "toggle" },
            },
            { key: "term:fontsize", label: "Font size", control: { kind: "number", min: 6, max: 64, step: 1 } },
            {
                key: "term:cursor",
                label: "Cursor style",
                control: {
                    kind: "select",
                    options: [
                        { value: "block", label: "Block" },
                        { value: "bar", label: "Bar" },
                        { value: "underline", label: "Underline" },
                    ],
                },
            },
            { key: "term:cursorblink", label: "Cursor blink", control: { kind: "toggle" } },
            { key: "term:copyonselect", label: "Copy on select", control: { kind: "toggle" } },
            { key: "term:bellindicator", label: "Bell indicator", control: { kind: "toggle" } },
        ],
    },
    {
        title: "Behavior",
        items: [
            {
                key: "app:focusfollowscursor",
                label: "Focus follows cursor",
                control: {
                    kind: "select",
                    options: [
                        { value: "off", label: "Off" },
                        { value: "on", label: "On" },
                        { value: "term", label: "Terminal only" },
                    ],
                },
            },
            { key: "window:confirmclose", label: "Confirm before closing window", control: { kind: "toggle" } },
            { key: "app:confirmquit", label: "Confirm before quitting", control: { kind: "toggle" } },
            { key: "conn:wshenabled", label: "Enable wsh on connections", control: { kind: "toggle" } },
        ],
    },
    {
        title: "Privacy & updates",
        items: [
            {
                key: "telemetry:enabled",
                label: "Telemetry",
                hint: "Off by default — GenieTerm never phones home to Wave",
                control: { kind: "toggle" },
            },
            { key: "autoupdate:enabled", label: "Automatic updates", control: { kind: "toggle" } },
            {
                key: "autoupdate:channel",
                label: "Update channel",
                control: {
                    kind: "select",
                    options: [
                        { value: "latest", label: "Stable" },
                        { value: "beta", label: "Beta" },
                    ],
                },
            },
        ],
    },
];

const SettingControlView = ({
    descriptor,
    value,
    onChange,
}: {
    descriptor: SettingDescriptor;
    value: any;
    onChange: (value: any) => void;
}) => {
    const control = descriptor.control;
    if (control.kind === "toggle") {
        const on = Boolean(value);
        return (
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={descriptor.label}
                onClick={() => onChange(!on)}
                className={cn(
                    "relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0",
                    on ? "bg-accent" : "bg-white/15"
                )}
            >
                <span
                    className={cn(
                        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                        on ? "translate-x-4" : "translate-x-0"
                    )}
                />
            </button>
        );
    }
    if (control.kind === "select") {
        return (
            <select
                value={String(value ?? control.options[0].value)}
                onChange={(e) => onChange(e.target.value)}
                aria-label={descriptor.label}
                className="bg-white/8 border border-border rounded text-foreground text-[12px] px-2 py-1 cursor-pointer outline-none"
            >
                {control.options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>
        );
    }
    return (
        <input
            type="number"
            value={value ?? ""}
            min={control.min}
            max={control.max}
            step={control.step}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            aria-label={descriptor.label}
            className="w-16 bg-white/8 border border-border rounded text-foreground text-[12px] px-2 py-1 outline-none"
        />
    );
};

const SettingsModal = () => {
    const settings = (useAtomValue(atoms.settingsAtom) ?? {}) as Record<string, any>;
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const close = () => modalsModel.popModal();
    const setVal = (key: string, value: any) =>
        fireAndForget(() => RpcApi.SetConfigCommand(TabRpcClient, { [key]: value }));

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return SETTING_GROUPS;
        }
        return SETTING_GROUPS.map((g) => ({
            ...g,
            items: g.items.filter((i) => i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q)),
        })).filter((g) => g.items.length > 0);
    }, [query]);

    const onSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[500] flex items-start justify-center"
            onMouseDown={close}
            role="dialog"
            aria-label="Settings"
        >
            <div className="absolute inset-0 bg-black/45" />
            <div
                className="relative mt-[10vh] w-[600px] max-w-[92vw] bg-modalbg border border-border rounded-[12px] overflow-hidden shadow-[0px_12px_40px_0px_rgba(0,0,0,0.4)]"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-[14px] text-foreground font-medium">Settings</span>
                    <button
                        type="button"
                        className="text-secondary hover:text-foreground cursor-pointer"
                        onClick={close}
                        aria-label="Close"
                    >
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search settings…"
                    className="w-full bg-transparent border-0 border-b border-border outline-none px-4 py-2.5 text-foreground text-[13px]"
                    aria-label="Search settings"
                />
                <div className="max-h-[440px] overflow-auto py-1">
                    {groups.length === 0 ? (
                        <div className="px-4 py-3 text-muted text-[13px]">No matching settings</div>
                    ) : (
                        groups.map((group) => (
                            <div key={group.title}>
                                <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-muted">
                                    {group.title}
                                </div>
                                {group.items.map((item) => (
                                    <div
                                        key={item.key}
                                        className="flex items-center justify-between gap-4 px-4 py-2 hover:bg-white/5"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-[13px] text-foreground">{item.label}</div>
                                            {item.hint && (
                                                <div className="text-[11px] text-muted truncate">{item.hint}</div>
                                            )}
                                        </div>
                                        <SettingControlView
                                            descriptor={item}
                                            value={settings[item.key]}
                                            onChange={(v) => setVal(item.key, v)}
                                        />
                                    </div>
                                ))}
                            </div>
                        ))
                    )}
                </div>
                <div className="px-4 py-2.5 border-t border-border text-[11px] text-muted">
                    More options in Command Palette → "Config: Edit settings.json"
                </div>
            </div>
        </div>
    );
};

SettingsModal.displayName = "SettingsModal";

export { SettingsModal };
