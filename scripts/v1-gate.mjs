#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const shouldPackage = args.has("--package");
const shouldVerifyInstalled = args.has("--installed");
const isDarwin = process.platform === "darwin";

function run(label, command, commandArgs, options = {}) {
    const start = Date.now();
    console.log(`\n[v1-gate] ${label}`);
    console.log(`$ ${[command, ...commandArgs].join(" ")}`);
    const result = spawnSync(command, commandArgs, {
        stdio: "inherit",
        shell: process.platform === "win32",
        ...options,
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (result.status !== 0) {
        console.error(`[v1-gate] failed: ${label} (${elapsed}s)`);
        process.exit(result.status ?? 1);
    }
    console.log(`[v1-gate] passed: ${label} (${elapsed}s)`);
}

function fail(message) {
    console.error(`[v1-gate] failed: ${message}`);
    process.exit(1);
}

function read(command, commandArgs) {
    const result = spawnSync(command, commandArgs, {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    if (result.status !== 0) {
        fail(result.stderr || result.stdout || `${command} failed`);
    }
    return result.stdout.trim();
}

run("TypeScript typecheck", "npm", ["exec", "tsc", "--", "--noEmit"]);
run("Vitest suite", "npm", ["test", "--", "--run"]);
run("Go test suite", "go", ["test", "./..."]);
run("Production build", "npm", ["run", "build:prod"]);
run("Preview build", "task", ["build:preview"]);
run("Preview visual QA", "task", ["visual:preview"]);

if (shouldPackage) {
    run("macOS arm64 package", "task", ["package", "--", "--mac", "zip", "--arm64"], {
        env: {
            ...process.env,
            GENIETERM_BUILD_OUTPUT: process.env.GENIETERM_BUILD_OUTPUT || "/private/tmp/genieterm-v1-gate",
        },
    });
}

if (shouldVerifyInstalled) {
    if (!isDarwin) {
        fail("--installed is currently implemented for macOS only");
    }
    const appPath = "/Applications/GenieTerm.app";
    if (!existsSync(appPath)) {
        fail(`${appPath} does not exist`);
    }
    const pkgVersion = read("node", ["version.cjs"]);
    const appVersion = read("/usr/libexec/PlistBuddy", [
        "-c",
        "Print CFBundleShortVersionString",
        `${appPath}/Contents/Info.plist`,
    ]);
    if (pkgVersion !== appVersion) {
        fail(`installed app version ${appVersion} does not match package version ${pkgVersion}`);
    }
    run("Installed app signature", "codesign", ["--verify", "--deep", "--strict", appPath]);
}

console.log("\n[v1-gate] all checks passed");
