// Copyright 2026, GenieTerm. Apache-2.0.

import { globalStore } from "@/app/store/jotaiStore";
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
