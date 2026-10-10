// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CommandPaletteCommand } from "@/app/store/commandpalette";
import {
    buildPaletteSections,
    formatPaletteBinding,
    indexPaletteCommands,
    readPaletteRecents,
    rememberPaletteCommand,
} from "@/app/store/commandpalette-search";
import { atoms, createBlock } from "@/app/store/global";
import { getCommandPaletteCommands } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { cn, fireAndForget, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useId, useMemo, useRef, useState } from "react";

type CommandPaletteViewProps = {
    commands: CommandPaletteCommand[];
    recents: string[];
    onRemember: (id: string) => void;
    onClose: () => void;
};

function HighlightedLabel({ label, positions }: { label: string; positions: number[] }) {
    const segments: React.ReactNode[] = [];
    let cursor = 0;
    for (let idx = 0; idx < positions.length; idx++) {
        const start = positions[idx];
        let end = start + 1;
        while (positions[idx + 1] === end) {
            idx++;
            end++;
        }
        segments.push(label.slice(cursor, start));
        segments.push(
            <span key={start} className="font-medium text-primary">
                {label.slice(start, end)}
            </span>
        );
        cursor = end;
    }
    segments.push(label.slice(cursor));
    return <>{segments}</>;
}

export function CommandPaletteView({ commands, recents, onRemember, onClose }: CommandPaletteViewProps) {
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const closedRef = useRef(false);
    const listId = useId();
    const indexed = useMemo(() => indexPaletteCommands(commands), [commands]);
    const sections = useMemo(() => buildPaletteSections(indexed, query, recents), [indexed, query, recents]);
    const rows = useMemo(() => sections.flatMap((section) => section.matches), [sections]);
    const rowIndices = useMemo(() => new Map(rows.map((row, idx) => [row.item.command.id, idx])), [rows]);
    const activeIndex = Math.min(selected, Math.max(0, rows.length - 1));

    useEffect(() => {
        const previousFocus = document.activeElement as HTMLElement;
        inputRef.current?.focus();
        return () => {
            if (previousFocus?.isConnected) {
                previousFocus.focus();
            }
        };
    }, []);
    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, rows]);

    const close = () => {
        if (closedRef.current) {
            return;
        }
        closedRef.current = true;
        onClose();
    };

    const runCommand = (cmd: CommandPaletteCommand) => {
        if (closedRef.current) {
            return;
        }
        onRemember(cmd.id);
        close();
        // defer so the palette unmounts before the action runs (focus/state settle)
        setTimeout(() => cmd.run(), 0);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || closedRef.current) {
            return;
        }
        const ctrlNavigation = e.ctrlKey && !e.altKey && !e.metaKey;
        if (e.key === "ArrowDown" || (ctrlNavigation && e.key.toLowerCase() === "n")) {
            e.preventDefault();
            setSelected(rows.length ? (activeIndex + 1) % rows.length : 0);
            return;
        }
        if (e.key === "ArrowUp" || (ctrlNavigation && e.key.toLowerCase() === "p")) {
            e.preventDefault();
            setSelected(rows.length ? (activeIndex - 1 + rows.length) % rows.length : 0);
            return;
        }
        if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            setSelected(e.key === "Home" ? 0 : Math.max(0, rows.length - 1));
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (rows[activeIndex]) {
                runCommand(rows[activeIndex].item.command);
            }
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            close();
            return;
        }
        if (e.key === "Tab") {
            e.preventDefault();
            inputRef.current?.focus();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[500] flex items-center justify-center p-4"
            onMouseDown={close}
            onKeyDown={onKeyDown}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
        >
            <div className="absolute inset-0 bg-black/45 backdrop-blur-[4px]" />
            <div
                className="relative flex max-h-[calc(100dvh-32px)] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-modalbg shadow-[0_16px_64px_rgba(0,0,0,0.45)] motion-safe:animate-palette-in"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-4">
                    <i aria-hidden="true" className={cn(makeIconClass("magnifying-glass", false), "text-muted")} />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelected(0);
                        }}
                        placeholder="Search commands…"
                        className="min-w-0 flex-1 border-0 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
                        role="combobox"
                        aria-label="Search commands"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-activedescendant={rows.length ? `${listId}-${activeIndex}` : undefined}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <kbd
                        aria-hidden="true"
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted"
                    >
                        esc
                    </kbd>
                </div>
                <div
                    ref={listRef}
                    id={listId}
                    role="listbox"
                    aria-label="Commands"
                    className="min-h-0 max-h-[400px] overflow-y-auto overscroll-contain p-2"
                >
                    {sections.map((section) => (
                        <div key={section.title} role="group" aria-label={section.title}>
                            {section.matches.length > 0 && (
                                <div
                                    className="flex h-8 items-center px-2 text-[11px] font-medium tracking-wide text-muted"
                                    aria-hidden="true"
                                >
                                    {section.title}
                                </div>
                            )}
                            {section.matches.map(({ item, positions }) => {
                                const cmd = item.command;
                                const idx = rowIndices.get(cmd.id);
                                return (
                                    <div
                                        key={cmd.id}
                                        id={`${listId}-${idx}`}
                                        data-idx={idx}
                                        role="option"
                                        aria-selected={idx === activeIndex}
                                        onMouseMove={() => setSelected(idx)}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => runCommand(cmd)}
                                        className={cn(
                                            "flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-secondary",
                                            idx === activeIndex && "bg-accent/15 ring-1 ring-inset ring-accent/20"
                                        )}
                                    >
                                        <i
                                            aria-hidden="true"
                                            className={cn(
                                                makeIconClass(item.icon, false),
                                                "w-4 shrink-0 text-center text-xs",
                                                idx === activeIndex ? "text-accent" : "text-muted"
                                            )}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-[13px]" title={cmd.label}>
                                            <HighlightedLabel label={cmd.label} positions={positions} />
                                        </span>
                                        <span className="hidden max-w-[160px] truncate text-[11px] text-muted sm:block">
                                            {cmd.hint ?? (query.trim() ? item.group : "")}
                                        </span>
                                        {cmd.binding && (
                                            <span
                                                className="flex shrink-0 gap-1"
                                                aria-label={cmd.binding.replace(/:/g, " + ")}
                                            >
                                                {formatPaletteBinding(cmd.binding).map((key, keyIdx) => (
                                                    <kbd
                                                        key={keyIdx}
                                                        aria-hidden="true"
                                                        className="min-w-5 rounded border border-border bg-white/[0.03] px-1 text-center font-sans text-[11px] leading-5 text-secondary"
                                                    >
                                                        {key}
                                                    </kbd>
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
                {rows.length === 0 && (
                    <div role="status" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                        <i
                            aria-hidden="true"
                            className={cn(makeIconClass("magnifying-glass", false), "mb-2 text-muted")}
                        />
                        <span className="text-sm text-primary">No matching commands</span>
                        <span className="text-xs text-muted">Try “split”, “copy”, or “ssh”.</span>
                    </div>
                )}
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 text-[11px] text-muted">
                    <span>↑↓ navigate · ↵ run · esc close</span>
                    <span aria-live="polite" aria-atomic="true">
                        {rows.length} commands
                    </span>
                </div>
            </div>
        </div>
    );
}

export function CommandPalette() {
    const baseCommands = useMemo(() => getCommandPaletteCommands(), []);
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [recents] = useState(readPaletteRecents);
    const commands = useMemo(() => {
        const connections = Object.entries(fullConfig?.connections ?? {})
            .filter(([, config]) => config != null && !config["display:hidden"])
            .sort(([a, ac], [b, bc]) => (ac["display:order"] ?? 0) - (bc["display:order"] ?? 0) || a.localeCompare(b))
            .map(
                ([host, config]): CommandPaletteCommand => ({
                    id: `conn:connect:${host}`,
                    label: `Connect to ${config["display:name"]?.trim() || host}`,
                    hint: "New terminal",
                    keywords: host,
                    binding: "",
                    run: () =>
                        fireAndForget(() =>
                            createBlock({ meta: { view: "term", controller: "shell", connection: host } })
                        ),
                })
            );
        return [...baseCommands, ...connections];
    }, [baseCommands, fullConfig?.connections]);

    return (
        <CommandPaletteView
            commands={commands}
            recents={recents}
            onRemember={(id) => rememberPaletteCommand(id, readPaletteRecents())}
            onClose={() => modalsModel.popModal()}
        />
    );
}
