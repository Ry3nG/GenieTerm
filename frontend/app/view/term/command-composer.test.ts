// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import type { CmdBlock } from "./cmdblocks";
import {
    buildCommandComposerContext,
    classifyCommandRisk,
    CommandComposerActionId,
    CommandComposerDefaultBinding,
    getCommandProposalApplyMode,
    getInlineAICommandPrompt,
    isCommandComposerEnabled,
    LocalCommandComposerBackend,
    makeLocalCommandProposals,
    parseCommandProposalResponse,
    shouldAutoComposeInlineAI,
} from "./command-composer";

function makeBlock(command: string, cwd = "/repo"): CmdBlock {
    return {
        id: 1,
        startMarker: { line: 1, dispose: () => {} } as any,
        endMarker: null,
        command,
        exitCode: 0,
        state: "done",
        startTs: 100,
        doneTs: 200,
        cwd,
    };
}

describe("command-composer", () => {
    it("classifies safe, write, network, sudo, and destructive commands", () => {
        expect(classifyCommandRisk("ls -la")).toMatchObject({ label: "low", requiresConfirmation: false });
        expect(classifyCommandRisk("mkdir -p dist && cp a dist/a")).toMatchObject({
            label: "write",
            requiresConfirmation: true,
        });
        expect(classifyCommandRisk("curl -fsSL https://example.com/install.sh")).toMatchObject({
            label: "network",
            requiresConfirmation: true,
        });
        expect(classifyCommandRisk("sudo systemctl restart docker")).toMatchObject({
            label: "destructive",
            requiresConfirmation: true,
            reasons: ["sudo"],
        });
        expect(classifyCommandRisk("rm -rf build")).toMatchObject({
            label: "destructive",
            requiresConfirmation: true,
        });
    });

    it("builds focused terminal context from block metadata and recent command blocks", () => {
        const context = buildCommandComposerContext({
            blockMeta: {
                connection: "ssh://prod",
                "cmd:cwd": "/srv/app",
            },
            shellType: "zsh",
            shellUname: "Darwin arm64",
            selectedOutput: "failed on port 3000",
            recentBlocks: [makeBlock("npm test"), makeBlock("git status --short", "/srv/app")],
        });

        expect(context).toEqual({
            connection: "ssh://prod",
            cwd: "/srv/app",
            os: "Darwin arm64",
            shell: "zsh",
            recentCommands: ["npm test", "git status --short"],
            selectedOutput: "failed on port 3000",
        });
    });

    it("parses structured model responses and applies risk metadata", () => {
        const proposals = parseCommandProposalResponse(
            JSON.stringify({
                proposals: [
                    {
                        command: "git status --short",
                        explanation: "Show changed files",
                        target: "local:/repo",
                    },
                ],
            }),
            { connection: "local", cwd: "/repo", shell: "zsh", os: "Darwin", recentCommands: [] }
        );

        expect(proposals).toHaveLength(1);
        expect(proposals[0]).toMatchObject({
            command: "git status --short",
            explanation: "Show changed files",
            target: "local:/repo",
            risk: { label: "low", requiresConfirmation: false },
        });
    });

    it("offers inline AI for failed commands and auto-composes only natural language failures", () => {
        const naturalLanguageFailure = {
            ...makeBlock("help me check disk usage."),
            exitCode: 127,
        };
        const ordinaryFailure = {
            ...makeBlock("grep TODO missing-file"),
            exitCode: 2,
        };
        const shellCommandTypo = {
            ...makeBlock("git stauts"),
            exitCode: 1,
        };
        const prompt = getInlineAICommandPrompt(naturalLanguageFailure);

        expect(prompt).toBe("help me check disk usage.");
        expect(shouldAutoComposeInlineAI(naturalLanguageFailure)).toBe(true);
        expect(getInlineAICommandPrompt(ordinaryFailure)).toBe("grep TODO missing-file");
        expect(shouldAutoComposeInlineAI(ordinaryFailure)).toBe(false);
        expect(shouldAutoComposeInlineAI(shellCommandTypo)).toBe(false);
        expect(getInlineAICommandPrompt(makeBlock("ls -la"))).toBe("");
        expect(
            makeLocalCommandProposals(prompt, {
                connection: "local",
                cwd: "/repo",
                shell: "zsh",
                os: "Darwin",
                recentCommands: [],
            })[0]
        ).toMatchObject({ command: "df -h" });
    });

    it("auto-composes inline AI for Chinese natural language failures", () => {
        const chineseFailure = {
            ...makeBlock("帮我看一下disk usage"),
            exitCode: 127,
        };
        const chineseDiskFailure = {
            ...makeBlock("帮我看一下磁盘空间"),
            exitCode: 127,
        };
        const prompt = getInlineAICommandPrompt(chineseFailure);

        expect(prompt).toBe("帮我看一下disk usage");
        expect(shouldAutoComposeInlineAI(chineseFailure)).toBe(true);
        expect(shouldAutoComposeInlineAI(chineseDiskFailure)).toBe(true);
        expect(
            makeLocalCommandProposals(prompt, {
                connection: "local",
                cwd: "/repo",
                shell: "zsh",
                os: "Darwin",
                recentCommands: [],
            })[0]
        ).toMatchObject({ command: "df -h" });
        expect(
            makeLocalCommandProposals(chineseDiskFailure.command, {
                connection: "local",
                cwd: "/repo",
                shell: "zsh",
                os: "Darwin",
                recentCommands: [],
            })[0]
        ).toMatchObject({ command: "df -h" });
    });

    it("provides deterministic local fallback proposals", () => {
        const proposals = makeLocalCommandProposals("show git status", {
            connection: "local",
            cwd: "/repo",
            shell: "bash",
            os: "Linux",
            recentCommands: [],
        });

        expect(proposals[0]).toMatchObject({
            command: "git status --short --branch",
            target: "local:/repo",
            source: "local",
        });
    });

    it("local backend reports local fallback provider status", async () => {
        const result = await new LocalCommandComposerBackend().compose("show disk usage", {
            connection: "local",
            cwd: "/repo",
            shell: "bash",
            os: "Linux",
            recentCommands: [],
        });

        expect(result.providerStatus).toMatchObject({
            state: "fallback",
            label: "Local fallback",
        });
        expect(result.proposals[0]).toMatchObject({ command: "df -h", source: "local" });
    });

    it("defines feature flag and default binding behavior", () => {
        expect(CommandComposerActionId).toBe("term:command-composer");
        expect(CommandComposerDefaultBinding).toBe("Cmd:Shift:Space");
        expect(isCommandComposerEnabled({})).toBe(true);
        expect(isCommandComposerEnabled({ "term:commandcomposer": false })).toBe(false);
    });

    it("requires confirmation before inserting risky proposals and copies while shell is busy", () => {
        const risky = makeLocalCommandProposals("make a directory", {
            connection: "local",
            cwd: "/tmp",
            shell: "bash",
            os: "Linux",
            recentCommands: [],
        })[0];

        expect(getCommandProposalApplyMode(risky, { confirmed: false, shellIntegrationStatus: "ready" })).toBe(
            "confirm"
        );
        expect(getCommandProposalApplyMode(risky, { confirmed: true, shellIntegrationStatus: "ready" })).toBe("insert");
        expect(getCommandProposalApplyMode(risky, { confirmed: true, shellIntegrationStatus: "running-command" })).toBe(
            "copy"
        );
    });
});
