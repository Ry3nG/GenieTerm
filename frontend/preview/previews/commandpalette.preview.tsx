// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CommandPaletteView } from "@/app/modals/commandpalette";
import type { CommandPaletteCommand } from "@/app/store/commandpalette";
import { normalizePaletteRecents } from "@/app/store/commandpalette-search";
import { useMemo, useState } from "react";

const SampleCommands = [
    ["term:copy-last-command", "Copy Last Command", ""],
    ["term:copy-last-output", "Copy Last Command Output", ""],
    ["term:jump-prev-block", "Jump to Previous Command", "Cmd:Shift:ArrowUp"],
    ["term:jump-next-block", "Jump to Next Command", "Cmd:Shift:ArrowDown"],
    ["term:jump-past-output", "Jump Past Command Output", "Cmd:Shift:ArrowRight"],
    ["term:command-composer", "Command Composer", "Ctrl:Shift:a"],
    ["block:search", "Find in Block", "Cmd:f"],
    ["term:clear", "Clear Terminal", "Cmd:k"],
    ["tab:new", "New Tab", "Cmd:t"],
    ["tab:next", "Next Tab", "Cmd:]"],
    ["tab:close", "Close Tab", "Cmd:Shift:w"],
    ["block:split-right", "Split Block Right", "Cmd:d"],
    ["block:split-down", "Split Block Down", "Shift:Cmd:d"],
    ["block:close", "Close Block", "Cmd:w"],
    ["conn:switch", "Switch Connection", "Cmd:g"],
    ["conn:connect:staging", "Connect to staging", "", "New terminal"],
    ["conn:connect:production", "Connect to production", "", "New terminal"],
    ["view:toggle-sidebar", "Toggle Sidebar", "Cmd:b"],
    ["view:toggle-tabbar", "Toggle Tab Bar", "Cmd:Shift:b"],
    ["app:settings", "Settings", ""],
    ["tab:reload", "Reload Tab", "Shift:Cmd:r"],
];

export function CommandPalettePreview() {
    const [open, setOpen] = useState(true);
    const [lastRun, setLastRun] = useState("No command run yet");
    const [recents, setRecents] = useState(["block:split-right", "conn:connect:staging", "tab:new"]);
    const commands = useMemo(
        () =>
            SampleCommands.map(
                ([id, label, binding, hint]): CommandPaletteCommand => ({
                    id,
                    label,
                    binding,
                    hint,
                    run: () => setLastRun(label),
                })
            ),
        []
    );

    return (
        <div className="flex w-full max-w-[960px] flex-col gap-4 p-8">
            <span className="text-sm text-secondary">Command palette</span>
            <button
                className="self-start rounded bg-accent/80 px-4 py-2 text-primary transition-colors hover:bg-accent cursor-pointer"
                onClick={() => setOpen(true)}
            >
                Open command palette
            </button>
            <output className="text-sm text-muted">{lastRun}</output>
            {open && (
                <CommandPaletteView
                    commands={commands}
                    recents={recents}
                    onRemember={(id) => setRecents((previous) => normalizePaletteRecents([id, ...previous]))}
                    onClose={() => setOpen(false)}
                />
            )}
        </div>
    );
}
