// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { isBuilderWindow } from "@/app/store/windowtype";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, getApi, getOrefMetaKeyAtom, getSettingsKeyAtom } from "@/store/global";
import * as jotai from "jotai";
import { debounce } from "lodash-es";
import { ImperativePanelGroupHandle, ImperativePanelHandle } from "react-resizable-panels";

const VTabBar_DefaultWidth = 220;
const VTabBar_MinWidth = 110;
const VTabBar_MaxWidth = 280;

function clampVTabWidth(w: number): number {
    return Math.max(VTabBar_MinWidth, Math.min(w, VTabBar_MaxWidth));
}

class WorkspaceLayoutModel {
    private static instance: WorkspaceLayoutModel | null = null;

    vtabPanelRef: ImperativePanelHandle | null;
    outerPanelGroupRef: ImperativePanelGroupHandle | null;
    panelContainerRef: HTMLDivElement | null;
    vtabPanelWrapperRef: HTMLDivElement | null;
    panelVisibleAtom: jotai.PrimitiveAtom<boolean>;
    widgetsSidebarVisibleAtom: jotai.Atom<boolean>;

    private inResize: boolean;
    private vtabWidth: number;
    private vtabVisible: boolean;
    private transitionTimeoutRef: NodeJS.Timeout | null = null;
    private debouncedPersistVTabWidth: () => void;

    private constructor() {
        this.vtabPanelRef = null;
        this.outerPanelGroupRef = null;
        this.panelContainerRef = null;
        this.vtabPanelWrapperRef = null;
        this.inResize = false;
        this.vtabWidth = VTabBar_DefaultWidth;
        this.vtabVisible = false;
        this.panelVisibleAtom = jotai.atom(false);
        // Terminal-first: the widget rail is opt-in, not the default surface. Every
        // view it offered is reachable from the command palette (New Terminal/Files/
        // Web/System Info/Processes), and "View: Toggle Widgets Bar" brings the rail back.
        this.widgetsSidebarVisibleAtom = jotai.atom(
            (get) =>
                get(getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:widgetsvisible")) ??
                false
        );
        this.initializeFromMeta();

        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handleOuterPanelLayout = this.handleOuterPanelLayout.bind(this);
        this.handleInnerPanelLayout = this.handleInnerPanelLayout.bind(this);

        this.debouncedPersistVTabWidth = debounce(() => {
            if (!this.vtabVisible) return;
            const width = this.vtabPanelWrapperRef?.offsetWidth;
            if (width == null || width <= 0) return;
            try {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("workspace", this.getWorkspaceId()),
                    meta: { "layout:vtabbarwidth": width },
                });
            } catch (e) {
                console.warn("Failed to persist vtabbar width:", e);
            }
        }, 300);
    }

    static getInstance(): WorkspaceLayoutModel {
        if (!WorkspaceLayoutModel.instance) {
            WorkspaceLayoutModel.instance = new WorkspaceLayoutModel();
        }
        return WorkspaceLayoutModel.instance;
    }

    private getWorkspaceId(): string {
        return globalStore.get(atoms.workspace)?.oid ?? "";
    }

    private getVTabBarWidthAtom(): jotai.Atom<number> {
        return getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:vtabbarwidth");
    }

    private initializeFromMeta(): void {
        try {
            const savedVTabWidth = globalStore.get(this.getVTabBarWidthAtom());
            if (savedVTabWidth != null && savedVTabWidth > 0) {
                this.vtabWidth = savedVTabWidth;
            }
            const tabBarPosition = globalStore.get(getSettingsKeyAtom("app:tabbar")) ?? "top";
            this.vtabVisible = tabBarPosition === "left" && !isBuilderWindow();
            globalStore.set(this.panelVisibleAtom, false);
            getApi().setWaveAIOpen(false);
        } catch (e) {
            console.warn("Failed to initialize workspace layout meta:", e);
        }
    }

    private getResolvedVTabWidth(): number {
        return clampVTabWidth(this.vtabWidth);
    }

    private computeLayout(windowWidth: number): number[] {
        const vtabW = this.vtabVisible ? this.getResolvedVTabWidth() : 0;
        const leftPct = windowWidth > 0 ? (vtabW / windowWidth) * 100 : 0;
        return [leftPct, Math.max(0, 100 - leftPct)];
    }

    private commitLayout(windowWidth: number): void {
        if (!this.outerPanelGroupRef) return;
        this.inResize = true;
        this.outerPanelGroupRef.setLayout(this.computeLayout(windowWidth));
        this.inResize = false;
    }

    handleOuterPanelLayout(sizes: number[]): void {
        if (this.inResize || !this.vtabVisible) return;
        const windowWidth = window.innerWidth;
        this.vtabWidth = clampVTabWidth((sizes[0] / 100) * windowWidth);
        this.debouncedPersistVTabWidth();
        this.commitLayout(windowWidth);
    }

    handleInnerPanelLayout(): void {
        return;
    }

    handleWindowResize(): void {
        this.commitLayout(window.innerWidth);
    }

    syncVTabWidthFromMeta(): void {
        const savedVTabWidth = globalStore.get(this.getVTabBarWidthAtom());
        if (savedVTabWidth != null && savedVTabWidth > 0 && savedVTabWidth !== this.vtabWidth) {
            this.vtabWidth = savedVTabWidth;
            this.commitLayout(window.innerWidth);
        }
    }

    registerRefs(
        outerPanelGroupRef: ImperativePanelGroupHandle,
        panelContainerRef: HTMLDivElement,
        vtabPanelRef?: ImperativePanelHandle,
        vtabPanelWrapperRef?: HTMLDivElement,
        showLeftTabBar?: boolean
    ): void {
        this.vtabPanelRef = vtabPanelRef ?? null;
        this.outerPanelGroupRef = outerPanelGroupRef;
        this.panelContainerRef = panelContainerRef;
        this.vtabPanelWrapperRef = vtabPanelWrapperRef ?? null;
        this.vtabVisible = showLeftTabBar ?? false;
        this.syncPanelCollapse();
        this.commitLayout(window.innerWidth);
    }

    private syncPanelCollapse(): void {
        if (!this.vtabPanelRef) return;
        if (this.vtabVisible) {
            this.vtabPanelRef.expand();
        } else {
            this.vtabPanelRef.collapse();
        }
    }

    enableTransitions(duration: number): void {
        if (!this.panelContainerRef) return;
        const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
        panels.forEach((panel: HTMLElement) => {
            panel.style.transition = "flex 0.2s ease-in-out";
        });
        if (this.transitionTimeoutRef) {
            clearTimeout(this.transitionTimeoutRef);
        }
        this.transitionTimeoutRef = setTimeout(() => {
            if (!this.panelContainerRef) return;
            const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
            panels.forEach((panel: HTMLElement) => {
                panel.style.transition = "none";
            });
        }, duration);
    }

    updateWrapperWidth(): void {
        return;
    }

    getAIPanelVisible(): boolean {
        return false;
    }

    getAIPanelWidth(): number {
        return 0;
    }

    getLeftGroupInitialPercentage(windowWidth: number, showLeftTabBar: boolean): number {
        const vtabW = showLeftTabBar && !isBuilderWindow() ? this.getResolvedVTabWidth() : 0;
        return windowWidth > 0 ? (vtabW / windowWidth) * 100 : 0;
    }

    getInnerVTabInitialPercentage(): number {
        return 100;
    }

    getInnerAIPanelInitialPercentage(): number {
        return 0;
    }

    setAIPanelVisible(): void {
        globalStore.set(this.panelVisibleAtom, false);
        getApi().setWaveAIOpen(false);
    }

    setShowLeftTabBar(showLeftTabBar: boolean): void {
        if (this.vtabVisible === showLeftTabBar) return;
        this.vtabVisible = showLeftTabBar;
        this.enableTransitions(250);
        this.syncPanelCollapse();
        this.commitLayout(window.innerWidth);
    }
}

export { WorkspaceLayoutModel };
