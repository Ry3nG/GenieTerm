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

export function WaveConfigPreview() {
    const baseEnv = useWaveEnv();
    const tabModel = useTabModel();
    const { env, model } = useMemo(() => {
        const files: Record<string, string> = { "settings.json": "{}", "connections.json": "{}" };
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
