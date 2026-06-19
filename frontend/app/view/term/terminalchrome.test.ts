// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TermDir = resolve(__dirname);

function readTermFile(fileName: string): string {
    return readFileSync(resolve(TermDir, fileName), "utf8");
}

describe("terminal chrome overlap safety", () => {
    it("keeps interactive command chrome out of the xterm grid", () => {
        const termWrap = readTermFile("termwrap.ts");
        const termScss = readTermFile("term.scss");

        expect(termWrap).not.toContain('anchor: "right"');
        expect(termWrap).not.toContain('layer: "top"');
        expect(termWrap).not.toContain("renderCmdDecorationToolbar");
        expect(termWrap).not.toContain("renderInlineAISuggestion");
        expect(termScss).not.toContain(".term-cmdblock-toolbar");
        expect(termScss).not.toContain(".term-cmdblock-inline-ai");
    });

    it("keeps command block backgrounds non-interactive and behind terminal text", () => {
        const termWrap = readTermFile("termwrap.ts");
        const termScss = readTermFile("term.scss");

        expect(termWrap).toContain('layer: "bottom"');
        expect(termWrap).toContain("width: cols");
        expect(termScss).toMatch(/\.term-cmdblock-deco\s*\{[\s\S]*pointer-events:\s*none/);
    });

    it("keeps inline AI chrome in reserved layout space", () => {
        const termView = readTermFile("term.tsx");
        const termScss = readTermFile("term.scss");
        const dockRule = termScss.match(/\.term-inline-ai-dock\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? "";

        expect(termView).toMatch(/<TermCommandActionBar[^>]*\/>\s*<TermInlineAIDock/);
        expect(dockRule).toContain("flex: 0 0 auto");
        expect(dockRule).not.toContain("position: absolute");
        expect(dockRule).not.toContain("position: fixed");
    });

    it("keeps command actions available in reserved layout space", () => {
        const termView = readTermFile("term.tsx");
        const termScss = readTermFile("term.scss");
        const actionBarRule = termScss.match(/\.term-command-action-bar\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? "";

        expect(termView).toContain("const TermCommandActionBar");
        expect(termView).toMatch(/<\/TerminalPresentationShell>\s*<TermCommandActionBar/);
        expect(termView).toContain("Copy command");
        expect(termView).toContain("Copy output");
        expect(termView).toContain("Re-run command");
        expect(termView).toContain("Fix with AI");
        expect(actionBarRule).toContain("flex: 0 0 auto");
        expect(actionBarRule).not.toContain("position: absolute");
        expect(actionBarRule).not.toContain("position: fixed");
    });

    it("wires natural language prompt interception before shell execution", () => {
        const termWrap = readTermFile("termwrap.ts");

        expect(termWrap).toContain("shouldInterceptNaturalLanguagePrompt");
        expect(termWrap).toContain("updateNaturalLanguagePromptInput");
        expect(termWrap).toContain('this.sendDataHandler?.("\\x15")');
        expect(termWrap).toContain("this.onInlineAIRequest?.(prompt");
    });

    it("selects the terminal renderer from the resolved theme palette", () => {
        const termView = readTermFile("term.tsx");

        expect(termView).toContain("shouldUseWebGlRenderer");
        expect(termView).toContain('useWebGl: shouldUseWebGlRenderer(termSettings?.["term:disablewebgl"], termTheme)');
    });

    it("sets terminal color contrast from the resolved theme palette", () => {
        const termView = readTermFile("term.tsx");

        expect(termView).toContain("resolveTermMinimumContrastRatio");
        expect(termView).toContain("minimumContrastRatio: resolveTermMinimumContrastRatio(termTheme)");
    });
});
