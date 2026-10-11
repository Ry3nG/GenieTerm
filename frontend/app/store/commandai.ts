// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

import { createBlock } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";

export type CommandAiEngineId = "codex" | "claude" | "ollama" | "openai" | "anthropic";

export const CommandAiEngineOrder: CommandAiEngineId[] = ["codex", "claude", "ollama", "openai", "anthropic"];

export const CommandAiSecretNames: Partial<Record<CommandAiEngineId, string>> = {
    openai: "COMMANDAI_OPENAI_KEY",
    anthropic: "COMMANDAI_ANTHROPIC_KEY",
};

// CLI engines answer in roughly 5-10 seconds but can take much longer on a slow model;
// the server gives up at 90 s, so the RPC waits a little longer than that.
const RunTimeoutMs = 100000;
const StatusMaxAgeMs = 30000;

export function makeCommandAiRequestId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isCommandAiEngineReady(engine: CommandAiEngineInfo): boolean {
    return engine != null && engine.available && engine.signedin;
}

export class CommandAiClient {
    private static instance: CommandAiClient | null = null;

    statusAtom = jotai.atom(null) as jotai.PrimitiveAtom<CommandAiStatus>;
    statusLoadingAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    statusFetchedAt = 0;
    statusPromise: Promise<CommandAiStatus> = null;

    private constructor() {}

    static getInstance(): CommandAiClient {
        if (!CommandAiClient.instance) {
            CommandAiClient.instance = new CommandAiClient();
        }
        return CommandAiClient.instance;
    }

    static resetInstance(): void {
        CommandAiClient.instance = null;
    }

    async loadStatus(refresh = false): Promise<CommandAiStatus> {
        const cached = globalStore.get(this.statusAtom);
        if (!refresh && cached != null && Date.now() - this.statusFetchedAt < StatusMaxAgeMs) {
            return cached;
        }
        if (this.statusPromise != null && !refresh) {
            return this.statusPromise;
        }
        globalStore.set(this.statusLoadingAtom, true);
        const promise = RpcApi.CommandAiStatusCommand(TabRpcClient, { refresh }, { timeout: 20000 })
            .then((status) => {
                this.statusFetchedAt = Date.now();
                globalStore.set(this.statusAtom, status);
                return status;
            })
            .finally(() => {
                if (this.statusPromise === promise) {
                    this.statusPromise = null;
                }
                globalStore.set(this.statusLoadingAtom, false);
            });
        this.statusPromise = promise;
        return promise;
    }

    invalidateStatus() {
        this.statusFetchedAt = 0;
    }

    run(request: CommandAiRequest): Promise<CommandAiResult> {
        return RpcApi.CommandAiRunCommand(TabRpcClient, request, { timeout: RunTimeoutMs });
    }

    preview(request: CommandAiRequest): Promise<CommandAiPreview> {
        return RpcApi.CommandAiPreviewCommand(TabRpcClient, request, { timeout: 10000 });
    }

    cancel(requestId: string) {
        if (!requestId) {
            return;
        }
        RpcApi.CommandAiCancelCommand(TabRpcClient, requestId, { timeout: 5000 }).catch((e) =>
            console.error("cancel command ai request failed", e)
        );
    }

    listModels(engine: string, baseurl?: string): Promise<CommandAiModels> {
        return RpcApi.CommandAiModelsCommand(TabRpcClient, { engine, baseurl }, { timeout: 15000 });
    }

    // A model or endpoint chosen for one engine means nothing to another, so switching
    // engines clears them.
    async setEngine(engine: CommandAiEngineId) {
        const settings: Record<string, unknown> = {
            "commandai:engine": engine,
            "commandai:model": null,
            "commandai:baseurl": null,
        };
        await RpcApi.SetConfigCommand(TabRpcClient, settings as SettingsType);
        this.invalidateStatus();
        await this.loadStatus(true);
    }
}

export function openCommandAiSettings() {
    fireAndForget(() => createBlock({ meta: { view: "waveconfig", file: "commandai" } }, false, true));
}
