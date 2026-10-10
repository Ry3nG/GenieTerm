// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    getDownloadedUpdateSha512,
    getMacAppBundlePath,
    getMacInstallLocationProblem,
    isDeveloperIdSignature,
    isMacCodeSignatureError,
    MacUpdateInstallerScript,
} from "./mac-update-installer";

describe("mac-update-installer", () => {
    it.skipIf(process.platform === "win32")("resolves the application bundle from its executable", () => {
        expect(getMacAppBundlePath("/Applications/GenieTerm.app/Contents/MacOS/GenieTerm")).toBe(
            "/Applications/GenieTerm.app"
        );
        expect(() => getMacAppBundlePath("/Applications/Other.app/Contents/MacOS/Other")).toThrow(
            "Unexpected macOS application path"
        );
    });

    it("recognizes Squirrel code signature failures", () => {
        expect(isMacCodeSignatureError("Error Domain=SQRLCodeSignatureErrorDomain Code=1")).toBe(true);
        expect(isMacCodeSignatureError("Code signature for GenieTerm.app did not pass validation")).toBe(true);
        expect(isMacCodeSignatureError("net::ERR_INTERNET_DISCONNECTED")).toBe(false);
    });

    it("selects the checksum for the architecture that was downloaded", () => {
        const update = {
            downloadedFile: "/cache/GenieTerm-darwin-arm64-0.4.83.zip",
            files: [
                { url: "GenieTerm-darwin-x64-0.4.83.zip", sha512: "x64-checksum" },
                { url: "GenieTerm-darwin-arm64-0.4.83.zip", sha512: "arm64-checksum" },
            ],
        };
        expect(getDownloadedUpdateSha512(update)).toBe("arm64-checksum");
    });

    it("requires a verified Developer ID signature", () => {
        const details = [
            "Authority=Developer ID Application: GenieTerm (ABC1234567)",
            "TeamIdentifier=ABC1234567",
        ].join("\n");
        expect(isDeveloperIdSignature(0, details)).toBe(true);
        expect(isDeveloperIdSignature(1, details)).toBe(false);
        expect(isDeveloperIdSignature(0, "Signature=adhoc\nTeamIdentifier=not set")).toBe(false);
    });

    it("refuses install locations the helper cannot replace", () => {
        const writable = () => true;
        expect(getMacInstallLocationProblem("/Applications/GenieTerm.app", writable)).toBeNull();
        expect(
            getMacInstallLocationProblem("/private/var/folders/ab/cd/T/AppTranslocation/1234/d/GenieTerm.app", writable)
        ).toContain("App Translocation");
        expect(getMacInstallLocationProblem("/Volumes/GenieTerm/GenieTerm.app", () => false)).toContain("disk image");
        expect(getMacInstallLocationProblem("/Applications/GenieTerm.app", (dir) => dir != "/Applications")).toContain(
            "not writable"
        );
        expect(
            getMacInstallLocationProblem("/Applications/GenieTerm.app", (dir) => dir != "/Applications/GenieTerm.app")
        ).toContain("not writable");
    });
});

describe.skipIf(process.platform !== "darwin")("mac update helper script", () => {
    let workDir: string;
    let currentApp: string;
    let logPath: string;
    let relaunchLog: string;
    let relaunchCmd: string;

    function makeApp(appPath: string, version: string, sign: boolean) {
        fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
        fs.copyFileSync("/usr/bin/true", path.join(appPath, "Contents", "MacOS", "GenieTerm"));
        fs.writeFileSync(
            path.join(appPath, "Contents", "Info.plist"),
            [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<plist version="1.0"><dict>',
                "<key>CFBundleIdentifier</key><string>dev.ry3ng.genieterm</string>",
                `<key>CFBundleShortVersionString</key><string>${version}</string>`,
                "<key>CFBundleExecutable</key><string>GenieTerm</string>",
                "<key>CFBundlePackageType</key><string>APPL</string>",
                "</dict></plist>",
            ].join("\n")
        );
        if (sign) {
            execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "ignore" });
        }
    }

    function makeUpdateZip(version: string, sign: boolean): { zipPath: string; sha512: string } {
        const buildDir = path.join(workDir, `build-${version}`);
        makeApp(path.join(buildDir, "GenieTerm.app"), version, sign);
        const zipPath = path.join(workDir, `GenieTerm-${version}.zip`);
        execFileSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", path.join(buildDir, "GenieTerm.app"), zipPath]);
        const sha512 = createHash("sha512").update(fs.readFileSync(zipPath)).digest("base64");
        return { zipPath, sha512 };
    }

    function runHelper(
        zipPath: string,
        version: string,
        sha512: string,
        parentPid = "0",
        waveSrvPid = "0",
        script = MacUpdateInstallerScript
    ) {
        return spawnSync(
            "/bin/sh",
            [
                "-c",
                script,
                "genieterm-update",
                currentApp,
                zipPath,
                version,
                sha512,
                parentPid,
                waveSrvPid,
                logPath,
                relaunchCmd,
            ],
            { encoding: "utf8", timeout: 60000 }
        );
    }

    function installedVersion(): string {
        return execFileSync(
            "/usr/bin/plutil",
            [
                "-extract",
                "CFBundleShortVersionString",
                "raw",
                "-o",
                "-",
                path.join(currentApp, "Contents", "Info.plist"),
            ],
            { encoding: "utf8" }
        ).trim();
    }

    function relaunches(): string[] {
        if (!fs.existsSync(relaunchLog)) {
            return [];
        }
        return fs.readFileSync(relaunchLog, "utf8").split("\n").filter(Boolean);
    }

    function appParentEntries(): string[] {
        return fs.readdirSync(path.dirname(currentApp)).sort();
    }

    beforeEach(() => {
        workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "genieterm-update-test-")));
        currentApp = path.join(workDir, "Applications", "GenieTerm.app");
        logPath = path.join(workDir, "helper.log");
        relaunchLog = path.join(workDir, "relaunch.log");
        relaunchCmd = path.join(workDir, "relaunch.sh");
        fs.writeFileSync(relaunchCmd, `#!/bin/sh\necho "$1" >> "${relaunchLog}"\n`, { mode: 0o755 });
        makeApp(currentApp, "1.0.0", true);
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    it("swaps in a verified update and relaunches it", () => {
        const update = makeUpdateZip("1.0.1", true);
        const result = runHelper(update.zipPath, "1.0.1", update.sha512);
        expect(result.status).toBe(0);
        expect(installedVersion()).toBe("1.0.1");
        expect(relaunches()).toEqual([currentApp]);
        expect(appParentEntries()).toEqual(["GenieTerm.app"]);
    });

    it("relaunches the original app when the checksum does not match", () => {
        const update = makeUpdateZip("1.0.1", true);
        const wrongSha = createHash("sha512").update("other").digest("base64");
        const result = runHelper(update.zipPath, "1.0.1", wrongSha);
        expect(result.status).toBe(14);
        expect(installedVersion()).toBe("1.0.0");
        expect(relaunches()).toEqual([currentApp]);
        expect(appParentEntries()).toEqual(["GenieTerm.app"]);
    });

    it("rejects an update without a valid code signature", () => {
        const update = makeUpdateZip("1.0.1", false);
        const result = runHelper(update.zipPath, "1.0.1", update.sha512);
        expect(result.status).toBe(18);
        expect(installedVersion()).toBe("1.0.0");
        expect(relaunches()).toEqual([currentApp]);
    });

    it("restores and relaunches the original app when the swap fails midway", () => {
        const update = makeUpdateZip("1.0.1", true);
        const swapStep = '/bin/mv "$new_app" "$current_app"';
        expect(MacUpdateInstallerScript).toContain(swapStep);
        const failingSwap = MacUpdateInstallerScript.replace(swapStep, "/usr/bin/false");
        const result = runHelper(update.zipPath, "1.0.1", update.sha512, "0", "0", failingSwap);
        expect(result.status).toBe(1);
        expect(installedVersion()).toBe("1.0.0");
        expect(relaunches()).toEqual([currentApp]);
        expect(appParentEntries()).toEqual(["GenieTerm.app"]);
    });

    it("rejects an update with an unexpected version", () => {
        const update = makeUpdateZip("1.0.2", true);
        const result = runHelper(update.zipPath, "1.0.1", update.sha512);
        expect(result.status).toBe(17);
        expect(installedVersion()).toBe("1.0.0");
        expect(relaunches()).toEqual([currentApp]);
    });

    it("waits for GenieTerm and wavesrv to exit before swapping", async () => {
        const update = makeUpdateZip("1.0.1", true);
        const fakeWaveSrv = path.join(workDir, "wavesrv.arm64");
        fs.copyFileSync("/bin/sleep", fakeWaveSrv);
        execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", fakeWaveSrv], { stdio: "ignore" });
        const parent = spawn("/bin/sleep", ["0.5"]);
        const waveSrv = spawn(fakeWaveSrv, ["1.5"]);
        const waveSrvExited = new Promise<number>((resolve) => waveSrv.once("exit", () => resolve(Date.now())));
        const helper = spawn(
            "/bin/sh",
            [
                "-c",
                MacUpdateInstallerScript,
                "genieterm-update",
                currentApp,
                update.zipPath,
                "1.0.1",
                update.sha512,
                String(parent.pid),
                String(waveSrv.pid),
                logPath,
                relaunchCmd,
            ],
            { stdio: "ignore" }
        );
        const helperExit = await new Promise<{ code: number; at: number }>((resolve) =>
            helper.once("exit", (code) => resolve({ code, at: Date.now() }))
        );
        expect(helperExit.code).toBe(0);
        expect(helperExit.at).toBeGreaterThanOrEqual(await waveSrvExited);
        expect(installedVersion()).toBe("1.0.1");
    }, 30000);
});
