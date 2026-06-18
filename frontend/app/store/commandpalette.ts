// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type CommandPaletteCommand = { id: string; label: string; binding: string; run: () => void };

type MenuCommandBuildOpts = {
    prefix?: string;
};

function slugifyCommandSegment(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function makeCommandId(sourceId: string, path: string[], seen: Map<string, number>): string {
    const basePath = path
        .map((segment) => slugifyCommandSegment(segment))
        .filter(Boolean)
        .join("/");
    const baseId = `${sourceId}:${basePath || "command"}`;
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);
    if (count === 0) {
        return baseId;
    }
    return `${baseId}-${count + 1}`;
}

function menuItemIsVisible(item: ContextMenuItem): boolean {
    return item.visible !== false && item.enabled !== false && item.type !== "separator" && item.type !== "header";
}

export function menuItemsToCommandPaletteCommands(
    sourceId: string,
    items: ContextMenuItem[],
    opts: MenuCommandBuildOpts = {}
): CommandPaletteCommand[] {
    const commands: CommandPaletteCommand[] = [];
    const seenIds = new Map<string, number>();
    const rootPath = opts.prefix ? [opts.prefix] : [];

    function visit(menuItems: ContextMenuItem[], parentPath: string[]) {
        for (const item of menuItems) {
            if (!menuItemIsVisible(item) || item.label == null || item.label.trim() === "") {
                continue;
            }
            const path = [...parentPath, item.label];
            if (item.submenu?.length) {
                visit(item.submenu, path);
            }
            if (item.click == null) {
                continue;
            }
            commands.push({
                id: makeCommandId(sourceId, path, seenIds),
                label: path.join(": "),
                binding: "",
                run: item.click,
            });
        }
    }

    visit(items, rootPath);
    return commands;
}
