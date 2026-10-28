// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { ClientModel } from "@/app/store/client-model";
import {
    atoms,
    createBlock,
    getBlockComponentModel,
    getFocusedBlockId,
    globalStore,
    refocusNode,
    WOS,
} from "@/app/store/global";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atom, PrimitiveAtom } from "jotai";
import { CurrentOnboardingVersion } from "./onboarding-common";
import { OnboardingModel, setClientMeta } from "./onboarding-model";

export const FeatureTourSteps = ["history", "output", "host", "files"] as const;
export type FeatureTourStep = (typeof FeatureTourSteps)[number];

export function isFeatureTourStep(value: unknown): value is FeatureTourStep {
    return FeatureTourSteps.includes(value as FeatureTourStep);
}

export function savedFeatureStep(meta: MetaType): FeatureTourStep {
    if (meta["onboarding:featureversion"] !== CurrentOnboardingVersion || meta["onboarding:featuretour"] === "done") {
        return "history";
    }
    return isFeatureTourStep(meta["onboarding:featurestep"]) ? meta["onboarding:featurestep"] : "history";
}

function clientMeta(): MetaType {
    return globalStore.get(ClientModel.getInstance().clientAtom)?.meta ?? {};
}

function currentTerminal(): TermViewModel {
    const tabId = globalStore.get(atoms.staticTabId);
    const tab = tabId ? globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId))) : null;
    const ids = tab?.blockids ?? [];
    const focused = getFocusedBlockId();
    const ordered = ids.includes(focused) ? [focused, ...ids.filter((id) => id !== focused)] : ids;
    for (const id of ordered) {
        const vm = getBlockComponentModel(id)?.viewModel;
        if (vm?.viewType === "term") return vm as TermViewModel;
    }
    return null;
}

export async function openFeatureTourTarget(step: FeatureTourStep): Promise<void> {
    const terminal = currentTerminal();
    if (step === "host" || step === "files") {
        const context = terminal?.getCommandLibraryContext();
        await createBlock({
            meta: {
                view: step === "host" ? "host" : "preview",
                ...(context?.connection && context.connection !== "local" ? { connection: context.connection } : {}),
                ...(step === "host" ? { "host:tab": "ports" } : { file: context?.cwd || "~" }),
            },
        });
        return;
    }
    if (!terminal) throw new Error("Open a terminal pane, then try this step again.");
    refocusNode(terminal.blockId);
    if (step === "history") {
        terminal.openCommandLibrary();
        return;
    }
    terminal.inspectCommandOutput();
    if (globalStore.get(terminal.outputSnapshotAtom) == null) {
        throw new Error(
            "Run a command in a supported shell first, then inspect its output. Leave full-screen programs before trying again."
        );
    }
}

export class FeatureTourModel {
    private static instance: FeatureTourModel;
    stepAtom = atom(null) as PrimitiveAtom<FeatureTourStep>;
    errorAtom = atom("");
    openedAtom = atom(false);
    busyAtom = atom(false);
    pendingWrites = 0;
    unsubscribe: () => void;

    private constructor() {}

    static getInstance(): FeatureTourModel {
        if (!FeatureTourModel.instance) FeatureTourModel.instance = new FeatureTourModel();
        return FeatureTourModel.instance;
    }

    static resetInstance() {
        FeatureTourModel.instance?.unsubscribe?.();
        FeatureTourModel.instance = null;
    }

    init() {
        if (this.unsubscribe) return;
        this.unsubscribe = globalStore.sub(ClientModel.getInstance().clientAtom, () => {
            if (this.pendingWrites || !globalStore.get(this.stepAtom)) return;
            const meta = clientMeta();
            if (
                meta["onboarding:featuretour"] !== "active" ||
                meta["onboarding:featureversion"] !== CurrentOnboardingVersion
            ) {
                globalStore.set(this.stepAtom, null);
            }
        });
    }

    persist(status: "active" | "dismissed" | "done", step: FeatureTourStep) {
        this.pendingWrites++;
        return setClientMeta({
            "onboarding:lastversion": CurrentOnboardingVersion,
            "onboarding:featuretour": status,
            "onboarding:featurestep": step,
            "onboarding:featureversion": CurrentOnboardingVersion,
        }).finally(() => this.pendingWrites--);
    }

    start() {
        this.init();
        const quickStart = OnboardingModel.getInstance();
        if (quickStart.isActive()) quickStart.dismiss();
        quickStart.dismissTip();
        this.setStep(savedFeatureStep(clientMeta()));
    }

    setStep(step: FeatureTourStep) {
        globalStore.set(this.stepAtom, step);
        globalStore.set(this.errorAtom, "");
        globalStore.set(this.openedAtom, false);
        void this.persist("active", step);
    }

    move(delta: number) {
        const step = globalStore.get(this.stepAtom);
        if (!step || globalStore.get(this.busyAtom)) return;
        const index = FeatureTourSteps.indexOf(step) + delta;
        if (index >= FeatureTourSteps.length) {
            this.close(true);
            return;
        }
        this.setStep(FeatureTourSteps[Math.max(0, index)]);
    }

    close(done = false) {
        const step = globalStore.get(this.stepAtom);
        if (!step) return;
        globalStore.set(this.stepAtom, null);
        void this.persist(done ? "done" : "dismissed", step);
    }

    async openTarget() {
        const step = globalStore.get(this.stepAtom);
        if (!step || globalStore.get(this.busyAtom)) return;
        globalStore.set(this.busyAtom, true);
        globalStore.set(this.errorAtom, "");
        try {
            await openFeatureTourTarget(step);
            if (globalStore.get(this.stepAtom) === step) globalStore.set(this.openedAtom, true);
        } catch (error) {
            if (globalStore.get(this.stepAtom) === step)
                globalStore.set(this.errorAtom, String(error instanceof Error ? error.message : error));
        } finally {
            globalStore.set(this.busyAtom, false);
        }
    }
}
