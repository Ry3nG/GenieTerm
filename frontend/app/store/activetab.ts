// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, PrimitiveAtom } from "jotai";
import { globalStore } from "./jotaiStore";

export const tabCacheVersionAtom = atom(0) as PrimitiveAtom<number>;
export const activeTabIdAtom = atom<string>(null) as PrimitiveAtom<string>;
export let SingleView = false;
export let TabCacheCeiling = 16;

export function configureTabMode(singleView: boolean, ceiling = 16) {
    SingleView = singleView;
    TabCacheCeiling = ceiling;
}

export function setActiveTab(tabId: string) {
    if (SingleView) {
        globalStore.set(activeTabIdAtom, tabId);
    }
    (window as any).api.setActiveTab(tabId);
}
