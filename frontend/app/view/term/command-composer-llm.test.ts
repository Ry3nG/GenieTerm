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

    it("falls back locally and reports login status when Codex is unavailable", async () => {
        aiCommandCompose.mockResolvedValue({ available: false, text: "" });
        const { LLMCommandComposerBackend } = await import("./command-composer-llm");

        const result = await new LLMCommandComposerBackend().compose("show disk usage", {
            connection: "local",
            cwd: "/repo",
            shell: "zsh",
            os: "Darwin",
            recentCommands: [],
        });

        expect(result.providerStatus).toMatchObject({
            state: "fallback",
            label: "Local fallback",
            detail: "Codex is not signed in",
        });
        expect(result.proposals[0]).toMatchObject({ command: "df -h", source: "local" });
    });
});
