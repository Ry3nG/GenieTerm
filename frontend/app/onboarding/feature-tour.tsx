// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { cn } from "@/util/util";
import { FloatingPortal } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { FeatureTourModel, FeatureTourStep, FeatureTourSteps } from "./feature-tour-model";

export const FeatureTourContent: Record<
    FeatureTourStep,
    { title: string; body: string; action: string; instruction: string }
> = {
    history: {
        title: "Find a command you already ran",
        body: "Command History searches your last 500 commands across windows by command, host, folder and result.",
        action: "Open command history",
        instruction:
            "Search for a command, then select it. Insert puts it at an idle prompt for you to review; you press Enter to run it. You can reopen this panel with the clock icon in the terminal header.",
    },
    output: {
        title: "Search just one command's output",
        body: "Inspect a fixed snapshot without losing your place in the terminal scrollback.",
        action: "Inspect last output",
        instruction:
            "Run a command first, then open its output here. Use Search to find text, copy the snapshot, or jump back to the original output. The terminal menu also has Inspect Last Command Output.",
    },
    host: {
        title: "Keep remote sessions and services handy",
        body: "Host lists known durable SSH sessions and lets you save named port forwards for services you use often.",
        action: "Open Host",
        instruction:
            "Use Host on an SSH connection to inspect its sessions and Ports. Save a forward for Jupyter or another service; enable automatic restoration only if you want it on each new connection. This button only opens Host.",
    },
    files: {
        title: "Copy or download a selection together",
        body: "Queue multiple files and folders, then follow progress, cancel or retry from the transfer queue.",
        action: "Open Files",
        instruction:
            "Cmd-click (Mac) or Ctrl-click (Windows/Linux) to select files; Shift-click selects a range. Choose Copy to… or Download. Downloads ask for one local destination and let you keep both names or skip existing files. Reopen this tour from the command palette: What's New in GenieTerm 1.6.",
    },
};

export function FeatureTourCard({
    step,
    opened,
    busy,
    error,
    onOpen,
    onMove,
    onClose,
}: {
    step: FeatureTourStep;
    opened: boolean;
    busy: boolean;
    error: string;
    onOpen: () => void;
    onMove: (delta: number) => void;
    onClose: () => void;
}) {
    const index = FeatureTourSteps.indexOf(step);
    const content = FeatureTourContent[step];
    const button =
        "cursor-pointer rounded-md px-2.5 py-1.5 text-xs hover:bg-hover transition-colors disabled:opacity-40";
    return (
        <section
            role="dialog"
            aria-label="What's new in GenieTerm 1.6"
            className="w-[360px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-48px)] overflow-y-auto rounded-xl border border-border bg-modalbg p-4 text-foreground shadow-xl"
        >
            <header className="flex items-center gap-2 text-xs">
                <i className="fa-solid fa-compass text-accent" aria-hidden="true" />
                <span className="font-semibold text-accent">New in GenieTerm 1.6</span>
                <span className="ml-auto text-muted" aria-label={`Step ${index + 1} of ${FeatureTourSteps.length}`}>
                    {index + 1} / {FeatureTourSteps.length}
                </span>
                <button className={button} aria-label="Finish tour later" title="Finish later" onClick={onClose}>
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
            </header>
            <h2 className="mt-3 text-base font-semibold">{content.title}</h2>
            <p className="mt-2 text-sm leading-5 text-secondary">{content.body}</p>
            <p className="mt-3 text-sm leading-5 text-secondary">{content.instruction}</p>
            {error && (
                <p role="alert" className="mt-3 text-xs text-error">
                    {error}
                </p>
            )}
            <footer className="mt-4 flex flex-wrap items-center gap-1.5">
                <button className={button} disabled={index === 0 || busy} onClick={() => onMove(-1)}>
                    Back
                </button>
                <button
                    className={cn(button, "bg-accent/80 text-primary hover:bg-accent")}
                    disabled={busy}
                    onClick={onOpen}
                >
                    {busy ? "Opening…" : content.action}
                </button>
                <button className={cn(button, "ml-auto")} disabled={busy} onClick={() => onMove(1)}>
                    {index === FeatureTourSteps.length - 1 ? "Done" : opened ? "Next" : "Skip"}
                </button>
            </footer>
        </section>
    );
}

export function FeatureTourLayer() {
    const model = FeatureTourModel.getInstance();
    const step = useAtomValue(model.stepAtom);
    const opened = useAtomValue(model.openedAtom);
    const busy = useAtomValue(model.busyAtom);
    const error = useAtomValue(model.errorAtom);
    const modalOpen = useAtomValue(atoms.modalOpen);
    if (!step || modalOpen) return null;
    return (
        <FloatingPortal>
            <div className="fixed bottom-4 left-4 z-[400]">
                <FeatureTourCard
                    step={step}
                    opened={opened}
                    busy={busy}
                    error={error}
                    onOpen={() => void model.openTarget()}
                    onMove={(delta) => model.move(delta)}
                    onClose={() => model.close()}
                />
            </div>
        </FloatingPortal>
    );
}
