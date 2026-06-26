#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ScriptDir = path.dirname(fileURLToPath(import.meta.url));
const RepoRoot = path.resolve(ScriptDir, "..");
const Pkg = JSON.parse(readFileSync(path.join(RepoRoot, "package.json"), "utf8"));
const OutputDir = path.resolve(process.argv[2] || process.env.GENIETERM_BUILD_OUTPUT || "make");
const ProductName = Pkg.productName;
const AppId = Pkg.build?.appId;
const Version = Pkg.version;

function log(message) {
    console.log(`[verify-package-artifact] ${message}`);
}

function fail(message) {
    console.error(`[verify-package-artifact] failed: ${message}`);
    process.exit(1);
}

function run(command, args) {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    if (result.status !== 0) {
        fail(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
}

function findApps(dir, depth = 0) {
    if (!existsSync(dir) || depth > 5) {
        return [];
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    const apps = [];
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name === `${ProductName}.app`) {
            apps.push(entryPath);
            continue;
        }
        if (entry.isDirectory() && !entry.name.endsWith(".app")) {
            apps.push(...findApps(entryPath, depth + 1));
        }
    }
    return apps;
}

function findZipArtifacts(dir) {
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.endsWith(".zip") && name.includes(ProductName) && name.includes(Version))
        .map((name) => path.join(dir, name));
}

function readPlist(plistPath, key) {
    return run("/usr/libexec/PlistBuddy", ["-c", `Print ${key}`, plistPath]);
}

function verifyFile(pathToCheck, label) {
    if (!existsSync(pathToCheck)) {
        fail(`${label} is missing: ${pathToCheck}`);
    }
    if (!statSync(pathToCheck).isFile()) {
        fail(`${label} is not a file: ${pathToCheck}`);
    }
}

function verifyDirectory(pathToCheck, label) {
    if (!existsSync(pathToCheck)) {
        fail(`${label} is missing: ${pathToCheck}`);
    }
    if (!statSync(pathToCheck).isDirectory()) {
        fail(`${label} is not a directory: ${pathToCheck}`);
    }
}

function verifyHelperBinaries(binDir) {
    const names = readdirSync(binDir);
    const requiredPrefixes = ["wavesrv.", `genie-${Version}-`, `wsh-${Version}-`];
    const isCurrentHelper = (name) => name.startsWith(`genie-${Version}-`) || name.startsWith(`wsh-${Version}-`);
    for (const prefix of requiredPrefixes) {
        if (!names.some((name) => name.startsWith(prefix))) {
            fail(`helper binary matching ${prefix} is missing from ${binDir}`);
        }
    }
    const staleVersionedHelpers = names.filter((name) => /^(genie|wsh)-/.test(name) && !isCurrentHelper(name));
    if (staleVersionedHelpers.length > 0) {
        fail(`stale helper binaries found: ${staleVersionedHelpers.join(", ")}`);
    }
}

function verifyMacApp(appPath) {
    const plistPath = path.join(appPath, "Contents", "Info.plist");
    verifyFile(plistPath, "Info.plist");

    const checks = [
        ["CFBundleName", ProductName],
        ["CFBundleDisplayName", ProductName],
        ["CFBundleExecutable", ProductName],
        ["CFBundleIdentifier", AppId],
        ["CFBundleShortVersionString", Version],
        ["CFBundleVersion", Version],
    ];
    for (const [key, expected] of checks) {
        const actual = readPlist(plistPath, key);
        if (actual !== expected) {
            fail(`${key} expected ${expected}, got ${actual}`);
        }
    }

    verifyFile(path.join(appPath, "Contents", "MacOS", ProductName), "macOS app executable");
    verifyFile(path.join(appPath, "Contents", "Resources", "app.asar"), "Electron app archive");
    const binDir = path.join(appPath, "Contents", "Resources", "app.asar.unpacked", "dist", "bin");
    verifyDirectory(binDir, "unpacked helper binary directory");
    verifyHelperBinaries(binDir);
    run("codesign", ["--verify", "--deep", "--strict", appPath]);
}

function main() {
    if (process.platform !== "darwin") {
        fail("package artifact verification is currently implemented for macOS only");
    }
    verifyDirectory(OutputDir, "package output directory");
    const apps = findApps(OutputDir);
    if (apps.length === 0) {
        fail(`no ${ProductName}.app was found under ${OutputDir}`);
    }
    const zips = findZipArtifacts(OutputDir);
    if (zips.length === 0) {
        fail(`no ${ProductName} ${Version} zip artifact was found under ${OutputDir}`);
    }
    for (const appPath of apps) {
        verifyMacApp(appPath);
        log(`verified ${path.relative(OutputDir, appPath)}`);
    }
    for (const zipPath of zips) {
        log(`found ${path.relative(OutputDir, zipPath)}`);
    }
    log("all package artifact checks passed");
}

main();
