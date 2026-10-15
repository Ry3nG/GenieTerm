// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { getAtoms, initGlobalAtoms } from "@/app/store/global-atoms";
import { GlobalModel } from "@/app/store/global-model";
import { globalStore } from "@/app/store/jotaiStore";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { loadFonts } from "@/util/fontutil";
import { Provider } from "jotai";
import "overlayscrollbars/overlayscrollbars.css";
import { createRoot } from "react-dom/client";
import "../app/app.scss";
import { makeMockWaveEnv, PreviewClientId, PreviewTabId, PreviewWindowId } from "../preview/mock/mockwaveenv";
import { installPreviewElectronApi } from "../preview/mock/preview-electron-api";
import { PreviewContextMenu } from "../preview/preview-contextmenu";
import "../preview/preview.css";
import HostPreview from "../preview/previews/host.preview";
import { CommandAiExperience } from "./commandai";
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
loadFonts();
const Env = makeMockWaveEnv();
const View = new URLSearchParams(window.location.search).get("view");
createRoot(document.getElementById("main")).render(
    <Provider store={globalStore}>
        <WaveEnvContext.Provider value={Env}>
            <TabModelContext.Provider value={getTabModelByTabId(PreviewTabId, Env)}>
                <ErrorBoundary>{View === "ai" ? <CommandAiExperience /> : <HostPreview standalone />}</ErrorBoundary>
                <PreviewContextMenu />
            </TabModelContext.Provider>
        </WaveEnvContext.Provider>
    </Provider>
);
