// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { getAtoms, initGlobalAtoms } from "@/app/store/global-atoms";
import { GlobalModel } from "@/app/store/global-model";
import { globalStore } from "@/app/store/jotaiStore";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { Provider } from "jotai";
import "overlayscrollbars/overlayscrollbars.css";
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "../app/app.scss";
import { makeMockWaveEnv, PreviewClientId, PreviewTabId, PreviewWindowId } from "../preview/mock/mockwaveenv";
import { installPreviewElectronApi } from "../preview/mock/preview-electron-api";
import { PreviewContextMenu } from "../preview/preview-contextmenu";
import "../preview/preview.css";
import "./site.css";

installPreviewElectronApi();
const Options = {
    tabId: PreviewTabId,
    windowId: PreviewWindowId,
    clientId: PreviewClientId,
    environment: "renderer",
    platform: "darwin",
    isPreview: true,
} as GlobalInitOptions;
initGlobalAtoms(Options);
globalStore.set(getAtoms().fullConfigAtom, {} as FullConfigType);
GlobalModel.getInstance().initialize(Options);
for (const [family, file, weight] of [
    ["Inter", "inter-latin.woff2", "100 900"],
    ["Hack", "hack-latin.woff2", "400"],
    ["Hack", "hack-latin-bold.woff2", "700"],
]) {
    const font = new FontFace(family, `url('../fonts/${file}')`, { weight, display: "swap" });
    (document.fonts as any).add(font);
    void font.load();
}
const Env = makeMockWaveEnv();
const View = new URLSearchParams(window.location.search).get("view");
const HostPreview = lazy(() => import("../preview/previews/host.preview"));
const CommandAiExperience = lazy(() =>
    import("./commandai").then((module) => ({ default: module.CommandAiExperience }))
);
createRoot(document.getElementById("main")).render(
    <Provider store={globalStore}>
        <WaveEnvContext.Provider value={Env}>
            <TabModelContext.Provider value={getTabModelByTabId(PreviewTabId, Env)}>
                <ErrorBoundary>
                    <Suspense fallback={null}>
                        {View === "ai" ? <CommandAiExperience /> : <HostPreview standalone />}
                    </Suspense>
                </ErrorBoundary>
                <PreviewContextMenu />
            </TabModelContext.Provider>
        </WaveEnvContext.Provider>
    </Provider>
);
