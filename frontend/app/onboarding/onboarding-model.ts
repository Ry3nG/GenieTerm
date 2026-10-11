// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { ClientModel } from "@/app/store/client-model";
import { atoms, getBlockComponentModel, getFocusedBlockId, globalStore, refocusNode, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isLikelyNaturalLanguageCommand } from "@/app/view/term/command-composer";
import * as jotai from "jotai";
import { OnboardingAnchor, OnboardingEvent, subscribeOnboardingEvents } from "./onboarding-events";

export type QuickStartStep = "command" | "blocks" | "commandai" | "files" | "done";
export type QuickStartStatus = "active" | "done" | "dismissed";
export type OnboardingTipId = "fix" | "remote";

export type OnboardingTip = {
    id: OnboardingTipId;
    blockId?: string;
    connection?: string;
};

export const QuickStartSteps: QuickStartStep[] = ["command", "blocks", "commandai", "files", "done"];
export const QuickStartTryCommand = "ls";
export const QuickStartAiPrompt = "find the 5 largest files in this folder";

// Exit codes that mean the user stopped the command (Ctrl-C, SIGTERM), not that it failed.
const InterruptExitCodes = new Set([130, 143]);
const CommandNotFoundExitCode = 127;

export function getQuickStartProgress(step: QuickStartStep): { index: number; total: number } {
    switch (step) {
        case "command":
        case "blocks":
            return { index: 1, total: 3 };
        case "commandai":
            return { index: 2, total: 3 };
        case "files":
        case "done":
            return { index: 3, total: 3 };
    }
}

export function isQuickStartStep(value: unknown): value is QuickStartStep {
    return typeof value === "string" && (QuickStartSteps as string[]).includes(value);
}

export function nextQuickStartStep(step: QuickStartStep, opts: { commandAiAvailable: boolean }): QuickStartStep {
    const idx = QuickStartSteps.indexOf(step);
    const next = QuickStartSteps[Math.min(idx + 1, QuickStartSteps.length - 1)];
    if (next === "commandai" && !opts.commandAiAvailable) {
        return "files";
    }
    return next;
}

export function isFailedCommandExit(exitCode: number, command: string): boolean {
    if (exitCode == null || exitCode <= 0 || InterruptExitCodes.has(exitCode)) {
        return false;
    }
    // "command not found" for a typed request already gets the inline suggestion
    if (exitCode === CommandNotFoundExitCode && isLikelyNaturalLanguageCommand(command ?? "")) {
        return false;
    }
    return true;
}

function isTermBlock(blockId: string): boolean {
    if (blockId == null) {
        return false;
    }
    return getBlockComponentModel(blockId)?.viewModel?.viewType === "term";
}

function getTermViewModel(blockId: string): any {
    if (!isTermBlock(blockId)) {
        return null;
    }
    return getBlockComponentModel(blockId).viewModel;
}

function getActiveTabBlockIds(): string[] {
    const tabId = globalStore.get(atoms.staticTabId);
    const tab = tabId ? globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId))) : null;
    return tab?.blockids ?? [];
}

// Background tabs stay mounted (hidden) in the same renderer; only the visible tab can be guided.
function isInActiveTab(blockId: string): boolean {
    return blockId != null && getActiveTabBlockIds().includes(blockId);
}

function findTabTermBlockId(): string {
    const focused = getFocusedBlockId();
    if (isTermBlock(focused) && isInActiveTab(focused)) {
        return focused;
    }
    for (const blockId of getActiveTabBlockIds()) {
        if (isTermBlock(blockId)) {
            return blockId;
        }
    }
    return null;
}

let metaWriteQueue: Promise<void> = Promise.resolve();

// The server handles each RPC on its own goroutine, so unawaited writes can land out of order
// and an old "active" could overwrite "done". Chain them instead.
export function setClientMeta(meta: MetaType): Promise<void> {
    const clientId = ClientModel.getInstance().clientId;
    if (clientId == null) {
        return metaWriteQueue;
    }
    metaWriteQueue = metaWriteQueue
        .then(() =>
            RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("client", clientId),
                meta,
            })
        )
        .catch((e) => console.error("onboarding meta write failed", e));
    return metaWriteQueue;
}

export function whenOnboardingMetaSaved(): Promise<void> {
    return metaWriteQueue;
}

function getClientMeta(): MetaType {
    return globalStore.get(ClientModel.getInstance().clientAtom)?.meta ?? {};
}

export class OnboardingModel {
    private static instance: OnboardingModel | null = null;

    // Quick Start runs in the window that started it; other windows only see the saved progress.
    stepAtom = jotai.atom(null) as jotai.PrimitiveAtom<QuickStartStep>;
    targetBlockIdAtom = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    commandAiOpenedAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    tipAtom = jotai.atom(null) as jotai.PrimitiveAtom<OnboardingTip>;

    activeAtom!: jotai.Atom<boolean>;

    tipShownThisSession = false;
    writingStatus = false;
    unsubscribe: () => void = null;

    private constructor() {
        this.activeAtom = jotai.atom((get) => get(this.stepAtom) != null);
    }

    static getInstance(): OnboardingModel {
        if (!OnboardingModel.instance) {
            OnboardingModel.instance = new OnboardingModel();
        }
        return OnboardingModel.instance;
    }

    static resetInstance(): void {
        OnboardingModel.instance?.unsubscribe?.();
        OnboardingModel.instance = null;
    }

    init() {
        if (this.unsubscribe != null) {
            return;
        }
        const unsubEvents = subscribeOnboardingEvents((event) => this.handleEvent(event));
        const unsubClient = globalStore.sub(ClientModel.getInstance().clientAtom, () => this.handleClientChange());
        this.unsubscribe = () => {
            unsubEvents();
            unsubClient();
        };
    }

    // Another window finished or set Quick Start aside; this window's run is stale and must not
    // write "active" back over it.
    handleClientChange() {
        if (this.isActive() && !this.writingStatus && getClientMeta()["onboarding:quickstart"] !== "active") {
            globalStore.set(this.stepAtom, null);
        }
    }

    isActive(): boolean {
        return globalStore.get(this.stepAtom) != null;
    }

    getStep(): QuickStartStep {
        return globalStore.get(this.stepAtom);
    }

    getTargetBlockId(): string {
        const target = globalStore.get(this.targetBlockIdAtom);
        if (isTermBlock(target) && isInActiveTab(target)) {
            return target;
        }
        return findTabTermBlockId();
    }

    isCommandAiAvailable(blockId?: string): boolean {
        const vm = getTermViewModel(blockId ?? this.getTargetBlockId());
        if (vm?.commandAiEnabledAtom == null) {
            return true;
        }
        return globalStore.get(vm.commandAiEnabledAtom) !== false;
    }

    start(fromStep?: QuickStartStep) {
        this.init();
        const step = isQuickStartStep(fromStep) && fromStep !== "done" ? fromStep : "command";
        globalStore.set(this.tipAtom, null);
        globalStore.set(this.targetBlockIdAtom, findTabTermBlockId());
        this.setStep(step);
        // started from a modal or the palette, whose button just took focus and went away
        setTimeout(() => this.refocusTarget(), 50);
    }

    // Startup: pick up a Quick Start that was running when the app last quit.
    resumeIfActive() {
        this.init();
        const meta = getClientMeta();
        if (meta["onboarding:quickstart"] !== "active") {
            return;
        }
        const saved = meta["onboarding:quickstartstep"];
        this.start(isQuickStartStep(saved) ? saved : "command");
    }

    setStep(step: QuickStartStep) {
        globalStore.set(this.commandAiOpenedAtom, false);
        globalStore.set(this.stepAtom, step);
        if (step === "done") {
            setClientMeta({ "onboarding:quickstart": "done", "onboarding:quickstartstep": null });
            return;
        }
        this.writeActive(step);
    }

    writeActive(step: QuickStartStep) {
        this.writingStatus = true;
        void setClientMeta({ "onboarding:quickstart": "active", "onboarding:quickstartstep": step }).then(() => {
            this.writingStatus = false;
        });
    }

    advance() {
        const step = this.getStep();
        if (step == null) {
            return;
        }
        this.setStep(nextQuickStartStep(step, { commandAiAvailable: this.isCommandAiAvailable() }));
        // the card's buttons take focus; the next step happens at the prompt
        this.refocusTarget();
    }

    finish() {
        if (this.getStep() !== "done") {
            setClientMeta({ "onboarding:quickstart": "done", "onboarding:quickstartstep": null });
        }
        globalStore.set(this.stepAtom, null);
        this.refocusTarget();
    }

    // "Finish later": the saved step lets the command palette pick up where the user left off.
    dismiss() {
        const step = this.getStep();
        globalStore.set(this.stepAtom, null);
        setClientMeta({ "onboarding:quickstart": "dismissed", "onboarding:quickstartstep": step ?? null });
        this.refocusTarget();
    }

    // Started from the command palette: continue an unfinished run, otherwise start over.
    startFromPalette() {
        const meta = getClientMeta();
        const saved = meta["onboarding:quickstartstep"];
        if (meta["onboarding:quickstart"] !== "done" && isQuickStartStep(saved)) {
            this.start(saved);
            return;
        }
        this.start("command");
    }

    refocusTarget() {
        const blockId = this.getTargetBlockId();
        setTimeout(() => refocusNode(blockId), 10);
    }

    typeTryCommand() {
        const blockId = this.getTargetBlockId();
        const vm = getTermViewModel(blockId);
        const termWrap = vm?.termRef?.current;
        if (termWrap == null) {
            return;
        }
        refocusNode(blockId);
        // a completion menu over the typed command would make Return pick "lsblk"
        vm.completionModel?.suppressAutoFor?.(QuickStartTryCommand);
        termWrap.insertCommand(QuickStartTryCommand);
    }

    openCommandAi() {
        const blockId = this.getTargetBlockId();
        const vm = getTermViewModel(blockId);
        if (vm?.commandAi == null) {
            return;
        }
        refocusNode(blockId);
        if (vm.commandAi.isOpen()) {
            return;
        }
        vm.commandAi.open({ task: "compose", prompt: QuickStartAiPrompt });
    }

    openFiles() {
        const blockId = this.getTargetBlockId();
        const vm = getTermViewModel(blockId);
        if (vm?.openCwdInFiles == null) {
            return;
        }
        vm.openCwdInFiles();
    }

    handleEvent(event: OnboardingEvent) {
        const step = this.getStep();
        if (step != null) {
            this.handleQuickStartEvent(step, event);
            return;
        }
        this.handleTipEvent(event);
    }

    handleQuickStartEvent(step: QuickStartStep, event: OnboardingEvent) {
        if (!isInActiveTab(event.blockId)) {
            return;
        }
        switch (event.type) {
            case "command-done":
                if (step !== "command") {
                    return;
                }
                globalStore.set(this.targetBlockIdAtom, event.blockId);
                this.setStep("blocks");
                return;
            case "commandai-opened":
                if (step !== "commandai") {
                    return;
                }
                globalStore.set(this.targetBlockIdAtom, event.blockId);
                globalStore.set(this.commandAiOpenedAtom, true);
                return;
            case "commandai-applied":
                if (step !== "commandai") {
                    return;
                }
                this.setStep("files");
                return;
            case "cwd-files-opened":
                if (step !== "files") {
                    return;
                }
                this.setStep("done");
                return;
        }
    }

    hasSeenTip(id: OnboardingTipId): boolean {
        const seen = getClientMeta()["onboarding:tips"] ?? [];
        return seen.includes(id);
    }

    canShowTip(id: OnboardingTipId): boolean {
        if (this.tipShownThisSession || globalStore.get(this.tipAtom) != null) {
            return false;
        }
        const meta = getClientMeta();
        // a brand-new user who hasn't finished or set aside Quick Start gets no tips yet
        if (meta["onboarding:quickstart"] === "active") {
            return false;
        }
        return !this.hasSeenTip(id);
    }

    // A tip is only offered here; it counts as seen once its anchor is actually on screen.
    showTip(tip: OnboardingTip) {
        globalStore.set(this.tipAtom, tip);
    }

    markTipShown(id: OnboardingTipId) {
        this.tipShownThisSession = true;
        const seen = getClientMeta()["onboarding:tips"] ?? [];
        if (!seen.includes(id)) {
            setClientMeta({ "onboarding:tips": [...seen, id] });
        }
    }

    dismissTip() {
        globalStore.set(this.tipAtom, null);
    }

    handleTipEvent(event: OnboardingEvent) {
        const tip = globalStore.get(this.tipAtom);
        if (tip != null) {
            const actedOnFix = tip.id === "fix" && event.type === "commandai-opened" && event.blockId === tip.blockId;
            const movedOn = tip.id === "fix" && event.type === "command-done" && event.blockId === tip.blockId;
            if (actedOnFix || movedOn) {
                this.dismissTip();
            }
            return;
        }
        if (event.type === "command-done") {
            if (!isFailedCommandExit(event.exitCode, event.command)) {
                return;
            }
            if (!this.isCommandAiAvailable(event.blockId) || !this.canShowTip("fix")) {
                return;
            }
            this.showTip({ id: "fix", blockId: event.blockId });
            return;
        }
        if (event.type === "connection-ready") {
            if (!this.canShowTip("remote")) {
                return;
            }
            if (document.querySelector(`[data-onboarding="${OnboardingAnchor.WidgetHost}"]`) == null) {
                return;
            }
            this.showTip({ id: "remote", blockId: event.blockId, connection: event.connection });
        }
    }
}
