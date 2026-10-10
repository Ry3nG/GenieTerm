// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { diffTabRoutes, modelsForTab, tabAfterClose, tabCacheLimit, updateTabLru } from "./tabpaneutils";

describe("mounted tab retention", () => {
    it("keeps the active pane and evicts the least recently visited pane", () => {
        const tabs = ["a", "b", "c", "d"];
        let lru = updateTabLru([], "a", tabs, 3);
        lru = updateTabLru(lru, "b", tabs, 3);
        lru = updateTabLru(lru, "c", tabs, 3);
        lru = updateTabLru(lru, "a", tabs, 3);
        expect(lru).toEqual(["a", "c", "b"]);
        expect(updateTabLru(lru, "d", tabs, 3)).toEqual(["d", "a", "c"]);
    });

    it("drops closed tabs, handles a workspace replacement, and shrinks the cache", () => {
        expect(updateTabLru(["c", "b", "a"], "a", ["a", "b"], 3)).toEqual(["a", "b"]);
        expect(updateTabLru(["a", "b"], "x", ["x", "y"], 3)).toEqual(["x"]);
        expect(updateTabLru(["a", "b"], "b", ["a", "b"], 1)).toEqual(["b"]);
        expect(updateTabLru(["a"], "", [], 3)).toEqual([]);
    });

    it("clamps invalid, fractional, and excessive settings while retaining an active pane", () => {
        expect(tabCacheLimit(0, 4)).toBe(1);
        expect(tabCacheLimit(-1, 4)).toBe(1);
        expect(tabCacheLimit(100, 8)).toBe(8);
        expect(tabCacheLimit(2.8, 16)).toBe(2);
        expect(tabCacheLimit(NaN, 16)).toBe(10);
    });
});

describe("closed active tab fallback", () => {
    const before = ["a", "b", "c", "d"];
    it("matches the backend's previous-neighbor rule including first and last tabs", () => {
        expect(tabAfterClose(before, ["a", "c", "d"], "b")).toBe("a");
        expect(tabAfterClose(before, ["b", "c", "d"], "a")).toBe("b");
        expect(tabAfterClose(before, ["a", "b", "c"], "d")).toBe("c");
        expect(tabAfterClose(["a"], [], "a")).toBe("");
    });
    it("preserves an optimistic selection when a different tab closes", () => {
        expect(tabAfterClose(before, ["a", "c", "d"], "d")).toBe("d");
    });
});

describe("tab route membership", () => {
    it("diffs additions and deletions without re-registering stable routes", () => {
        expect(diffTabRoutes(["a", "b"], ["b", "c", "c"])).toEqual({ added: ["c"], removed: ["a"] });
        expect(diffTabRoutes(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] });
        expect(diffTabRoutes(["a"], [])).toEqual({ added: [], removed: ["a"] });
    });
});

describe("multi-input ownership", () => {
    it("excludes every other tab and models without a tab even when both tabs are mounted", () => {
        const a = { tabModel: { tabId: "a" } };
        const b = { tabModel: { tabId: "b" } };
        const a2 = { tabModel: { tabId: "a" } };
        const orphan = { tabModel: null };
        expect(modelsForTab([a, b, a2, orphan], "a")).toEqual([a, a2]);
        expect(modelsForTab([a, b, orphan], null)).toEqual([]);
        expect(modelsForTab([a, b], "closed")).toEqual([]);
    });
});
