// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure helpers for the keybindings editor: turning the rebindable action list +
// the user's "app:keybindings" overrides into displayable entries, and computing
// the next overrides object when an action is rebound / disabled / reset. Kept
// free of React and globalStore so it stays unit-testable; the wiring lives in
// keymodel.ts and the editor modal.

export type KeybindingActionDef = {
    id: string;
    label: string;
    defaultBindings: string[];
};

export type KeybindingOverrides = Record<string, string | string[] | false | null>;

export type KeybindingEntry = {
    id: string;
    label: string;
    defaultBindings: string[];
    bindings: string[]; // effective bindings (override when present, else default)
    isOverridden: boolean;
    isDisabled: boolean; // overridden to "no binding"
};

export type KeybindingChange = { kind: "set"; binding: string } | { kind: "disable" } | { kind: "reset" };

export function toBindingArray(binding: string | string[]): string[] {
    if (Array.isArray(binding)) {
        return binding.filter((b) => typeof b === "string" && b !== "");
    }
    return binding ? [binding] : [];
}

// Mirrors resolveBindings() in keymodel.ts so the editor previews exactly what
// the key handler will apply. override value: missing => defaults; null/false/""
// => disabled; string => single; string[] => list.
export function resolveEffectiveBindings(
    id: string,
    defaultBindings: string[],
    overrides: KeybindingOverrides
): string[] {
    if (overrides == null || !(id in overrides)) {
        return defaultBindings;
    }
    const ov = overrides[id];
    if (ov == null || ov === false || ov === "") {
        return [];
    }
    if (typeof ov === "string") {
        return [ov];
    }
    if (Array.isArray(ov)) {
        return ov.filter((x) => typeof x === "string" && x !== "");
    }
    return defaultBindings;
}

export function buildKeybindingEntries(defs: KeybindingActionDef[], overrides: KeybindingOverrides): KeybindingEntry[] {
    return defs.map((def) => {
        const isOverridden = overrides != null && def.id in overrides;
        const bindings = resolveEffectiveBindings(def.id, def.defaultBindings, overrides);
        return {
            id: def.id,
            label: def.label,
            defaultBindings: def.defaultBindings,
            bindings,
            isOverridden,
            isDisabled: isOverridden && bindings.length === 0,
        };
    });
}

// Returns a NEW overrides object with the change applied. "reset" drops the
// override (restoring the action's default); "disable" stores false; "set"
// stores the single captured binding - but if that equals a single-default
// action's default, it resets instead so the overrides object stays minimal.
export function applyKeybindingChange(
    overrides: KeybindingOverrides,
    def: KeybindingActionDef,
    change: KeybindingChange
): KeybindingOverrides {
    const next: KeybindingOverrides = { ...(overrides ?? {}) };
    if (change.kind === "reset") {
        delete next[def.id];
        return next;
    }
    if (change.kind === "disable") {
        next[def.id] = false;
        return next;
    }
    if (def.defaultBindings.length === 1 && def.defaultBindings[0] === change.binding) {
        delete next[def.id];
        return next;
    }
    next[def.id] = change.binding;
    return next;
}

const MOD_SYMBOLS: Record<string, string> = {
    Cmd: "⌘",
    Meta: "⌘",
    Ctrl: "⌃",
    Control: "⌃",
    Alt: "⌥",
    Option: "⌥",
    Shift: "⇧",
};

const KEY_SYMBOLS: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Escape: "⎋",
    Enter: "⏎",
    Space: "␣",
    Backspace: "⌫",
    Delete: "⌦",
    Tab: "⇥",
};

// "Cmd:Shift:k" -> ["⌘", "⇧", "K"] for rendering as separate kbd chips.
export function formatBindingTokens(binding: string): string[] {
    if (!binding) {
        return [];
    }
    return binding.split(":").map((tok) => {
        if (tok in MOD_SYMBOLS) {
            return MOD_SYMBOLS[tok];
        }
        if (tok in KEY_SYMBOLS) {
            return KEY_SYMBOLS[tok];
        }
        if (tok.length === 1) {
            return tok.toUpperCase();
        }
        return tok;
    });
}

export function formatBinding(binding: string): string {
    return formatBindingTokens(binding).join(" ");
}

// A captured key is bindable only once a non-modifier key is pressed; pure
// modifier presses (just Shift, Cmd, ...) and unresolved codes aren't bindings.
export function isBindableKeyDesc(keyDesc: string): boolean {
    if (!keyDesc) {
        return false;
    }
    const tokens = keyDesc.split(":");
    const last = tokens[tokens.length - 1];
    return last !== "" && !(last in MOD_SYMBOLS) && !last.startsWith("c{");
}

// Maps each shared binding to the action ids that use it; only bindings used by
// more than one action are returned (i.e. conflicts worth warning about).
export function getBindingConflicts(entries: KeybindingEntry[]): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const entry of entries) {
        for (const binding of entry.bindings) {
            (map[binding] ??= []).push(entry.id);
        }
    }
    for (const binding of Object.keys(map)) {
        if (map[binding].length < 2) {
            delete map[binding];
        }
    }
    return map;
}
