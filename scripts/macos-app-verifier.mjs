import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ScriptDir = path.dirname(fileURLToPath(import.meta.url));
const RepoRoot = path.resolve(ScriptDir, "..");
const Pkg = JSON.parse(readFileSync(path.join(RepoRoot, "package.json"), "utf8"));

export const MacAppExpectations = {
  productName: Pkg.productName,
  appId: Pkg.build?.appId,
  version: Pkg.version,
};

export function fail(scope, message) {
  console.error(`[${scope}] failed: ${message}`);
  process.exit(1);
}

export function run(scope, command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    fail(scope, `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

export function readPlist(scope, plistPath, key) {
  return run(scope, "/usr/libexec/PlistBuddy", ["-c", `Print ${key}`, plistPath]);
}

export function verifyFile(scope, pathToCheck, label) {
  if (!existsSync(pathToCheck)) {
    fail(scope, `${label} is missing: ${pathToCheck}`);
  }
  if (!statSync(pathToCheck).isFile()) {
    fail(scope, `${label} is not a file: ${pathToCheck}`);
  }
}

export function verifyDirectory(scope, pathToCheck, label) {
  if (!existsSync(pathToCheck)) {
    fail(scope, `${label} is missing: ${pathToCheck}`);
  }
  if (!statSync(pathToCheck).isDirectory()) {
    fail(scope, `${label} is not a directory: ${pathToCheck}`);
  }
}

export function verifyHelperBinaries(scope, binDir) {
  const names = readdirSync(binDir);
  const { version } = MacAppExpectations;
  const requiredPrefixes = ["wavesrv.", `genie-${version}-`, `wsh-${version}-`];
  const isCurrentHelper = (name) => name.startsWith(`genie-${version}-`) || name.startsWith(`wsh-${version}-`);
  for (const prefix of requiredPrefixes) {
    if (!names.some((name) => name.startsWith(prefix))) {
      fail(scope, `helper binary matching ${prefix} is missing from ${binDir}`);
    }
  }
  const staleVersionedHelpers = names.filter((name) => /^(genie|wsh)-/.test(name) && !isCurrentHelper(name));
  if (staleVersionedHelpers.length > 0) {
    fail(scope, `stale helper binaries found: ${staleVersionedHelpers.join(", ")}`);
  }
}

export function verifyMacAppBundle(scope, appPath) {
  const { appId, productName, version } = MacAppExpectations;
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  verifyFile(scope, plistPath, "Info.plist");

  const checks = [
    ["CFBundleName", productName],
    ["CFBundleDisplayName", productName],
    ["CFBundleExecutable", productName],
    ["CFBundleIdentifier", appId],
    ["CFBundleShortVersionString", version],
    ["CFBundleVersion", version],
  ];
  for (const [key, expected] of checks) {
    const actual = readPlist(scope, plistPath, key);
    if (actual !== expected) {
      fail(scope, `${key} expected ${expected}, got ${actual}`);
    }
  }

  verifyFile(scope, path.join(appPath, "Contents", "MacOS", productName), "macOS app executable");
  verifyFile(scope, path.join(appPath, "Contents", "Resources", "app.asar"), "Electron app archive");
  const binDir = path.join(appPath, "Contents", "Resources", "app.asar.unpacked", "dist", "bin");
  verifyDirectory(scope, binDir, "unpacked helper binary directory");
  verifyHelperBinaries(scope, binDir);
  run(scope, "codesign", ["--verify", "--deep", "--strict", appPath]);
}
