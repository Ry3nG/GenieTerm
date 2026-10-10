// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getLayoutModelForStaticTab } from "@/layout/index";
import { RpcResponseHelper, WshClient } from "./wshclient";

export class TabClient extends WshClient {
    constructor(routeId: string) {
        super(routeId);
    }

    async handle_setblockfocus(rh: RpcResponseHelper, blockId: string): Promise<void> {
        const layoutModel = getLayoutModelForStaticTab();
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
