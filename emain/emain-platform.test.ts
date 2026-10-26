// Copyright 2026, GenieTerm. Apache-2.0.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
    app: { isPackaged: true, setName: vi.fn(), getPath: () => "" },
    dialog: { showMessageBoxSync: vi.fn() },
    ipcMain: { on: vi.fn() },
}));

import { getWaveDataDir, getWaveSrvCwd } from "./emain-platform";

describe("backend working directory", () => {
    let profileRoot: string;

    beforeEach(() => {
        profileRoot = mkdtempSync(path.join(os.tmpdir(), "genieterm-cwd-"));
        vi.stubEnv("WAVETERM_HOME", path.join(profileRoot, "unused-legacy-home"));
        vi.stubEnv("WAVETERM_DATA_HOME", profileRoot);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        rmSync(profileRoot, { recursive: true, force: true });
    });

    it("keeps the profile identifier unchanged and adapts only the process working directory", () => {
        expect(getWaveDataDir()).toBe(profileRoot);
        expect(getWaveSrvCwd()).toBe(process.platform === "win32" ? path.toNamespacedPath(profileRoot) : profileRoot);
    });

    it.skipIf(process.platform !== "win32")("starts a native process inside a long Unicode profile", () => {
        const dataDir = path.join(
            profileRoot,
            ...Array.from({ length: 6 }, (_, index) => `profile 设置 ${index} ${"long-path-".repeat(6)}`),
            "data"
        );
        vi.stubEnv("WAVETERM_DATA_HOME", dataDir);
        expect(dataDir.length).toBeGreaterThan(400);
        const output = execFileSync(
            process.execPath,
            [
                "-e",
                'require("node:fs").writeFileSync("server-started.txt", process.cwd()); process.stdout.write("started");',
            ],
            { cwd: getWaveSrvCwd(), windowsHide: true, encoding: "utf8", timeout: 10000 }
        );
        expect(output).toBe("started");
        expect(realpathSync.native(readFileSync(path.join(dataDir, "server-started.txt"), "utf8"))).toBe(
            realpathSync.native(dataDir)
        );
        expect(getWaveDataDir()).toBe(dataDir);
    });
});
