import { describe, expect, it, vi } from "vitest";

import { menuItemsToCommandPaletteCommands } from "./commandpalette";

describe("menuItemsToCommandPaletteCommands", () => {
    it("flattens clickable nested menu items into command palette commands", () => {
        const runDefault = vi.fn();
        const runBar = vi.fn();
        const commands = menuItemsToCommandPaletteCommands("block:term-1", [
            { label: "Paste", click: vi.fn() },
            { type: "separator" },
            {
                label: "Cursor",
                submenu: [
                    { label: "Default", click: runDefault },
                    { label: "Bar", type: "checkbox", checked: true, click: runBar },
                    { label: "Unavailable", enabled: false, click: vi.fn() },
                ],
            },
            { label: "Advanced", submenu: [{ label: "Force Restart Controller", click: vi.fn() }] },
            { label: "Header Only", type: "header" },
        ]);

        expect(commands.map((cmd) => cmd.label)).toEqual([
            "Paste",
            "Cursor: Default",
            "Cursor: Bar",
            "Advanced: Force Restart Controller",
        ]);
        expect(commands.map((cmd) => cmd.id)).toEqual([
            "block:term-1:paste",
            "block:term-1:cursor/default",
            "block:term-1:cursor/bar",
            "block:term-1:advanced/force-restart-controller",
        ]);

        commands[1].run();
        expect(runDefault).toHaveBeenCalledTimes(1);
    });

    it("keeps duplicate labels addressable with stable suffixes", () => {
        const commands = menuItemsToCommandPaletteCommands("tab:abc", [
            { label: "Default", click: vi.fn() },
            { label: "Backgrounds", submenu: [{ label: "Default", click: vi.fn() }] },
            { label: "Default", click: vi.fn() },
        ]);

        expect(commands.map((cmd) => cmd.id)).toEqual([
            "tab:abc:default",
            "tab:abc:backgrounds/default",
            "tab:abc:default-2",
        ]);
    });
});
