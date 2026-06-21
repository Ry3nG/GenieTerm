// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    applyKeybindingChange,
    buildKeybindingEntries,
    formatBindingTokens,
    getBindingConflicts,
    isBindableKeyDesc,
    resolveEffectiveBindings,
    type KeybindingActionDef,
} from "./keybindings";

const DEFS: KeybindingActionDef[] = [
    { id: "tab:new", label: "New Tab", defaultBindings: ["Cmd:t"] },
    { id: "block:nav-up", label: "Focus Block Above", defaultBindings: ["Ctrl:Shift:ArrowUp", "Ctrl:Shift:k"] },
];

describe("resolveEffectiveBindings", () => {
    it("returns defaults when there is no override", () => {
        expect(resolveEffectiveBindings("tab:new", ["Cmd:t"], {})).toEqual(["Cmd:t"]);
    });

    it("applies a single-string override", () => {
        expect(resolveEffectiveBindings("tab:new", ["Cmd:t"], { "tab:new": "Cmd:Shift:t" })).toEqual(["Cmd:Shift:t"]);
    });

    it("treats null/false/empty override as disabled", () => {
        expect(resolveEffectiveBindings("tab:new", ["Cmd:t"], { "tab:new": false })).toEqual([]);
        expect(resolveEffectiveBindings("tab:new", ["Cmd:t"], { "tab:new": null })).toEqual([]);
        expect(resolveEffectiveBindings("tab:new", ["Cmd:t"], { "tab:new": "" })).toEqual([]);
    });

    it("filters empty entries from array overrides", () => {
        expect(resolveEffectiveBindings("tab:new", ["Cmd:t"], { "tab:new": ["Cmd:t", "", "Cmd:n"] })).toEqual([
            "Cmd:t",
            "Cmd:n",
        ]);
    });
});

describe("buildKeybindingEntries", () => {
    it("marks overridden and disabled state", () => {
        const entries = buildKeybindingEntries(DEFS, { "tab:new": false });
        const tabNew = entries.find((e) => e.id === "tab:new");
        const navUp = entries.find((e) => e.id === "block:nav-up");
        expect(tabNew).toMatchObject({ isOverridden: true, isDisabled: true, bindings: [] });
        expect(navUp).toMatchObject({ isOverridden: false, isDisabled: false });
        expect(navUp?.bindings).toEqual(["Ctrl:Shift:ArrowUp", "Ctrl:Shift:k"]);
    });
});

describe("applyKeybindingChange", () => {
    const def = DEFS[0];

    it("sets a new binding", () => {
        expect(applyKeybindingChange({}, def, { kind: "set", binding: "Cmd:Shift:t" })).toEqual({
            "tab:new": "Cmd:Shift:t",
        });
    });

    it("disables via false", () => {
        expect(applyKeybindingChange({}, def, { kind: "disable" })).toEqual({ "tab:new": false });
    });

    it("reset removes the override key", () => {
        expect(applyKeybindingChange({ "tab:new": "Cmd:Shift:t", "x:y": "Cmd:y" }, def, { kind: "reset" })).toEqual({
            "x:y": "Cmd:y",
        });
    });

    it("setting back to the single default collapses to a reset", () => {
        expect(applyKeybindingChange({ "tab:new": "Cmd:Shift:t" }, def, { kind: "set", binding: "Cmd:t" })).toEqual({});
    });

    it("does not mutate the input overrides", () => {
        const overrides = { "tab:new": "Cmd:Shift:t" };
        applyKeybindingChange(overrides, def, { kind: "reset" });
        expect(overrides).toEqual({ "tab:new": "Cmd:Shift:t" });
    });
});

describe("formatBindingTokens", () => {
    it("maps modifiers and keys to symbols, uppercasing letters", () => {
        expect(formatBindingTokens("Cmd:Shift:k")).toEqual(["⌘", "⇧", "K"]);
        expect(formatBindingTokens("Ctrl:Shift:ArrowUp")).toEqual(["⌃", "⇧", "↑"]);
        expect(formatBindingTokens("")).toEqual([]);
    });
});

describe("isBindableKeyDesc", () => {
    it("rejects pure modifier presses and accepts real keys", () => {
        expect(isBindableKeyDesc("Cmd:Shift")).toBe(false);
        expect(isBindableKeyDesc("Shift")).toBe(false);
        expect(isBindableKeyDesc("Cmd:c{KeyA}")).toBe(false);
        expect(isBindableKeyDesc("Cmd:Shift:k")).toBe(true);
        expect(isBindableKeyDesc("F2")).toBe(true);
    });
});

describe("getBindingConflicts", () => {
    it("returns only bindings shared by more than one action", () => {
        const entries = buildKeybindingEntries(
            [
                { id: "a", label: "A", defaultBindings: ["Cmd:k"] },
                { id: "b", label: "B", defaultBindings: ["Cmd:k"] },
                { id: "c", label: "C", defaultBindings: ["Cmd:j"] },
            ],
            {}
        );
        expect(getBindingConflicts(entries)).toEqual({ "Cmd:k": ["a", "b"] });
    });
});
