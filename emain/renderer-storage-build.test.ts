// Copyright 2026, GenieTerm.
// SPDX-License-Identifier: Apache-2.0

import vm from "node:vm";
import { build } from "vite";
import { describe, expect, it, vi } from "vitest";
import { rendererStorageStartup } from "../scripts/renderer-storage-build.mjs";

async function bundle(exports: string, module = "jotai/vanilla/utils") {
    const result = await build({
        configFile: false,
        logLevel: "silent",
        plugins: [
            {
                name: "fixture",
                resolveId: (id) => (id.endsWith("virtual:fixture") ? "\0fixture" : null),
                load: (id) => (id === "\0fixture" ? `export { ${exports} } from '${module}';` : null),
            },
            rendererStorageStartup(),
        ],
        build: { write: false, minify: false, lib: { entry: "virtual:fixture", name: "Fixture", formats: ["iife"] } },
    });
    return (Array.isArray(result) ? result[0] : (result as any)).output[0].code;
}

describe("renderer storage initialization", () => {
    it("does not touch browser storage when importing layout and loading utilities", async () => {
        const code = await bundle("splitAtom, loadable");
        const read = vi.fn(() => {
            throw new Error("startup must not access localStorage");
        });
        const window = Object.defineProperty({}, "localStorage", { get: read });
        const context = vm.createContext({ window });
        vm.runInContext(code, context);
        expect(context.Fixture.splitAtom).toBeTypeOf("function");
        expect(context.Fixture.loadable).toBeTypeOf("function");
        expect(read).not.toHaveBeenCalled();
        expect(code).not.toContain("createJSONStorage");
    });

    it("does not open storage for debug namespaces but supports runtime logging", async () => {
        const code = await bundle("default as debug", "debug");
        const read = vi.fn(() => {
            throw new Error("startup must not access localStorage");
        });
        const context = vm.createContext(Object.defineProperty({ console }, "localStorage", { get: read }));
        vm.runInContext(code, context);
        context.Fixture.debug.enable("genieterm:*");
        expect(context.Fixture.debug("genieterm:test").enabled).toBe(true);
        expect(context.Fixture.debug("other:test").enabled).toBe(false);
        expect(read).not.toHaveBeenCalled();
    });

    it("keeps the initializer and persistence when storage is explicitly imported", async () => {
        const code = await bundle("createJSONStorage, atomWithStorage");
        const values = new Map<string, string>();
        const context = vm.createContext({
            window: {
                localStorage: {
                    getItem: (key: string) => values.get(key),
                    setItem: (key: string, value: string) => values.set(key, value),
                    removeItem: (key: string) => values.delete(key),
                },
            },
        });
        vm.runInContext(code, context);
        const storage = context.Fixture.createJSONStorage();
        storage.setItem("preference", { enabled: true });
        expect(storage.getItem("preference", null)).toEqual({ enabled: true });
        expect(context.Fixture.atomWithStorage).toBeTypeOf("function");
    });
});
