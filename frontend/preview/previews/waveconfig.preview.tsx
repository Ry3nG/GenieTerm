// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { useTabModel } from "@/app/store/tab-model";
import { WaveConfigView } from "@/app/view/waveconfig/waveconfig";
import { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useWaveEnv, WaveEnvContext } from "@/app/waveenv/waveenv";
import { base64ToString, stringToBase64 } from "@/util/util";
import { type PrimitiveAtom } from "jotai";
import { useMemo } from "react";
import { DefaultFullConfig } from "../mock/defaultconfig";
import { makeMockNodeModel } from "../mock/mock-node-model";
import { applyMockEnvOverrides } from "../mock/mockwaveenv";
import { makeMockCommandAiStatus } from "./commandai.preview-util";

export function WaveConfigPreview() {
    const baseEnv = useWaveEnv();
    const tabModel = useTabModel();
    const { env, model } = useMemo(() => {
        const files: Record<string, string> = { "settings.json": "{}", "connections.json": "{}" };
        const secrets: Record<string, string> = {};
        const env = applyMockEnvOverrides(baseEnv, {
            platform: "darwin",
            electron: {
                getConfigDir: () => "/preview-config",
                getAboutModalDetails: () => ({ version: "1.0.0-preview", buildTime: 0 }),
            },
            rpc: {
                FileInfoCommand: async () => ({ notfound: true }),
                FileReadCommand: async (_client, data) => ({
                    data64: stringToBase64(files[data.info.path.split("/").pop()] ?? "{}"),
                }),
                FileWriteCommand: async (_client, data) => {
                    const name = data.info.path.split("/").pop();
                    files[name] = base64ToString(data.data64);
                    if (name === "settings.json") refreshSettings();
                },
                CommandAiStatusCommand: async () =>
                    makeMockCommandAiStatus(JSON.parse(files["settings.json"])["commandai:engine"], secrets),
                CommandAiModelsCommand: async (_client, data) => ({
                    models:
                        data.engine === "anthropic"
                            ? ["claude-haiku-5-5", "claude-sonnet-5-5"]
                            : ["gpt-5.5", "gpt-5.5-mini"],
                }),
                CommandAiRunCommand: async (_client, data) => {
                    await new Promise((resolve) => setTimeout(resolve, 900));
                    return {
                        requestid: data.requestid,
                        status: "ok",
                        durationms: 2140,
                        proposals: [{ command: "pwd", explanation: "Prints the current directory." }],
                    };
                },
                SetSecretsCommand: async (_client, data) => {
                    for (const [key, value] of Object.entries(data)) {
                        if (value == null) delete secrets[key];
                        else secrets[key] = String(value);
                    }
                },
                SetConfigCommand: async (_client, changes) => {
                    const settings = { ...JSON.parse(files["settings.json"]), ...changes };
                    for (const key of Object.keys(settings)) {
                        if (settings[key] == null) delete settings[key];
                    }
                    files["settings.json"] = JSON.stringify(settings, null, 2);
                    refreshSettings();
                },
            },
        });
        function refreshSettings() {
            const configAtom = env.atoms.fullConfigAtom as PrimitiveAtom<FullConfigType>;
            globalStore.set(configAtom, {
                ...globalStore.get(configAtom),
                settings: { ...DefaultFullConfig.settings, ...JSON.parse(files["settings.json"]) },
            });
        }
        const model = new WaveConfigViewModel({
            blockId: "preview-settings",
            nodeModel: makeMockNodeModel({ nodeId: "preview-settings-node", blockId: "preview-settings" }),
            tabModel,
            waveEnv: env,
        });
        return { env, model };
    }, [baseEnv, tabModel]);

    return (
        <WaveEnvContext.Provider value={env}>
            <div className="mx-auto h-[calc(100vh-100px)] min-h-96 w-full max-w-[1100px] overflow-hidden rounded-xl border border-border bg-background">
                <WaveConfigView
                    blockId="preview-settings"
                    model={model}
                    blockRef={{ current: null }}
                    contentRef={{ current: null }}
                />
            </div>
        </WaveEnvContext.Provider>
    );
}
