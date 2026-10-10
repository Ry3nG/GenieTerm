// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { App } from "@/app/app";
import { activeTabIdAtom, configureTabMode, SingleView, tabCacheVersionAtom } from "@/app/store/activetab";
import { loadBadges } from "@/app/store/badge";
import { GlobalModel } from "@/app/store/global-model";
import {
    globalRefocus,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
} from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { tabAfterClose } from "@/app/store/tabpaneutils";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeTabRouteId } from "@/app/store/wshrouter";
import { initWshrpc, syncTabRoutes, TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { deleteLayoutModelForTab } from "@/layout/lib/layoutModelHooks";
import { countersClear, countersPrint } from "@/store/counters";
import {
    atoms,
    getApi,
    globalStore,
    initGlobal,
    initGlobalWaveEventSubs,
    loadConnStatus,
    subscribeToConnEvents,
} from "@/store/global";
import { deleteTabModel, getTabModelByTabId } from "@/store/tab-model";
import * as WOS from "@/store/wos";
import { loadFonts } from "@/util/fontutil";
import { setKeyUtilPlatform } from "@/util/keyutil";
import { isMacOS, setMacOSVersion } from "@/util/platformutil";
import { atom } from "jotai";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const platform = getApi().getPlatform();
document.title = `GenieTerm`;
let savedInitOpts: WaveInitOpts = null;

(window as any).WOS = WOS;
(window as any).globalStore = globalStore;
(window as any).globalAtoms = atoms;
(window as any).RpcApi = RpcApi;
(window as any).isFullScreen = false;
(window as any).countersPrint = countersPrint;
(window as any).countersClear = countersClear;
(window as any).getLayoutModelForStaticTab = getLayoutModelForStaticTab;
(window as any).modalsModel = modalsModel;

function updateZoomFactor(zoomFactor: number) {
    console.log("update zoomfactor", zoomFactor);
    document.documentElement.style.setProperty("--zoomfactor", String(zoomFactor));
    document.documentElement.style.setProperty("--zoomfactor-inv", String(1 / zoomFactor));
}

async function initBare() {
    getApi().sendLog("Init Bare");
    document.body.style.visibility = "hidden";
    document.body.style.opacity = "0";
    document.body.classList.add("is-transparent");
    getApi().onWaveInit(initWaveWrap);
    setKeyUtilPlatform(platform);
    loadFonts();
    updateZoomFactor(getApi().getZoomFactor());
    getApi().onZoomFactorChange((zoomFactor) => {
        updateZoomFactor(zoomFactor);
    });
    document.fonts.ready.then(() => {
        console.log("Init Bare Done");
        getApi().setWindowInitStatus("ready");
    });
}

document.addEventListener("DOMContentLoaded", initBare);

async function initWaveWrap(initOpts: WaveInitOpts) {
    try {
        if (savedInitOpts) {
            await reinitWave();
            return;
        }
        savedInitOpts = initOpts;
        await initWave(initOpts);
    } catch (e) {
        getApi().sendLog("Error in initWave " + e.message + "\n" + e.stack);
        console.error("Error in initWave", e);
    } finally {
        document.body.style.visibility = null;
        document.body.style.opacity = null;
        document.body.classList.remove("is-transparent");
    }
}

async function reinitWave() {
    console.log("Reinit GenieTerm");
    getApi().sendLog("Reinit GenieTerm");

    // We use this hack to prevent a flicker of the previously-hovered tab when this view was last active.
    document.body.classList.add("nohover");
    requestAnimationFrame(() =>
        setTimeout(() => {
            document.body.classList.remove("nohover");
        }, 100)
    );

    await WOS.reloadWaveObject<Client>(WOS.makeORef("client", savedInitOpts.clientId));
    const waveWindow = await WOS.reloadWaveObject<WaveWindow>(WOS.makeORef("window", savedInitOpts.windowId));
    const ws = await WOS.reloadWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid));
    const initialTab = await WOS.reloadWaveObject<Tab>(WOS.makeORef("tab", savedInitOpts.tabId));
    await WOS.reloadWaveObject<LayoutState>(WOS.makeORef("layout", initialTab.layoutstate));
    reloadAllWorkspaceTabs(ws);
    document.title = `GenieTerm - ${initialTab.name}`; // TODO update with tab name change
    getApi().setWindowInitStatus("wave-ready");
    globalStore.set(atoms.reinitVersion, globalStore.get(atoms.reinitVersion) + 1);
    globalStore.set(atoms.updaterStatusAtom, getApi().getUpdaterStatus());
    setTimeout(() => {
        globalRefocus();
    }, 50);
}

function reloadAllWorkspaceTabs(ws: Workspace) {
    if (ws == null || !ws.tabids?.length) {
        return;
    }
    ws.tabids?.forEach((tabid) => {
        WOS.reloadWaveObject<Tab>(WOS.makeORef("tab", tabid));
    });
}

function loadAllWorkspaceTabs(ws: Workspace) {
    if (ws == null || !ws.tabids?.length) {
        return;
    }
    ws.tabids?.forEach((tabid) => {
        WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabid));
    });
}

function initializeTabTracking() {
    const titleAtom = atom((get) => {
        const tabId = get(activeTabIdAtom);
        if (!tabId) {
            return null;
        }
        return get(getTabModelByTabId(tabId).tabAtom)?.name;
    });
    const updateTitle = () => {
        const name = globalStore.get(titleAtom);
        document.title = name ? `GenieTerm - ${name}` : "GenieTerm";
    };
    globalStore.sub(titleAtom, updateTitle);
    updateTitle();
    if (!SingleView) {
        return;
    }
    getApi().onClearTabCache(() => {
        globalStore.set(tabCacheVersionAtom, (version) => version + 1);
    });
    let previousTabs = globalStore.get(atoms.workspace)?.tabids ?? [];
    const syncWorkspace = () => {
        const workspace = globalStore.get(atoms.workspace);
        if (workspace == null) {
            return;
        }
        const tabs = workspace.tabids ?? [];
        const active = globalStore.get(activeTabIdAtom);
        if (!tabs.includes(active)) {
            globalStore.set(activeTabIdAtom, tabAfterClose(previousTabs, tabs, active));
        }
        syncTabRoutes(tabs);
        for (const id of previousTabs) {
            if (!tabs.includes(id)) {
                deleteTabModel(id);
                deleteLayoutModelForTab(id);
            }
        }
        previousTabs = [...tabs];
    };
    globalStore.sub(atoms.workspace, syncWorkspace);
    syncWorkspace();
    let focusTimer: ReturnType<typeof setTimeout>;
    globalStore.sub(activeTabIdAtom, () => {
        clearTimeout(focusTimer);
        focusTimer = setTimeout(globalRefocus, 50);
    });
    getApi().onSwitchTab((id) => {
        if (id !== globalStore.get(activeTabIdAtom)) {
            globalStore.set(activeTabIdAtom, id);
        }
    });
}

async function initWave(initOpts: WaveInitOpts) {
    getApi().sendLog("Init GenieTerm " + JSON.stringify(initOpts));
    configureTabMode(initOpts.singleView ?? false, initOpts.tabCacheCeiling);
    const globalInitOpts: GlobalInitOptions = {
        tabId: initOpts.tabId,
        clientId: initOpts.clientId,
        windowId: initOpts.windowId,
        platform,
        environment: "renderer",
        primaryTabStartup: initOpts.primaryTabStartup,
    };
    console.log("GenieTerm Init", globalInitOpts);
    globalStore.set(activeTabIdAtom, initOpts.tabId);
    await GlobalModel.getInstance().initialize(globalInitOpts);
    initGlobal(globalInitOpts);
    (window as any).globalAtoms = atoms;

    // Init WPS event handlers
    const globalWS = initWshrpc(
        SingleView ? `fe:${initOpts.windowId}:${crypto.randomUUID().slice(0, 8)}` : makeTabRouteId(initOpts.tabId)
    );
    (window as any).globalWS = globalWS;
    (window as any).TabRpcClient = TabRpcClient;

    // ensures client/window/workspace are loaded into the cache before rendering
    try {
        await loadConnStatus();
        await loadBadges();
        initGlobalWaveEventSubs(initOpts);
        subscribeToConnEvents();
        if (isMacOS()) {
            const macOSVersion = await RpcApi.MacOSVersionCommand(TabRpcClient);
            setMacOSVersion(macOSVersion);
        }
        const [_client, waveWindow, initialTab] = await Promise.all([
            WOS.loadAndPinWaveObject<Client>(WOS.makeORef("client", initOpts.clientId)),
            WOS.loadAndPinWaveObject<WaveWindow>(WOS.makeORef("window", initOpts.windowId)),
            WOS.loadAndPinWaveObject<Tab>(WOS.makeORef("tab", initOpts.tabId)),
        ]);
        const [ws, _layoutState] = await Promise.all([
            WOS.loadAndPinWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid)),
            WOS.reloadWaveObject<LayoutState>(WOS.makeORef("layout", initialTab.layoutstate)),
        ]);
        loadAllWorkspaceTabs(ws);
        WOS.wpsSubscribeToObject(WOS.makeORef("workspace", waveWindow.workspaceid));
        document.title = `GenieTerm - ${initialTab.name}`; // TODO update with tab name change
    } catch (e) {
        console.error("Failed initialization error", e);
        getApi().sendLog("Error in initialization (wave.ts, loading required objects) " + e.message + "\n" + e.stack);
    }
    initializeTabTracking();
    registerGlobalKeys();
    registerElectronReinjectKeyHandler();
    registerControlShiftStateUpdateHandler();
    const fullConfig = await RpcApi.GetFullConfigCommand(TabRpcClient);
    console.log("fullconfig", fullConfig);
    globalStore.set(atoms.fullConfigAtom, fullConfig);
    console.log("GenieTerm First Render");
    let firstRenderResolveFn: () => void = null;
    const firstRenderPromise = new Promise<void>((resolve) => {
        firstRenderResolveFn = resolve;
    });
    const reactElem = createElement(App, { onFirstRender: firstRenderResolveFn }, null);
    const elem = document.getElementById("main");
    const root = createRoot(elem);
    root.render(reactElem);
    await firstRenderPromise;
    console.log("GenieTerm First Render Done");
    getApi().setWindowInitStatus("wave-ready");
}
