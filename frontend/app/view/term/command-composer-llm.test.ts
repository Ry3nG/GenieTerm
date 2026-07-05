// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("LLMCommandComposerBackend", () => {
    let aiCommandCompose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetModules();
        aiCommandCompose = vi.fn();
        vi.doMock("@/app/store/wshclientapi", () => ({
            RpcApi: {
                AiCommandComposeCommand: aiCommandCompose,
            },
        }));
        vi.doMock("@/app/store/wshrpcutil", () => ({
            TabRpcClient: {},
        }));
    });

    it("reports Codex provider status when the Codex composer returns proposals", async () => {
        aiCommandCompose.mockResolvedValue({
            available: true,
            text: JSON.stringify([{ command: "df -h", explanation: "Show disk usage." }]),
        });
        const { LLMCommandComposerBackend } = await import("./command-composer-llm");

        const result = await new LLMCommandComposerBackend().compose("show disk usage", {
            connection: "local",
            cwd: "/repo",
            shell: "zsh",
            os: "Darwin",
            recentCommands: [],
        });

        expect(result.providerStatus).toMatchObject({
            state: "codex",
            label: "Codex",
        });
        expect(result.proposals[0]).toMatchObject({ command: "df -h", source: "model" });
    });

    it("reports Codex OAuth login guidance when Codex is unavailable", async () => {
        aiCommandCompose.mockResolvedValue({
            available: false,
            text: "",
            status: "loginrequired",
            statusdetail: "Sign in with ChatGPT from Codex CLI to enable Command AI.",
            logincommand: "codex login",
            installcommand: "npm install -g @openai/codex",
        });
        const { LLMCommandComposerBackend } = await import("./command-composer-llm");

        const result = await new LLMCommandComposerBackend().compose("show disk usage", {
            connection: "local",
            cwd: "/repo",
            shell: "zsh",
            os: "Darwin",
            recentCommands: [],
        });

        expect(result.providerStatus).toMatchObject({
            state: "error",
            label: "Codex login required",
            reason: "loginrequired",
            detail: "Sign in with ChatGPT from Codex CLI to enable Command AI.",
            actionCommand: "codex login",
        });
        expect(result.proposals).toEqual([]);
    });

    it("does not report missing login when Codex returns no parseable proposals", async () => {
        aiCommandCompose.mockResolvedValue({ available: true, text: "" });
        const { LLMCommandComposerBackend } = await import("./command-composer-llm");

        const result = await new LLMCommandComposerBackend().compose("show disk usage", {
            connection: "local",
            cwd: "/repo",
            shell: "zsh",
            os: "Darwin",
            recentCommands: [],
        });

        expect(result.providerStatus).toMatchObject({
            state: "error",
            reason: "emptyresponse",
            detail: "Codex did not return a usable command suggestion.",
        });
        expect(result.proposals).toEqual([]);
    });

    it("falls back with request failure status when the Codex request throws", async () => {
        aiCommandCompose.mockRejectedValue(new Error("Codex login expired — run `codex` once to refresh"));
        const { LLMCommandComposerBackend } = await import("./command-composer-llm");

        const result = await new LLMCommandComposerBackend().compose("show disk usage", {
            connection: "local",
            cwd: "/repo",
            shell: "zsh",
            os: "Darwin",
            recentCommands: [],
        });

        expect(result.providerStatus).toMatchObject({
            state: "error",
            reason: "requestfailed",
            detail: "Codex login expired — run `codex` once to refresh",
        });
        expect(result.proposals).toEqual([]);
    });
});
