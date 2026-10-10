// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { WaveEnv } from "@/app/waveenv/waveenv";
import { TermViewModel } from "@/view/term/term-model";
import { atom } from "jotai";
import { blockViewToIcon, blockViewToName } from "./blockutil";

const BlockRegistry: Map<string, ViewModelClass> = new Map();
BlockRegistry.set("term", TermViewModel);
const ViewModelLoaders: Record<string, () => Promise<ViewModelClass>> = {
    preview: () => import("@/app/view/preview/preview-model").then((m) => m.PreviewModel),
    web: () => import("@/app/view/webview/webview").then((m) => m.WebViewModel),
    host: () => import("@/app/view/host/host-model").then((m) => m.HostViewModel),
    // sysinfo and processviewer blocks saved by earlier versions open as the Host view
    sysinfo: () => import("@/app/view/host/host-model").then((m) => m.HostViewModel),
    vdom: () => import("@/app/view/vdom/vdom-model").then((m) => m.VDomModel),
    waveconfig: () => import("@/app/view/waveconfig/waveconfig-model").then((m) => m.WaveConfigViewModel),
    processviewer: () => import("@/app/view/host/host-model").then((m) => m.HostViewModel),
};
const ViewModelLoads = new Map<string, Promise<void>>();

export function loadViewModel(viewType: string): Promise<void> {
    if (BlockRegistry.has(viewType) || !Object.hasOwn(ViewModelLoaders, viewType)) {
        return null;
    }
    let pending = ViewModelLoads.get(viewType);
    if (pending == null) {
        pending = ViewModelLoaders[viewType]().then((ctor) => {
            BlockRegistry.set(viewType, ctor);
        });
        ViewModelLoads.set(viewType, pending);
    }
    return pending;
}

function makeDefaultViewModel(viewType: string): ViewModel {
    const viewModel: ViewModel = {
        viewType: viewType,
        viewIcon: atom(blockViewToIcon(viewType)),
        viewName: atom(blockViewToName(viewType)),
        preIconButton: atom(null),
        endIconButtons: atom(null),
        viewComponent: null,
    };
    return viewModel;
}

function makeViewModel(
    blockId: string,
    blockView: string,
    nodeModel: BlockNodeModel,
    tabModel: TabModel,
    waveEnv: WaveEnv
): ViewModel {
    const ctor = BlockRegistry.get(blockView);
    if (ctor != null) {
        return new ctor({ blockId, nodeModel, tabModel, waveEnv });
    }
    return makeDefaultViewModel(blockView);
}

export { makeViewModel };
