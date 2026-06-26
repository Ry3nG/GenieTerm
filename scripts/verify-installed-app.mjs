#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fail, MacAppExpectations, run, verifyDirectory, verifyMacAppBundle } from "./macos-app-verifier.mjs";

const Scope = "verify-installed-app";
const DefaultAppPath = `/Applications/${MacAppExpectations.productName}.app`;
const shouldLaunchSmoke = process.argv.includes("--launch-smoke");
const appPathArg = process.argv.find((arg) => arg.endsWith(".app"));
const AppPath = path.resolve(appPathArg || DefaultAppPath);

function log(message) {
    console.log(`[${Scope}] ${message}`);
}

function launchSmoke(appPath) {
    const userDataDir = mkdtempSync(path.join(tmpdir(), "genieterm-installed-smoke-"));
    run(Scope, "open", ["-n", appPath, "--args", "--user-data-dir", userDataDir, "--disable-gpu"]);
    const pids = waitForLaunch(userDataDir);
    for (const pid of pids) {
        try {
            process.kill(Number(pid), "SIGTERM");
        } catch {
            // The app may have exited between pgrep and SIGTERM.
        }
    }
    rmSync(userDataDir, { recursive: true, force: true });
}

function waitForLaunch(userDataDir) {
    const started = Date.now();
    while (Date.now() - started < 15000) {
        const result = spawnSync("pgrep", ["-f", userDataDir], { encoding: "utf8" });
        const pids = result.stdout
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (pids.length > 0) {
            return pids;
        }
        spawnSync("sleep", ["0.25"]);
    }
    fail(Scope, "launch smoke did not observe a running GenieTerm process");
}

function main() {
    if (process.platform !== "darwin") {
        fail(Scope, "installed app verification is currently implemented for macOS only");
    }
    if (!existsSync(AppPath)) {
        fail(Scope, `${AppPath} does not exist`);
    }
    verifyDirectory(Scope, AppPath, "installed app bundle");
    verifyMacAppBundle(Scope, AppPath);
    log(`verified ${AppPath}`);
    if (shouldLaunchSmoke) {
        launchSmoke(AppPath);
        log("launch smoke passed");
    }
    log("all installed app checks passed");
}

main();
