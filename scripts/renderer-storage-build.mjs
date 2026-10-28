// Copyright 2026, GenieTerm. Apache-2.0.

/** @returns {import("vite").Plugin} */
export function rendererStorageStartup() {
  return {
    name: "renderer-storage-startup",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      const moduleId = id.replaceAll("\\", "/");
      if (moduleId.endsWith("/debug/src/browser.js")) {
        // Persisted debug namespaces must not open Chromium's storage database at startup.
        // Runtime debug.enable() and the development server retain their normal behavior.
        return code.replace("exports.storage = localstorage();", "exports.storage = undefined;");
      }
      if (!moduleId.endsWith("/jotai/esm/vanilla/utils.mjs")) return;
      // Jotai 2.9 initializes localStorage even when only splitAtom/loadable are imported.
      // Retain the initializer if storage is used, but let Rollup discard it otherwise.
      return code.replace(
        "const defaultStorage = createJSONStorage();",
        "const defaultStorage = /* @__PURE__ */ createJSONStorage();"
      );
    },
  };
}
