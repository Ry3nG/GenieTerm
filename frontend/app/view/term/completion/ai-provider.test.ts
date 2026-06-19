// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { CommandComposerBackend, CommandProposal } from "../command-composer";
import { makeAICompletionProvider } from "./ai-provider";
import type { CompletionContext } from "./types";

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
    return {
        inputText: "show disk usage",
        cursorIndex: 15,
        tokens: [
            { text: "show", start: 0, end: 4 },
            { text: "disk", start: 5, end: 9 },
            { text: "usage", start: 10, end: 15 },
        ],
        searchTerm: "usage",
        tokenIndex: 2,
        tokenType: "argument",
        cwd: "/repo",
        connId: "",
        shellType: "zsh",
        env: {},
        recentCommands: ["git status"],
        requestKind: "manual",
        ...overrides,
    };
}

function makeProposal(overrides: Partial<CommandProposal> = {}): CommandProposal {
    return {
        id: "cmd-1",
        command: "df -h",
        explanation: "Show disk usage.",
        target: "local:/repo",
        risk: { label: "low", reasons: [], requiresConfirmation: false },
        source: "model",
        ...overrides,
    };
}

function backend(proposals: CommandProposal[]): { backend: CommandComposerBackend; calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        backend: {
            compose: async (prompt) => {
                calls.push(prompt);
                return {
                    proposals,
                    providerStatus: { state: "codex", label: "Codex", detail: "Using Codex" },
                };
            },
        },
    };
}

describe("makeAICompletionProvider", () => {
    it("does not call the backend for automatic completion requests", async () => {
        const { backend: fakeBackend, calls } = backend([makeProposal()]);
        const provider = makeAICompletionProvider(fakeBackend);

        await expect(provider.provideCompletions(makeContext({ requestKind: "auto" }))).resolves.toEqual([]);
        expect(calls).toEqual([]);
    });

    it("maps safe manual proposals to full-line replacement items", async () => {
        const { backend: fakeBackend } = backend([makeProposal()]);
        const provider = makeAICompletionProvider(fakeBackend);

        await expect(provider.provideCompletions(makeContext())).resolves.toMatchObject([
            {
                label: "df -h",
                insertText: "df -h",
                kind: "ai",
                detail: "Codex: Show disk usage.",
                replaceStart: 0,
                replaceEnd: 15,
            },
        ]);
    });

    it("filters risky proposals and local echo fallback proposals", async () => {
        const { backend: fakeBackend } = backend([
            makeProposal({
                command: "rm -rf node_modules",
                risk: { label: "destructive", reasons: ["rm"], requiresConfirmation: true },
            }),
            makeProposal({ command: "echo 'show disk usage'", source: "local" }),
            makeProposal({ command: "df -h" }),
        ]);
        const provider = makeAICompletionProvider(fakeBackend);

        await expect(provider.provideCompletions(makeContext())).resolves.toMatchObject([{ label: "df -h" }]);
    });
});
