#!/usr/bin/env node

import { spawnSync } from "node:child_process";
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
    if (result.error) {
        console.error(`[v1-gate] failed to start ${command}: ${result.error.message}`);
    }
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

run("TypeScript typecheck", "npm", ["exec", "tsc", "--", "--noEmit"]);
run("Vitest suite", "npm", ["test", "--", "--run"]);
run("Go test suite", "go", ["test", "./..."]);
run("Production build", "npm", ["run", "build:prod"]);
run("Preview build", "npx", ["vite", "build"], { cwd: "frontend/preview" });
run("Preview visual QA", "npm", ["run", "visual:preview"]);
run("Preview interaction QA", "npm", ["run", "interaction:preview"]);

if (shouldPackage) {
    const packageOutput = process.env.GENIETERM_BUILD_OUTPUT || "/private/tmp/genieterm-v1-gate";
    run("macOS arm64 package", "task", ["package", "--", "--mac", "zip", "--arm64"], {
        env: {
            ...process.env,
            GENIETERM_BUILD_OUTPUT: packageOutput,
        },
    });
    run("macOS package artifact verification", "task", ["package:verify", "--", packageOutput]);
}

if (shouldVerifyInstalled) {
    if (!isDarwin) {
        fail("--installed is currently implemented for macOS only");
    }
    run("Installed app verification", "task", ["installed:verify", "--", "--window-smoke"]);
}

console.log("\n[v1-gate] all checks passed");
