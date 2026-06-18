// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const AppDir = resolve(__dirname, "..");

function readAppFile(path: string): string {
    return readFileSync(resolve(AppDir, path), "utf8");
}

describe("Wave AI chat retirement", () => {
    it("removes the Wave AI chat panel from the primary workspace layout", () => {
        const workspace = readAppFile("workspace/workspace.tsx");

        expect(workspace).not.toContain("@/app/aipanel/aipanel");
        expect(workspace).not.toContain("<AIPanel");
        expect(workspace).not.toContain("aiPanelRef");
    });

    it("removes the Wave AI toggle from tab bars", () => {
        const tabBar = readAppFile("tab/tabbar.tsx");
        const vtabBar = readAppFile("tab/vtabbar.tsx");

        expect(tabBar).not.toContain("WaveAIButton");
        expect(vtabBar).not.toContain("VTabBarAIButton");
        expect(tabBar).not.toContain("Toggle GenieTerm AI Panel");
        expect(vtabBar).not.toContain("Toggle GenieTerm AI Panel");
    });

    it("removes Wave AI chat focus and keybinding entrypoints from the app shell", () => {
        const keymodel = readAppFile("store/keymodel.ts");
        const focusManager = readAppFile("store/focusManager.ts");
        const app = readAppFile("app.tsx");
        const tabClient = readAppFile("store/tabrpcclient.ts");

        expect(keymodel).not.toContain("WaveAIModel");
        expect(keymodel).not.toContain("ai:toggle-panel");
        expect(keymodel).not.toContain("ai:focus");
        expect(focusManager).not.toContain("waveai");
        expect(app).not.toContain("setWaveAIFocused");
        expect(tabClient).not.toContain("WaveAIModel");
        expect(tabClient).not.toContain("setAIPanelVisible");
    });

    it("removes visible builder and terminal actions that send context to Wave AI chat", () => {
        const builderWorkspace = readAppFile("../builder/builder-workspace.tsx");
        const builderBuildPanel = readAppFile("../builder/builder-buildpanel.tsx");
        const builderPreviewTab = readAppFile("../builder/tabs/builder-previewtab.tsx");
        const termModel = readAppFile("view/term/term-model.ts");

        expect(builderWorkspace).not.toContain("@/app/aipanel/aipanel");
        expect(builderWorkspace).not.toContain("<AIPanel");
        expect(builderBuildPanel).not.toContain("WaveAIModel");
        expect(builderBuildPanel).not.toContain("Send Output to AI");
        expect(builderBuildPanel).not.toContain("Add to Context");
        expect(builderPreviewTab).not.toContain("WaveAIModel");
        expect(builderPreviewTab).not.toContain("Ask AI to Fix");
        expect(builderPreviewTab).not.toContain("Add Error to AI Context");
        expect(termModel).not.toContain("Send to GenieTerm AI");
    });
});
