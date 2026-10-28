// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { CommandAiClient } from "@/app/store/commandai";
import { atoms, getBlockComponentModel, globalPrimaryTabStartup, globalStore } from "@/app/store/global";
import { CommandAiSheetState, formatCommandAiShortcut } from "@/app/view/term/command-composer";
import type { TermViewModel } from "@/app/view/term/term-model";
import { isMacOS } from "@/util/platformutil";
import { cn, useAtomValueSafe } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, offset, Placement, shift, useFloating } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { useEffect, useLayoutEffect, useState } from "react";
import { FeatureTourModel } from "./feature-tour-model";
import { OnboardingAnchor, OnboardingAnchorName, onboardingAnchorSelector } from "./onboarding-events";
import {
    getQuickStartProgress,
    OnboardingModel,
    OnboardingTip,
    QuickStartStep,
    QuickStartTryCommand,
} from "./onboarding-model";
import { Keys } from "./onboarding-tour";

const AnchorPollMs = 250;
const ViewportPadding = 12;

type GuideAction = { label: string; onClick: () => void };

export type GuideCardContent = {
    kind: "quickstart" | "tip";
    title: React.ReactNode;
    body: React.ReactNode;
    primary?: GuideAction;
    secondary?: GuideAction;
    progress?: { index: number; total: number };
};

type GuidePlacement = {
    anchor?: OnboardingAnchorName;
    anchorBlockId?: string;
    placement?: Placement;
    spotlight?: boolean;
    // fallback when the anchor isn't on screen: pin the card inside this block's bottom-right corner
    dockBlockId?: string;
    // spotlight the anchor but keep the card docked, for anchors next to the prompt the card would cover
    detached?: boolean;
    // the prompt is in the lower half, so the top-right corner covers less of what the user is doing
    dockTop?: boolean;
};

function queryVisible(selector: string): HTMLElement {
    if (selector == null) {
        return null;
    }
    const found = document.querySelector<HTMLElement>(selector);
    if (found == null || found.getClientRects().length === 0) {
        return null;
    }
    // cached background tabs are laid out but hidden; their controls still have rects
    if (typeof found.checkVisibility === "function" && !found.checkVisibility({ visibilityProperty: true })) {
        return null;
    }
    return found;
}

const ElementIds = new WeakMap<HTMLElement, number>();
let nextElementId = 1;

function getElementId(elem: HTMLElement): number {
    if (!ElementIds.has(elem)) {
        ElementIds.set(elem, nextElementId++);
    }
    return ElementIds.get(elem);
}

function useAnchorElement(selector: string): HTMLElement {
    const [elem, setElem] = useState<HTMLElement>(() => queryVisible(selector));
    const [lastSelector, setLastSelector] = useState(selector);
    // resolve a changed selector during render, so a step never paints against the previous step's anchor
    if (selector !== lastSelector) {
        setLastSelector(selector);
        setElem(queryVisible(selector));
    }
    useEffect(() => {
        if (selector == null) {
            return;
        }
        const timer = window.setInterval(() => {
            const visible = queryVisible(selector);
            setElem((prev) => (prev === visible ? prev : visible));
        }, AnchorPollMs);
        return () => window.clearInterval(timer);
    }, [selector]);
    return elem;
}

function useElementRect(elem: HTMLElement, probe: HTMLElement): DOMRect {
    const [rect, setRect] = useState<DOMRect>(null);
    useLayoutEffect(() => {
        if (elem == null || probe == null) {
            setRect(null);
            return;
        }
        return autoUpdate(elem, probe, () => setRect(elem.getBoundingClientRect()), { layoutShift: true });
    }, [elem, probe]);
    return rect;
}

function Spotlight({ elem }: { elem: HTMLElement }) {
    const [probe, setProbe] = useState<HTMLDivElement>(null);
    const rect = useElementRect(elem, probe);
    const pad = 3;
    return (
        <div
            ref={setProbe}
            aria-hidden="true"
            className="pointer-events-none fixed z-[400] rounded-lg animate-guide-pulse motion-reduce:animate-none motion-reduce:shadow-[0_0_0_1.5px_var(--color-accent)]"
            style={
                rect == null
                    ? { display: "none" }
                    : {
                          left: rect.left - pad,
                          top: rect.top - pad,
                          width: rect.width + pad * 2,
                          height: rect.height + pad * 2,
                      }
            }
        />
    );
}

function ProgressDots({ index, total }: { index: number; total: number }) {
    return (
        <div className="flex items-center gap-1" role="img" aria-label={`Step ${index} of ${total}`}>
            {Array.from({ length: total }, (_, idx) => (
                <span
                    key={idx}
                    className={cn(
                        "h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none",
                        idx + 1 === index
                            ? "w-4 bg-accent"
                            : idx + 1 < index
                              ? "w-1.5 bg-accent/60"
                              : "w-1.5 bg-foreground/20"
                    )}
                />
            ))}
        </div>
    );
}

export function GuideCard({
    content,
    onClose,
    closeLabel,
}: {
    content: GuideCardContent;
    onClose: () => void;
    closeLabel: string;
}) {
    const isTip = content.kind === "tip";
    return (
        <div
            role="dialog"
            aria-label={isTip ? "Tip" : "Quick Start"}
            className="w-[304px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-modalbg/95 p-4 text-left shadow-[0_18px_48px_-12px_rgba(0,0,0,0.75)] backdrop-blur-md"
        >
            <div className="flex items-center gap-2">
                <i
                    className={cn("fa-solid text-[11px] text-accent", isTip ? "fa-lightbulb" : "fa-compass")}
                    aria-hidden="true"
                />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
                    {isTip ? "Tip" : "Quick Start"}
                </span>
                <div className="flex-1" />
                {content.progress && <ProgressDots {...content.progress} />}
                <button
                    className="-mr-1.5 ml-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground"
                    aria-label={closeLabel}
                    title={closeLabel}
                    onClick={onClose}
                >
                    <i className="fa-solid fa-xmark text-[12px]" aria-hidden="true" />
                </button>
            </div>
            <div key={String(content.title)} className="animate-guide-in motion-reduce:animate-none">
                <div className="mt-2 text-[14px] font-semibold leading-5 text-foreground">{content.title}</div>
                <div className="mt-1 text-pretty text-[13px] leading-5 text-secondary">{content.body}</div>
            </div>
            {(content.primary || content.secondary) && (
                <div className="mt-3.5 flex items-center justify-end gap-1.5">
                    {content.secondary && (
                        <button
                            className="cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] text-muted transition-colors hover:text-foreground"
                            onClick={content.secondary.onClick}
                        >
                            {content.secondary.label}
                        </button>
                    )}
                    {content.primary && (
                        <button
                            className="cursor-pointer rounded-md bg-accent/80 px-3 py-1 text-[12.5px] font-semibold text-primary transition-colors hover:bg-accent"
                            onClick={content.primary.onClick}
                        >
                            {content.primary.label}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function AnchoredCard({
    anchorElem,
    placement,
    children,
}: {
    anchorElem: HTMLElement;
    placement: Placement;
    children: React.ReactNode;
}) {
    const { refs, floatingStyles } = useFloating({
        placement,
        strategy: "fixed",
        elements: { reference: anchorElem },
        whileElementsMounted: (reference, floating, update) =>
            autoUpdate(reference, floating, update, { layoutShift: true }),
        middleware: [offset(10), flip({ padding: ViewportPadding }), shift({ padding: ViewportPadding })],
    });
    return (
        <div ref={refs.setFloating} style={floatingStyles} className="z-[400]">
            {children}
        </div>
    );
}

// Header plus command action bar; docking at the top keeps clear of both.
const DockTopClearance = 112;

function DockedCard({
    dockElem,
    dockTop,
    children,
}: {
    dockElem: HTMLElement;
    dockTop: boolean;
    children: React.ReactNode;
}) {
    const [probe, setProbe] = useState<HTMLDivElement>(null);
    const rect = useElementRect(dockElem, probe);
    const inset = 16;
    let style: React.CSSProperties = { right: ViewportPadding + 8, bottom: ViewportPadding + 8 };
    if (rect != null) {
        const right = Math.max(ViewportPadding, window.innerWidth - rect.right + inset);
        style = dockTop
            ? { right, top: Math.max(ViewportPadding, rect.top + DockTopClearance) }
            : { right, bottom: Math.max(ViewportPadding, window.innerHeight - rect.bottom + inset) };
    }
    return (
        <div ref={setProbe} className="fixed z-[400]" style={style}>
            {children}
        </div>
    );
}

function GuideLayerView({
    content,
    placement,
    onClose,
    closeLabel,
}: {
    content: GuideCardContent;
    placement: GuidePlacement;
    onClose: () => void;
    closeLabel: string;
}) {
    const anchorSelector = placement.anchor
        ? onboardingAnchorSelector(placement.anchor, placement.anchorBlockId)
        : null;
    const anchorElem = useAnchorElement(anchorSelector);
    const dockElem = useAnchorElement(placement.dockBlockId ? `[data-blockid="${placement.dockBlockId}"]` : null);
    const card = <GuideCard content={content} onClose={onClose} closeLabel={closeLabel} />;
    return (
        <FloatingPortal>
            {anchorElem != null && placement.spotlight && <Spotlight elem={anchorElem} />}
            {anchorElem != null && !placement.detached ? (
                <AnchoredCard
                    // floating-ui keeps measuring the first reference; a new anchor needs a fresh instance
                    key={`${getElementId(anchorElem)}:${placement.placement}`}
                    anchorElem={anchorElem}
                    placement={placement.placement ?? "bottom-end"}
                >
                    {card}
                </AnchoredCard>
            ) : (
                <DockedCard dockElem={dockElem} dockTop={placement.dockTop}>
                    {card}
                </DockedCard>
            )}
        </FloatingPortal>
    );
}

function useTick(ms: number, enabled: boolean) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!enabled) {
            return;
        }
        const timer = window.setInterval(() => setTick((tick) => tick + 1), ms);
        return () => window.clearInterval(timer);
    }, [ms, enabled]);
}

function isPromptLow(blockId: string): boolean {
    const terminal = (getBlockComponentModel(blockId)?.viewModel as any)?.termRef?.current?.terminal;
    if (terminal?.buffer?.active == null || !terminal.rows) {
        return false;
    }
    return terminal.buffer.active.cursorY / terminal.rows > 0.5;
}

function isCommandBlocksOff(blockId: string): boolean {
    const termWrap = (getBlockComponentModel(blockId)?.viewModel as any)?.termRef?.current;
    if (termWrap?.shellIntegrationDisabledAtom == null) {
        return false;
    }
    return globalStore.get(termWrap.shellIntegrationDisabledAtom) === true;
}

function Code({ children }: { children: React.ReactNode }) {
    return <code className="rounded bg-hover px-1 py-px font-mono text-[12px] text-foreground">{children}</code>;
}

function NextUpItem({ icon, children }: { icon: string; children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2.5">
            <span className="mt-[2px] flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
                <i className={cn("fa-solid text-[10px]", icon)} aria-hidden="true" />
            </span>
            <span>{children}</span>
        </li>
    );
}

type StepView = { content: GuideCardContent; placement: GuidePlacement };

export type CommandAiSheetPhase = "input" | "pending" | "answered";

export function getCommandAiSheetPhase(sheet: CommandAiSheetState): CommandAiSheetPhase {
    if (sheet?.pending != null) {
        return "pending";
    }
    if (sheet?.exchanges?.at(-1)?.proposals?.length > 0) {
        return "answered";
    }
    return "input";
}

function makeSheetCopy(phase: CommandAiSheetPhase): Pick<GuideCardContent, "title" | "body"> {
    switch (phase) {
        case "pending":
            return {
                title: "Writing a command…",
                body: "This usually takes a few seconds. You'll see the command before anything runs.",
            };
        case "answered":
            return {
                title: "Now put it at your prompt",
                body: (
                    <>
                        Press <Keys combo="↵" /> to insert the highlighted command. It's typed at your prompt, not run,
                        so you can read it first.
                    </>
                ),
            };
        default:
            return {
                title: "Ask in plain words",
                body: (
                    <>
                        Press <Keys combo="↵" /> to send the request, or write your own. Nothing runs until you say so.
                    </>
                ),
            };
    }
}

export function makeQuickStartView(
    step: QuickStartStep,
    opts: {
        model: OnboardingModel;
        targetBlockId: string;
        isMac: boolean;
        typedTry: boolean;
        onTypeTry: () => void;
        commandAiSheetOpen: boolean;
        commandAiNeedsSetup: boolean;
        commandAiPhase: CommandAiSheetPhase;
        commandBlocksOff: boolean;
        cwdLinkVisible: boolean;
        cwdLabel?: string;
    }
): StepView {
    const { model, targetBlockId, isMac } = opts;
    const progress = getQuickStartProgress(step);
    const skip: GuideAction = { label: "Skip", onClick: () => model.advance() };
    const dock = { dockBlockId: targetBlockId };
    switch (step) {
        case "command":
            if (opts.commandBlocksOff) {
                return {
                    content: {
                        kind: "quickstart",
                        progress,
                        title: "Command blocks are off in this shell",
                        body: "This shell doesn't tell GenieTerm where commands start and end. Bash, zsh, fish and PowerShell do.",
                        primary: { label: "Next", onClick: () => model.setStep("commandai") },
                    },
                    placement: dock,
                };
            }
            return {
                content: {
                    kind: "quickstart",
                    progress,
                    title: "Run a command",
                    body: opts.typedTry ? (
                        <>
                            Now press <Keys combo="Return" /> to run it.
                        </>
                    ) : (
                        <>
                            Type any command and press <Keys combo="Return" />. Try <Code>{QuickStartTryCommand}</Code>.
                        </>
                    ),
                    primary: opts.typedTry ? undefined : { label: "Type it for me", onClick: opts.onTypeTry },
                    secondary: skip,
                },
                placement: dock,
            };
        case "blocks":
            return {
                content: {
                    kind: "quickstart",
                    progress,
                    title: "That's a command block",
                    body: "Every command keeps its status, time and output together. Copy it, run it again, or ask AI about it from this bar.",
                    primary: { label: "Next", onClick: () => model.advance() },
                },
                placement: {
                    anchor: OnboardingAnchor.CommandActionBar,
                    anchorBlockId: targetBlockId,
                    placement: "bottom-end",
                    spotlight: true,
                    ...dock,
                },
            };
        case "commandai":
            if (opts.commandAiSheetOpen && opts.commandAiNeedsSetup) {
                return {
                    content: {
                        kind: "quickstart",
                        progress,
                        title: "First, pick your AI",
                        body: "Choose one below. You can change it any time in Settings → Command AI.",
                        secondary: skip,
                    },
                    placement: {
                        anchor: OnboardingAnchor.CommandAiSheet,
                        anchorBlockId: targetBlockId,
                        placement: "top-end",
                        ...dock,
                    },
                };
            }
            if (opts.commandAiSheetOpen) {
                return {
                    content: { kind: "quickstart", progress, ...makeSheetCopy(opts.commandAiPhase), secondary: skip },
                    placement: {
                        anchor: OnboardingAnchor.CommandAiSheet,
                        anchorBlockId: targetBlockId,
                        placement: "top-end",
                        ...dock,
                    },
                };
            }
            return {
                content: {
                    kind: "quickstart",
                    progress,
                    title: "Ask for a command",
                    body: (
                        <>
                            Describe what you want in plain words and get a command to review. Press{" "}
                            <Keys combo={formatCommandAiShortcut(isMac)} /> or click{" "}
                            <i
                                className="fa-solid fa-wand-magic-sparkles text-[11px] text-accent"
                                aria-label="the sparkle"
                            />
                            .
                        </>
                    ),
                    primary: { label: "Try it", onClick: () => model.openCommandAi() },
                    secondary: skip,
                },
                placement: {
                    anchor: OnboardingAnchor.CommandAiButton,
                    anchorBlockId: targetBlockId,
                    placement: "bottom-end",
                    spotlight: true,
                    ...dock,
                },
            };
        case "files":
            if (!opts.cwdLinkVisible) {
                return {
                    content: {
                        kind: "quickstart",
                        progress,
                        title: "Browse this folder",
                        body: "Files shows the folder your terminal is in, on this computer or on a server over SSH.",
                        primary: { label: "Open Files", onClick: () => model.openFiles() },
                        secondary: skip,
                    },
                    placement: dock,
                };
            }
            return {
                content: {
                    kind: "quickstart",
                    progress,
                    title: "Open this folder",
                    body: (
                        <>
                            Click {opts.cwdLabel ? <Code>{opts.cwdLabel}</Code> : "the folder name"} at the top of the
                            terminal to browse it in Files. Over SSH, it opens the server's files.
                        </>
                    ),
                    secondary: skip,
                },
                placement: {
                    anchor: OnboardingAnchor.CwdLink,
                    anchorBlockId: targetBlockId,
                    spotlight: true,
                    detached: true,
                    ...dock,
                },
            };
        case "done":
            return {
                content: {
                    kind: "quickstart",
                    title: "You're all set",
                    body: (
                        <ul className="mt-2 flex flex-col gap-2">
                            <NextUpItem icon="fa-plug">
                                <Keys combo={isMac ? "⌘G" : "Alt+G"} /> connects this terminal to a server from your SSH
                                config.
                            </NextUpItem>
                            <NextUpItem icon="fa-server">
                                Host, in the sidebar, shows a machine's GPUs, processes and ports.
                            </NextUpItem>
                            <NextUpItem icon="fa-compass">
                                Quick Start is in the command palette, <Keys combo={isMac ? "⇧⌘P" : "Alt+Shift+P"} />.
                            </NextUpItem>
                        </ul>
                    ),
                    primary: { label: "Done", onClick: () => model.finish() },
                },
                placement: dock,
            };
    }
}

export function makeTipView(tip: OnboardingTip, model: OnboardingModel): StepView {
    const gotIt: GuideAction = { label: "Got it", onClick: () => model.dismissTip() };
    switch (tip.id) {
        case "fix":
            return {
                content: {
                    kind: "tip",
                    title: "That didn't work",
                    body: (
                        <>
                            <i
                                className="fa-solid fa-wand-magic-sparkles text-[11px] text-accent"
                                aria-label="The sparkle"
                            />{" "}
                            explains what went wrong and suggests a fix. Nothing is sent until you click it.
                        </>
                    ),
                    primary: gotIt,
                },
                placement: {
                    anchor: OnboardingAnchor.BlockAiButton,
                    anchorBlockId: tip.blockId,
                    placement: "bottom-end",
                    spotlight: true,
                },
            };
        case "remote":
            return {
                content: {
                    kind: "tip",
                    title: `Connected to ${tip.connection}`,
                    body: "Files and Host now open on this server. Browse its folders, or see its GPUs, processes and ports.",
                    primary: gotIt,
                },
                placement: { anchor: OnboardingAnchor.WidgetHost, placement: "left", spotlight: true },
            };
    }
}

function QuickStartGuide({ step }: { step: QuickStartStep }) {
    const model = OnboardingModel.getInstance();
    const targetBlockId = useAtomValue(model.targetBlockIdAtom);
    const commandAiOpened = useAtomValue(model.commandAiOpenedAtom);
    const commandAiStatus = useAtomValue(CommandAiClient.getInstance().statusAtom);
    const [typedTry, setTypedTry] = useState(false);
    const sheetElem = useAnchorElement(
        step === "commandai" ? onboardingAnchorSelector(OnboardingAnchor.CommandAiSheet, targetBlockId) : null
    );
    const cwdElem = useAnchorElement(
        step === "files" ? onboardingAnchorSelector(OnboardingAnchor.CwdLink, targetBlockId) : null
    );
    // the prompt moves as output scrolls; re-pick the docking corner now and then
    useTick(1000, true);

    useEffect(() => {
        setTypedTry(false);
    }, [step]);

    const blockId = model.getTargetBlockId();
    const termModel = getBlockComponentModel(blockId)?.viewModel as TermViewModel;
    const sheet = useAtomValueSafe(step === "commandai" ? termModel?.commandAi?.sheetAtom : null);
    const view = makeQuickStartView(step, {
        model,
        targetBlockId: blockId,
        isMac: isMacOS(),
        typedTry,
        onTypeTry: () => {
            model.typeTryCommand();
            setTypedTry(true);
        },
        commandAiSheetOpen: commandAiOpened && sheetElem != null,
        commandAiNeedsSetup: commandAiStatus != null && !commandAiStatus.engine,
        commandAiPhase: getCommandAiSheetPhase(sheet),
        commandBlocksOff: step === "command" && isCommandBlocksOff(blockId),
        cwdLinkVisible: cwdElem != null,
        cwdLabel: cwdElem?.textContent?.replace(/[\u200e\u200f]/g, "").trim(),
    });
    return (
        <GuideLayerView
            content={view.content}
            placement={{ ...view.placement, dockTop: isPromptLow(blockId) }}
            onClose={() => (step === "done" ? model.finish() : model.dismiss())}
            closeLabel={step === "done" ? "Close" : "Finish later"}
        />
    );
}

function TipGuide({ tip }: { tip: OnboardingTip }) {
    const model = OnboardingModel.getInstance();
    const view = makeTipView(tip, model);
    const anchorElem = useAnchorElement(onboardingAnchorSelector(view.placement.anchor, view.placement.anchorBlockId));
    const [everShown, setEverShown] = useState(false);

    useEffect(() => {
        if (anchorElem != null) {
            if (!everShown) {
                setEverShown(true);
                model.markTipShown(tip.id);
            }
            return;
        }
        // never appeared (e.g. classic presentation has no action bar): give up without using the tip;
        // went away (another command took over the bar): a stale tip only confuses
        const timer = window.setTimeout(() => model.dismissTip(), everShown ? 1500 : 3000);
        return () => window.clearTimeout(timer);
    }, [anchorElem, everShown]);

    if (anchorElem == null) {
        return null;
    }
    return (
        <GuideLayerView
            content={view.content}
            placement={view.placement}
            onClose={() => model.dismissTip()}
            closeLabel="Close tip"
        />
    );
}

export function OnboardingGuideLayer() {
    const model = OnboardingModel.getInstance();
    const step = useAtomValue(model.stepAtom);
    const tip = useAtomValue(model.tipAtom);
    const modalOpen = useAtomValue(atoms.modalOpen);
    const featureStep = useAtomValue(FeatureTourModel.getInstance().stepAtom);

    useEffect(() => {
        model.init();
        if (globalPrimaryTabStartup) {
            model.resumeIfActive();
        }
    }, []);

    if (modalOpen || featureStep != null) {
        return null;
    }
    if (step != null) {
        return <QuickStartGuide step={step} />;
    }
    if (tip != null) {
        return <TipGuide tip={tip} />;
    }
    return null;
}
