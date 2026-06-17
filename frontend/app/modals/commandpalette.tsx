// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { type CommandPaletteCommand, getCommandPaletteCommands } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

function formatBinding(binding: string): string {
    if (!binding) {
        return "";
    }
    return binding
        .replace(/Cmd/g, "⌘")
        .replace(/Meta/g, "⌘")
        .replace(/Shift/g, "⇧")
        .replace(/Ctrl/g, "⌃")
        .replace(/Alt/g, "⌥")
        .replace(/Arrow/g, "")
        .replace(/:/g, "");
}

function fuzzyMatch(query: string, label: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) {
        return true;
    }
    return label.toLowerCase().includes(q);
}

const CommandPalette = () => {
    const allCommands = useMemo(() => getCommandPaletteCommands(), []);
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const filtered = useMemo(() => allCommands.filter((c) => fuzzyMatch(query, c.label)), [query, allCommands]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);
    useEffect(() => {
        setSelected(0);
    }, [query]);
    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [selected]);

    const close = () => modalsModel.popModal();

    const runCommand = (cmd: CommandPaletteCommand) => {
        close();
        // defer so the palette unmounts before the action runs (focus/state settle)
        setTimeout(() => cmd.run(), 0);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected((s) => Math.min(s + 1, filtered.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((s) => Math.max(s - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[selected]) {
                runCommand(filtered[selected]);
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[500] flex items-start justify-center"
            onMouseDown={close}
            role="dialog"
            aria-label="Command palette"
        >
            <div className="absolute inset-0 bg-black/45" />
            <div
                className="relative mt-[12vh] w-[540px] max-w-[90vw] bg-modalbg border border-border rounded-[12px] overflow-hidden shadow-[0px_12px_40px_0px_rgba(0,0,0,0.4)]"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Run a command…"
                    className="w-full bg-transparent border-0 border-b border-border outline-none px-4 py-3 text-foreground text-[14px]"
                    aria-label="Command"
                />
                <div ref={listRef} className="max-h-[360px] overflow-auto py-1">
                    {filtered.length === 0 ? (
                        <div className="px-4 py-3 text-muted text-[13px]">No matching commands</div>
                    ) : (
                        filtered.map((cmd, idx) => (
                            <div
                                key={cmd.id}
                                data-idx={idx}
                                onMouseEnter={() => setSelected(idx)}
                                onClick={() => runCommand(cmd)}
                                className={clsx(
                                    "flex items-center justify-between px-4 py-2 cursor-pointer",
                                    idx === selected ? "bg-accent text-primary" : "text-secondary"
                                )}
                            >
                                <span className="text-[13px]">{cmd.label}</span>
                                {cmd.binding && (
                                    <span className="font-mono text-[11px] opacity-70">{formatBinding(cmd.binding)}</span>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

CommandPalette.displayName = "CommandPalette";

export { CommandPalette };
