// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getLayoutModelForTabById } from "@/layout/lib/layoutModelHooks";
import { activeTabIdAtom } from "./activetab";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";
import { RpcResponseHelper, WshClient } from "./wshclient";

export class TabClient extends WshClient {
    constructor(
        routeId: string,
        public tabId?: string
    ) {
        super(routeId);
    }

    async handle_setblockfocus(rh: RpcResponseHelper, blockId: string): Promise<void> {
        const tabId = this.tabId ?? globalStore.get(activeTabIdAtom);
        const tab = await WOS.loadAndPinWaveObject<Tab>(WOS.makeORef("tab", tabId));
        if (tab == null) {
            throw new Error(`Tab not found: ${tabId}`);
        }
        await WOS.loadAndPinWaveObject<LayoutState>(WOS.makeORef("layout", tab.layoutstate));
        const layoutModel = getLayoutModelForTabById(tabId);
        if (!layoutModel) {
            throw new Error("Layout model not found");
        }

        const node = layoutModel.getNodeByBlockId(blockId);
        if (!node) {
            throw new Error(`Block not found in tab: ${blockId}`);
        }

        layoutModel.focusNode(node.id);
    }
}
