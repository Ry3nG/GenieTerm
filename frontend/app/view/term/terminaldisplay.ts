// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type TerminalPresentationMode = "semantic" | "classic";

export const DefaultTerminalPresentationMode: TerminalPresentationMode = "semantic";

export function normalizeTerminalPresentationMode(value: unknown): TerminalPresentationMode {
    if (value === "classic") {
        return "classic";
    }
    return DefaultTerminalPresentationMode;
}

export function shouldShowSemanticTerminal(value: unknown): boolean {
    return normalizeTerminalPresentationMode(value) === "semantic";
}

export function getTerminalPresentationClassName(value: unknown): string {
    return `term-presentation-${normalizeTerminalPresentationMode(value)}`;
}
