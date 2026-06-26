#!/usr/bin/env node

import { _electron } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { PNG } from "pngjs";
import { fail, MacAppExpectations, run, verifyDirectory, verifyMacAppBundle } from "./macos-app-verifier.mjs";

const Scope = "verify-installed-app";
const DefaultAppPath = `/Applications/${MacAppExpectations.productName}.app`;
const shouldLaunchSmoke = process.argv.includes("--launch-smoke");
const shouldWindowSmoke = process.argv.includes("--window-smoke");
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

function assertScreenshotHasContent(buffer) {
    const png = PNG.sync.read(buffer);
    const buckets = new Set();
    let visiblePixels = 0;
    let nonBackgroundPixels = 0;
    for (let idx = 0; idx < png.data.length; idx += 4 * 53) {
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        const a = png.data[idx + 3];
        if (a < 8) {
            continue;
        }
        visiblePixels += 1;
        buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
        if (Math.abs(r - 18) > 8 || Math.abs(g - 18) > 8 || Math.abs(b - 18) > 8) {
            nonBackgroundPixels += 1;
        }
    }
    if (visiblePixels < 500) {
        fail(Scope, "window screenshot has too few visible pixels");
    }
    if (buckets.size < 12) {
        fail(Scope, "window screenshot appears visually blank or monochrome");
    }
    if (nonBackgroundPixels / visiblePixels < 0.04) {
        fail(Scope, "window screenshot has too little foreground content");
    }
}

async function windowSmoke(appPath) {
    const executablePath = path.join(appPath, "Contents", "MacOS", MacAppExpectations.productName);
    const userDataDir = mkdtempSync(path.join(tmpdir(), "genieterm-window-smoke-"));
    let electronApp = null;
    try {
        electronApp = await _electron.launch({
            executablePath,
            args: ["--user-data-dir", userDataDir, "--disable-gpu"],
            timeout: 20000,
        });
        const window = await electronApp.firstWindow({ timeout: 20000 });
        const consoleErrors = [];
        window.on("console", (message) => {
            if (message.type() === "error") {
                consoleErrors.push(message.text());
            }
        });
        window.on("pageerror", (error) => {
            consoleErrors.push(error.message);
        });
        await window.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
        const title = await window.title();
        if (title !== MacAppExpectations.productName) {
            fail(Scope, `window title expected ${MacAppExpectations.productName}, got ${title}`);
        }
        if (!window.url().includes("app.asar")) {
            fail(Scope, `window URL does not point at packaged app content: ${window.url()}`);
        }
        const errorBoundaryCount = await window.getByText("Something went wrong", { exact: false }).count();
        if (errorBoundaryCount > 0) {
            fail(Scope, "window rendered the React error boundary");
        }
        if (consoleErrors.length > 0) {
            fail(Scope, `window console errors: ${consoleErrors.join("\n")}`);
        }
        assertScreenshotHasContent(await window.screenshot({ fullPage: true }));
    } finally {
        if (electronApp) {
            await electronApp.close().catch(() => {});
        }
        rmSync(userDataDir, { recursive: true, force: true });
    }
}

async function main() {
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
    if (shouldWindowSmoke) {
        await windowSmoke(AppPath);
        log("window smoke passed");
    }
    log("all installed app checks passed");
}

await main();
