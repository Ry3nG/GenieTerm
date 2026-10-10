// Copyright 2026, GenieTerm. Apache-2.0.

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { stringToBase64 } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { type ConfigFile, WaveConfigViewModel } from "./waveconfig-model";

function makeModel(content: string) {
    const model = Object.create(WaveConfigViewModel.prototype) as WaveConfigViewModel;
    const file: ConfigFile = { name: "Connections", path: "connections.json" };
    model.configDir = "/config";
    model.selectedFileAtom = atom(file);
    model.fileContentAtom = atom(content) as PrimitiveAtom<string>;
    model.originalContentAtom = atom(content);
    model.hasEditedAtom = atom(false);
    model.errorMessageAtom = atom(null) as PrimitiveAtom<string>;
    const readFile = vi.fn(async () => ({ data64: stringToBase64(content) }));
    model.env = { rpc: { FileReadCommand: readFile } } as any;
    return { model, readFile };
}

describe("WaveConfigViewModel disk consistency", () => {
    it("refreshes the Raw JSON baseline after a visual connection save", async () => {
        const before = '{"host":{"display:name":"Old"}}';
        const after = '{"host":{"display:name":"New","conn:wshenabled":true}}';
        const { model, readFile } = makeModel(before);
        readFile.mockResolvedValue({ data64: stringToBase64(after) });

        expect(await model.refreshConnectionsFile(before)).toBe(true);
        expect(globalStore.get(model.fileContentAtom)).toBe(after);
        expect(globalStore.get(model.originalContentAtom)).toBe(after);
        expect(globalStore.get(model.hasEditedAtom)).toBe(false);
    });

    it("preserves local edits and refuses to overwrite a newer disk version", async () => {
        const before = '{"host":{"display:name":"Old"}}';
        const after = '{"host":{"display:name":"New"}}';
        const { model, readFile } = makeModel(before);
        readFile.mockResolvedValue({ data64: stringToBase64(after) });
        globalStore.set(model.fileContentAtom, '{"myedit":true}');

        expect(await model.refreshConnectionsFile(before)).toBe(false);
        expect(globalStore.get(model.fileContentAtom)).toBe('{"myedit":true}');
        expect(globalStore.get(model.hasEditedAtom)).toBe(true);
        await expect(model.assertFileUnchanged({ name: "Connections", path: "connections.json" })).rejects.toThrow(
            "changed on disk"
        );
    });
});

function makeGeneralModel(content = "{}") {
    const { model, readFile } = makeModel(content);
    globalStore.set(model.selectedFileAtom, { name: "General", path: "settings.json" });
    model.isSavingAtom = atom(false);
    model.isLoadingAtom = atom(false);
    model.generalSettingsSaveQueue = Promise.resolve(true);
    model.pendingGeneralSettings = 0;
    const setConfig = vi.fn(async () => {});
    const setIcon = vi.fn();
    model.env.rpc.SetConfigCommand = setConfig;
    model.env.electron = { setAppIconVariant: setIcon } as any;
    return { model, readFile, setConfig, setIcon };
}

describe("General visual settings saves", () => {
    it("serializes consecutive edits without dropping the next control's change", async () => {
        const { model, readFile, setConfig } = makeGeneralModel();
        const settings = {};
        setConfig.mockImplementation(async (...args: unknown[]) => {
            Object.assign(settings, args[1]);
        });
        readFile.mockImplementation(async () => ({ data64: stringToBase64(JSON.stringify(settings)) }));
        const first = model.saveGeneralSetting("term:fontsize", 14);
        const second = model.saveGeneralSetting("term:cursorblink", true);
        expect(globalStore.get(model.isSavingAtom)).toBe(true);
        expect(await Promise.all([first, second])).toEqual([true, true]);
        expect(JSON.parse(globalStore.get(model.fileContentAtom))).toEqual({
            "term:fontsize": 14,
            "term:cursorblink": true,
        });
        expect(setConfig).toHaveBeenCalledTimes(2);
        expect(globalStore.get(model.hasEditedAtom)).toBe(false);
        expect(globalStore.get(model.isSavingAtom)).toBe(false);
    });

    it.each([
        ["term:cursorblink", true],
        ["term:cursorblink", false],
        ["term:fontsize", 14.5],
        ["term:cursor", "bar"],
    ] as const)("saves %s = %j and refreshes the exact disk baseline", async (key, value) => {
        const { model, readFile, setConfig } = makeGeneralModel();
        const diskContent = ` { "${key}": ${JSON.stringify(value)}, "other": true }\n`;
        readFile.mockResolvedValue({ data64: stringToBase64(diskContent) });

        expect(await model.saveGeneralSetting(key, value)).toBe(true);
        expect(setConfig).toHaveBeenCalledWith(TabRpcClient, { [key]: value });
        expect(JSON.parse(globalStore.get(model.fileContentAtom))).toEqual(JSON.parse(diskContent));
        expect(globalStore.get(model.originalContentAtom)).toBe(diskContent);
        expect(globalStore.get(model.hasEditedAtom)).toBe(false);
        expect(globalStore.get(model.isSavingAtom)).toBe(false);
        await expect(model.assertFileUnchanged(globalStore.get(model.selectedFileAtom))).resolves.toBeUndefined();
    });

    it("applies the selected Dock icon after saving", async () => {
        const { model, setIcon } = makeGeneralModel();
        await model.saveGeneralSetting("app:icon", "white");
        expect(setIcon).toHaveBeenCalledWith("white");
    });

    it("removes a cleared font override to restore the default", async () => {
        const { model, readFile, setConfig } = makeGeneralModel('{"term:fontfamily":"Custom"}');
        readFile.mockResolvedValue({ data64: stringToBase64("{}") });
        await model.saveGeneralSetting("term:fontfamily", "");
        expect(setConfig).toHaveBeenCalledWith(TabRpcClient, { "term:fontfamily": null });
        expect(JSON.parse(globalStore.get(model.fileContentAtom))).toEqual({});
    });

    it("keeps buffers untouched on an RPC failure and reports it", async () => {
        const { model, setConfig } = makeGeneralModel();
        setConfig.mockRejectedValue(new Error("offline"));
        expect(await model.saveGeneralSetting("term:cursorblink", true)).toBe(false);
        expect(globalStore.get(model.fileContentAtom)).toBe("{}");
        expect(globalStore.get(model.originalContentAtom)).toBe("{}");
        expect(globalStore.get(model.errorMessageAtom)).toContain("offline");
        expect(globalStore.get(model.isSavingAtom)).toBe(false);
    });

    it("preserves Raw JSON edits made while the visual save is in flight", async () => {
        const { model, readFile } = makeGeneralModel();
        const diskContent = '{"term:fontsize":14}';
        readFile.mockResolvedValue({ data64: stringToBase64(diskContent) });
        const saving = model.saveGeneralSetting("term:fontsize", 14);
        globalStore.set(model.fileContentAtom, '{"term:fontsize":16,"local":true}');
        globalStore.set(model.hasEditedAtom, true);
        await saving;
        expect(globalStore.get(model.fileContentAtom)).toBe('{"term:fontsize":16,"local":true}');
        expect(globalStore.get(model.originalContentAtom)).toBe(diskContent);
        expect(globalStore.get(model.hasEditedAtom)).toBe(true);
    });

    it("does not overwrite a different settings file after navigation", async () => {
        const { model } = makeGeneralModel();
        const saving = model.saveGeneralSetting("term:fontsize", 14);
        globalStore.set(model.selectedFileAtom, { name: "Connections", path: "connections.json" });
        globalStore.set(model.fileContentAtom, '{"host":{}}');
        globalStore.set(model.originalContentAtom, '{"host":{}}');
        await saving;
        expect(globalStore.get(model.fileContentAtom)).toBe('{"host":{}}');
        expect(globalStore.get(model.originalContentAtom)).toBe('{"host":{}}');
    });
});
