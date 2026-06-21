// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getSettingsKeyAtom } from "@/app/store/global";
import {
    applyKeybindingChange,
    buildKeybindingEntries,
    formatBindingTokens,
    getBindingConflicts,
    isBindableKeyDesc,
    type KeybindingActionDef,
    type KeybindingChange,
    type KeybindingEntry,
    type KeybindingOverrides,
} from "@/app/store/keybindings";
import { getRebindableKeybindings, writeKeybindingOverrides } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import * as keyutil from "@/util/keyutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";

const BindingChips = ({ tokens }: { tokens: string[] }) => {
    if (tokens.length === 0) {
        return <span className="text-muted text-[12px] italic">unset</span>;
    }
    return (
        <span className="flex items-center gap-1">
            {tokens.map((tok, i) => (
                <kbd
                    key={i}
                    className="min-w-[20px] text-center px-1.5 py-0.5 rounded bg-white/10 border border-border font-mono text-[11px] text-foreground"
                >
                    {tok}
                </kbd>
            ))}
        </span>
    );
};

const KeybindingRow = ({
    entry,
    isRecording,
    isConflict,
    onRecord,
    onReset,
    onDisable,
}: {
    entry: KeybindingEntry;
    isRecording: boolean;
    isConflict: boolean;
    onRecord: () => void;
    onReset: () => void;
    onDisable: () => void;
}) => {
    return (
        <div className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-white/5">
            <div className="min-w-0">
                <div className="text-[13px] text-foreground truncate">{entry.label}</div>
                <div className="text-[11px] text-muted font-mono truncate">{entry.id}</div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
                {isRecording ? (
                    <span className="text-[12px] text-accent animate-pulse">Press keys… (Esc to cancel)</span>
                ) : (
                    <span className="flex items-center gap-2">
                        {entry.isDisabled ? (
                            <span className="text-muted text-[12px] italic">disabled</span>
                        ) : (
                            entry.bindings.map((b, i) => <BindingChips key={i} tokens={formatBindingTokens(b)} />)
                        )}
                        {isConflict && (
                            <i
                                className="fa-solid fa-triangle-exclamation text-[11px] text-[#FF9500]"
                                title="This shortcut is used by more than one action"
                                aria-label="Conflicting shortcut"
                            />
                        )}
                    </span>
                )}
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className="px-2 py-1 rounded text-[11px] bg-white/8 hover:bg-white/15 text-secondary cursor-pointer"
                        onClick={onRecord}
                        title="Record a new shortcut"
                    >
                        {isRecording ? "Recording…" : "Change"}
                    </button>
                    <button
                        type="button"
                        className={cn(
                            "px-2 py-1 rounded text-[11px] cursor-pointer",
                            entry.isOverridden ? "bg-white/8 hover:bg-white/15 text-secondary" : "opacity-30"
                        )}
                        onClick={onReset}
                        disabled={!entry.isOverridden}
                        title="Reset to default"
                    >
                        Reset
                    </button>
                    <button
                        type="button"
                        className={cn(
                            "px-2 py-1 rounded text-[11px] cursor-pointer",
                            entry.isDisabled ? "opacity-30" : "bg-white/8 hover:bg-white/15 text-secondary"
                        )}
                        onClick={onDisable}
                        disabled={entry.isDisabled}
                        title="Remove shortcut"
                    >
                        Disable
                    </button>
                </div>
            </div>
        </div>
    );
};

const KeybindingsModal = () => {
    const overrides = (useAtomValue(getSettingsKeyAtom("app:keybindings")) as KeybindingOverrides) ?? {};
    const defs = useMemo<KeybindingActionDef[]>(() => getRebindableKeybindings(), []);
    const [query, setQuery] = useState("");
    const [recordingId, setRecordingId] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const entries = useMemo(() => buildKeybindingEntries(defs, overrides), [defs, overrides]);
    const conflicts = useMemo(() => getBindingConflicts(entries), [entries]);
    const conflictIds = useMemo(() => new Set(Object.values(conflicts).flat()), [conflicts]);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return entries;
        }
        return entries.filter((e) => e.label.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
    }, [entries, query]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const close = () => modalsModel.popModal();

    // While recording, capture the next real keystroke on the capture phase so it
    // preempts the app's global key handler, turn it into a binding, and save.
    useEffect(() => {
        if (recordingId == null) {
            return;
        }
        const def = defs.find((d) => d.id === recordingId);
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (e.key === "Escape") {
                setRecordingId(null);
                return;
            }
            const desc = keyutil.waveEventToKeyDesc(keyutil.adaptFromReactOrNativeKeyEvent(e));
            if (!isBindableKeyDesc(desc)) {
                return; // pure modifier press - keep listening
            }
            if (def != null) {
                writeKeybindingOverrides(applyKeybindingChange(overrides, def, { kind: "set", binding: desc }));
            }
            setRecordingId(null);
        };
        window.addEventListener("keydown", onKey, { capture: true });
        return () => window.removeEventListener("keydown", onKey, { capture: true });
    }, [recordingId, defs, overrides]);

    const onSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Escape" && recordingId == null) {
            e.preventDefault();
            close();
        }
    };

    const change = (def: KeybindingActionDef, kind: "disable" | "reset") => {
        const ch: KeybindingChange = kind === "disable" ? { kind: "disable" } : { kind: "reset" };
        writeKeybindingOverrides(applyKeybindingChange(overrides, def, ch));
    };

    return (
        <div
            className="fixed inset-0 z-[500] flex items-start justify-center"
            onMouseDown={close}
            role="dialog"
            aria-label="Keyboard shortcuts"
        >
            <div className="absolute inset-0 bg-black/45" />
            <div
                className="relative mt-[10vh] w-[640px] max-w-[92vw] bg-modalbg border border-border rounded-[12px] overflow-hidden shadow-[0px_12px_40px_0px_rgba(0,0,0,0.4)]"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-[14px] text-foreground font-medium">Keyboard Shortcuts</span>
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
                    placeholder="Search shortcuts…"
                    className="w-full bg-transparent border-0 border-b border-border outline-none px-4 py-2.5 text-foreground text-[13px]"
                    aria-label="Search shortcuts"
                />
                <div className="max-h-[420px] overflow-auto py-1">
                    {filtered.length === 0 ? (
                        <div className="px-4 py-3 text-muted text-[13px]">No matching shortcuts</div>
                    ) : (
                        filtered.map((entry) => (
                            <KeybindingRow
                                key={entry.id}
                                entry={entry}
                                isRecording={recordingId === entry.id}
                                isConflict={conflictIds.has(entry.id)}
                                onRecord={() => setRecordingId((cur) => (cur === entry.id ? null : entry.id))}
                                onReset={() => change(defs.find((d) => d.id === entry.id)!, "reset")}
                                onDisable={() => change(defs.find((d) => d.id === entry.id)!, "disable")}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

KeybindingsModal.displayName = "KeybindingsModal";

export { KeybindingsModal };
