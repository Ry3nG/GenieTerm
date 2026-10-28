// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import type { CommandPaletteCommand } from "./commandpalette";
import {
    buildPaletteSections,
    formatPaletteBinding,
    getPaletteGroup,
    indexPaletteCommands,
    normalizePaletteRecents,
    rememberPaletteCommand,
    scorePaletteText,
    searchPaletteCommands,
} from "./commandpalette-search";

function command(id: string, label = id): CommandPaletteCommand {
    return { id, label, binding: "", run: vi.fn() };
}

describe("palette search", () => {
    it("ranks prefix above word-start, substring and subsequence, with exact highlight positions", () => {
        const matches = ["copy last", "last copy", "photocopy", "cop yank"].map((label) =>
            scorePaletteText(label, "copy")
        );
        expect(matches.map((match) => match.score)).toEqual([400, 300, 200, 100]);
        expect(matches.map((match) => match.positions)).toEqual([
            [0, 1, 2, 3],
            [5, 6, 7, 8],
            [5, 6, 7, 8],
            [0, 1, 2, 4],
        ]);
        expect(scorePaletteText("command output history", "copy")).toBeNull();
        expect(scorePaletteText("copy", "xyz")).toBeNull();
        expect(scorePaletteText("copy", "")).toEqual({ score: 0, positions: [] });
    });

    it("matches word initials but rejects letters scattered across a long label", () => {
        expect(scorePaletteText("split block right", "sbr")).toEqual({ score: 100, positions: [0, 6, 12] });
        expect(scorePaletteText("toggle tab bar", "ttb")).toEqual({ score: 100, positions: [0, 7, 11] });
        expect(scorePaletteText("show previous connection history", "ssh")).toBeNull();
    });

    it("finds a later word-start even when an earlier substring exists", () => {
        expect(scorePaletteText("photocopy copy", "copy")).toEqual({ score: 300, positions: [10, 11, 12, 13] });
    });

    it("boosts recents without allowing them to outrank a stronger match class", () => {
        const commands = indexPaletteCommands([
            command("a", "Copy A"),
            command("b", "Copy B"),
            command("c", "Last Copy"),
            command("d", "Photocopy"),
        ]);
        expect(
            searchPaletteCommands(commands, " COPY ", ["c", "d", "b"]).map((match) => match.item.command.id)
        ).toEqual(["b", "a", "c", "d"]);
    });

    it("matches group names, aliases, hints and host names, with every query word required", () => {
        const commands = indexPaletteCommands([
            command("block:split-right", "Split Block Right"),
            command("block:split-down", "Split Block Down"),
            { ...command("conn:connect:host", "Connect to Staging"), keywords: "user@host", hint: "New terminal" },
            command("term:clear", "Clear Terminal"),
            command("tab:close", "Close Tab"),
            command("term:copy-last-output", "Copy Last Command Output"),
        ]);
        for (const query of ["ssh", "remote", "connections", "user@host", "new terminal", "remote staging"]) {
            expect(searchPaletteCommands(commands, query, [])[0].item.command.id).toBe("conn:connect:host");
        }
        expect(searchPaletteCommands(commands, "split", []).map((match) => match.item.command.id)).toEqual([
            "block:split-down",
            "block:split-right",
        ]);
        expect(searchPaletteCommands(commands, "cls", [])[0].item.command.id).toBe("term:clear");
        expect(searchPaletteCommands(commands, "dismiss", [])[0].item.command.id).toBe("tab:close");
        expect(searchPaletteCommands(commands, "clipboard", [])[0].item.command.id).toBe("term:copy-last-output");
        expect(searchPaletteCommands(commands, "split nonexistent", [])).toEqual([]);
    });

    it("highlights label characters only, including disjoint fuzzy matches", () => {
        const commands = indexPaletteCommands([command("term:copy-last-output", "Copy Last Command Output")]);
        const [match] = searchPaletteCommands(commands, "clo", []);
        expect(match.positions.map((position) => match.item.command.label[position]).join("")).toBe("CLO");
        expect(searchPaletteCommands(commands, "clipboard", [])[0].positions).toEqual([]);
    });

    it("keeps input arrays unchanged and ranks hundreds of commands deterministically", () => {
        const commands = indexPaletteCommands(
            Array.from({ length: 600 }, (_, idx) => command(`conn:${idx}`, `Connect to host-${idx}`))
        );
        const original = commands.slice();
        const results = searchPaletteCommands(commands, "host-42", ["conn:42"]);
        expect(results[0].item.command.id).toBe("conn:42");
        expect(commands).toEqual(original);
    });
});

describe("palette groups and recents", () => {
    it("uses explicit prefixes and action exceptions, with an Other fallback", () => {
        expect(
            [
                "term:clear",
                "tab:new",
                "block:close",
                "conn:switch",
                "view:sidebar",
                "app:settings",
                "unknown:thing",
            ].map(getPaletteGroup)
        ).toEqual(["Terminal", "Tabs", "Blocks & Layout", "Connections", "View", "App", "Other"]);
        expect(getPaletteGroup("tab:reload")).toBe("App");
        expect(getPaletteGroup("block:search")).toBe("Terminal");
        expect(getPaletteGroup("config:edit-connections")).toBe("Connections");
    });

    it("orders sections, omits empty sections and stale recents, and never duplicates rows", () => {
        const commands = indexPaletteCommands(
            [
                "other:x",
                "app:settings",
                "view:sidebar",
                "conn:switch",
                "block:close",
                "tab:new",
                "term:clear",
                "term:copy-last-command",
            ].map((id) => command(id))
        );
        const sections = buildPaletteSections(commands, " ", ["missing", "tab:new", "tab:new"]);
        expect(sections.map((section) => section.title)).toEqual([
            "Recent",
            "Terminal",
            "Blocks & Layout",
            "Connections",
            "View",
            "App",
            "Other",
        ]);
        expect(sections[0].matches.map((match) => match.item.command.id)).toEqual(["tab:new"]);
        expect(sections.flatMap((section) => section.matches)).toHaveLength(commands.length);
        expect(buildPaletteSections(commands, "clear", ["tab:new"]).map((section) => section.title)).toEqual([
            "Results",
        ]);
        expect(buildPaletteSections(commands, "doesnotexist", [])[0].matches).toEqual([]);
        expect(buildPaletteSections([], "", [])).toEqual([]);
    });

    it("deduplicates and caps history, moving the last action to the front", () => {
        const recents = rememberPaletteCommand("c", ["a", "b", "c", "d", "e", "f"]);
        expect(recents).toEqual(["c", "a", "b", "d", "e"]);
        expect(normalizePaletteRecents([null, 1, "", "a", "a", "b"])).toEqual(["a", "b"]);
        expect(normalizePaletteRecents({})).toEqual([]);
    });

    it("preserves shortcut formatting while separating keycaps", () => {
        expect(formatPaletteBinding("Cmd:Shift:ArrowUp")).toEqual(["⇧", "⌘", "↑"]);
        expect(formatPaletteBinding("Meta:Alt:Ctrl:k")).toEqual(["⌃", "⌥", "⌘", "K"]);
        expect(formatPaletteBinding("Cmd:]")).toEqual(["⌘", "]"]);
        expect(formatPaletteBinding("")).toEqual([]);
    });
});
