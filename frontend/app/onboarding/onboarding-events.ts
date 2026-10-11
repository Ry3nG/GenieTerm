// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

// Real user actions that Quick Start and the one-time tips react to. The terminal, Command AI
// and Files code emit these; only the onboarding model listens. Emitting is cheap and never
// throws, so call sites don't need to know whether a guide is running.

export type OnboardingEvent =
    | { type: "command-done"; blockId: string; cmdBlockId: string; command: string; exitCode: number }
    | { type: "commandai-opened"; blockId: string }
    | { type: "commandai-applied"; blockId: string; mode: "insert" | "run" }
    | { type: "cwd-files-opened"; blockId: string; filesBlockId: string }
    | { type: "connection-ready"; blockId: string; connection: string };

export type OnboardingEventType = OnboardingEvent["type"];

type Listener = (event: OnboardingEvent) => void;

const Listeners = new Set<Listener>();

export function emitOnboardingEvent(event: OnboardingEvent) {
    for (const listener of Array.from(Listeners)) {
        try {
            listener(event);
        } catch (e) {
            console.error("onboarding listener failed", e);
        }
    }
}

export function subscribeOnboardingEvents(listener: Listener): () => void {
    Listeners.add(listener);
    return () => {
        Listeners.delete(listener);
    };
}

// Stable hooks for the Quick Start card and tips to anchor to. Kept in one place so a renamed
// button can't silently orphan a coach mark.
export const OnboardingAnchor = {
    CommandActionBar: "command-action-bar",
    CommandAiButton: "commandai-button",
    BlockAiButton: "block-ai-button",
    CwdLink: "cwd-link",
    ConnectionButton: "connection-button",
    WidgetFiles: "widget-files",
    WidgetHost: "widget-host",
    CommandAiSheet: "commandai-sheet",
} as const;

export type OnboardingAnchorName = (typeof OnboardingAnchor)[keyof typeof OnboardingAnchor];

export function onboardingAnchorSelector(name: OnboardingAnchorName, blockId?: string): string {
    const anchor = `[data-onboarding="${name}"]`;
    if (blockId == null) {
        return anchor;
    }
    return `[data-blockid="${blockId}"] ${anchor}`;
}
