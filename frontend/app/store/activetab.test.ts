// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { activeTabIdAtom, configureTabMode, setActiveTab } from "./activetab";
import { globalStore } from "./jotaiStore";

afterEach(() => {
    configureTabMode(false);
    globalStore.set(activeTabIdAtom, null);
    vi.unstubAllGlobals();
});

describe("tab selection", () => {
    it("updates the shared renderer before notifying Electron", () => {
        configureTabMode(true);
        globalStore.set(activeTabIdAtom, "a");
        const notify = vi.fn((id: string) => expect(globalStore.get(activeTabIdAtom)).toBe(id));
        vi.stubGlobal("window", { api: { setActiveTab: notify } });
        setActiveTab("b");
        setActiveTab("c");
        expect(notify.mock.calls).toEqual([["b"], ["c"]]);
        expect(globalStore.get(activeTabIdAtom)).toBe("c");
    });

    it("leaves legacy renderer identity unchanged while Electron switches views", () => {
        configureTabMode(false);
        globalStore.set(activeTabIdAtom, "a");
        const notify = vi.fn();
        vi.stubGlobal("window", { api: { setActiveTab: notify } });
        setActiveTab("b");
        expect(globalStore.get(activeTabIdAtom)).toBe("a");
        expect(notify).toHaveBeenCalledWith("b");
    });
});
