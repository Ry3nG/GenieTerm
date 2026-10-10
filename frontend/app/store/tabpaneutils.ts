// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function tabCacheLimit(size: number, ceiling: number): number {
    return Math.max(1, Math.min(Number.isFinite(size) ? Math.floor(size) : 10, ceiling));
}

export function updateTabLru(previous: string[], active: string, tabs: string[], limit: number): string[] {
    return [...new Set([active, ...previous])].filter((id) => tabs.includes(id)).slice(0, limit);
}

export function tabAfterClose(previous: string[], tabs: string[], active: string): string {
    if (tabs.includes(active)) {
        return active;
    }
    return tabs[Math.max(0, Math.min(previous.indexOf(active) - 1, tabs.length - 1))] ?? "";
}

export function diffTabRoutes(previous: Iterable<string>, tabs: string[]) {
    const oldIds = new Set(previous);
    const newIds = new Set(tabs);
    return {
        added: [...newIds].filter((id) => !oldIds.has(id)),
        removed: [...oldIds].filter((id) => !newIds.has(id)),
    };
}

export function modelsForTab<T extends { tabModel: { tabId: string } }>(models: T[], tabId: string): T[] {
    return models.filter((model) => tabId != null && model.tabModel?.tabId === tabId);
}
