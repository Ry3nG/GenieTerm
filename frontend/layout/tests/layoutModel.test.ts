// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { setWaveWindowType } from "@/app/store/windowtype";
import { atom } from "jotai";
import { afterEach, assert, beforeEach, test } from "vitest";
import { LayoutModel } from "../lib/layoutModel";
import { newLayoutNode } from "../lib/layoutNode";
import { FlexDirection } from "../lib/types";

const TestLayoutStateId = "layout-model-test-state";

beforeEach(() => {
    setWaveWindowType("preview");
    WOS.mockObjectForPreview(`layout:${TestLayoutStateId}`, {
        otype: "layout",
        oid: TestLayoutStateId,
        version: 1,
    } as LayoutState);
});

afterEach(() => {
    setWaveWindowType("tab");
});

function makeLayoutModel(): LayoutModel {
    const tabAtom = atom({
        otype: "tab",
        oid: "layout-model-test-tab",
        version: 1,
        name: "Test",
        layoutstate: TestLayoutStateId,
        blockids: [],
    } as Tab);

    return new LayoutModel(tabAtom, globalStore.get, globalStore.set);
}

test("getNodeByBlockId finds ephemeral nodes", () => {
    const model = makeLayoutModel();
    const regularNode = newLayoutNode(FlexDirection.Row, undefined, undefined, { blockId: "regular-block" });
    const ephemeralNode = newLayoutNode(undefined, undefined, undefined, { blockId: "ephemeral-block" });

    globalStore.set(model.leafs, [regularNode]);
    globalStore.set(model.ephemeralNode, ephemeralNode);

    assert.equal(model.getNodeByBlockId("regular-block")?.id, regularNode.id);
    assert.equal(model.getNodeByBlockId("ephemeral-block")?.id, ephemeralNode.id);
});
