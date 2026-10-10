#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const shouldPackage = args.has("--package");
const shouldVerifyInstalled = args.has("--installed");
const isDarwin = process.platform === "darwin";
const DefaultPackageOutput = "/private/tmp/genieterm-v1-gate";

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
    console.error(`[v1-gate] failed to run ${command}: ${result.error.message}`);
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

function findPackagedApp(dir, depth = 0) {
  if (!existsSync(dir) || depth > 5) {
    return null;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === "GenieTerm.app") {
      return entryPath;
    }
    if (entry.isDirectory() && !entry.name.endsWith(".app")) {
      const nestedApp = findPackagedApp(entryPath, depth + 1);
      if (nestedApp) {
        return nestedApp;
      }
    }
  }
  return null;
}

let packagedAppPath = null;

run("TypeScript typecheck", "npm", ["exec", "tsc", "--", "--noEmit"]);
run("Font asset references", "npm", ["run", "assets:verify"]);
run("Runtime dependency audit", "npm", ["audit", "--omit=dev", "--audit-level=moderate"]);
run("ESLint", "npm", ["run", "lint"]);
run("Format check", "npm", ["run", "format:check"]);
run("Vitest suite", "npm", ["test", "--", "--run"]);
run("Go test suite", "go", ["test", "./..."]);
run("Go vulnerability scan", "go", ["run", "golang.org/x/vuln/cmd/govulncheck@v1.8.0", "./..."]);
run("Production build", "npm", ["run", "build:prod"]);
run("Preview build", "npx", ["vite", "build"], { cwd: "frontend/preview" });
run("Preview visual QA", "npm", ["run", "visual:preview"], { timeout: 6 * 60 * 1000 });
run("Preview interaction QA", "npm", ["run", "interaction:preview"], { timeout: 4 * 60 * 1000 });

if (shouldPackage) {
  const packageOutput = process.env.GENIETERM_BUILD_OUTPUT || DefaultPackageOutput;
  // electron-builder never removes older artifacts, and the artifact check requires every zip to be listed in
  // the update metadata, so start the gate's own output directory empty.
  if (packageOutput === DefaultPackageOutput) {
    rmSync(packageOutput, { recursive: true, force: true });
  }
  run("macOS arm64 package", "task", ["package", "--", "--mac", "zip", "--arm64"], {
    env: {
      ...process.env,
      GENIETERM_BUILD_OUTPUT: packageOutput,
    },
  });
  run("macOS package artifact verification", "task", ["package:verify", "--", packageOutput]);
  packagedAppPath = findPackagedApp(path.resolve(packageOutput));
  if (!packagedAppPath) {
    fail(`no GenieTerm.app was found under ${packageOutput}`);
  }
}

if (shouldVerifyInstalled) {
  if (!isDarwin) {
    fail("--installed is currently implemented for macOS only");
  }
  const installedArgs = packagedAppPath
    ? ["installed:verify", "--", "--window-smoke", packagedAppPath]
    : ["installed:verify", "--", "--window-smoke"];
  run("Installed app verification", "task", installedArgs);
}

console.log("\n[v1-gate] all checks passed");
