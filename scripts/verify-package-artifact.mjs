#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fail, MacAppExpectations, verifyDirectory, verifyMacAppBundle } from "./macos-app-verifier.mjs";

const OutputDir = path.resolve(process.argv[2] || process.env.GENIETERM_BUILD_OUTPUT || "make");
const Scope = "verify-package-artifact";
const { productName: ProductName, version: Version } = MacAppExpectations;

function log(message) {
    console.log(`[verify-package-artifact] ${message}`);
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

function main() {
    if (process.platform !== "darwin") {
        fail(Scope, "package artifact verification is currently implemented for macOS only");
    }
    verifyDirectory(Scope, OutputDir, "package output directory");
    const apps = findApps(OutputDir);
    if (apps.length === 0) {
        fail(Scope, `no ${ProductName}.app was found under ${OutputDir}`);
    }
    const zips = findZipArtifacts(OutputDir);
    if (zips.length === 0) {
        fail(Scope, `no ${ProductName} ${Version} zip artifact was found under ${OutputDir}`);
    }
    for (const appPath of apps) {
        verifyMacAppBundle(Scope, appPath);
        log(`verified ${path.relative(OutputDir, appPath)}`);
    }
    for (const zipPath of zips) {
        log(`found ${path.relative(OutputDir, zipPath)}`);
    }
    log("all package artifact checks passed");
}

main();
