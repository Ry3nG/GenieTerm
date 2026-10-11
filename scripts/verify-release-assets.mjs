#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getMetadataFileName, getUpdateChannels, verifyUpdateMetadata } from "./verify-update-metadata.mjs";

const Scope = "verify-release-assets";
const ScriptDir = path.dirname(fileURLToPath(import.meta.url));
const RepoRoot = path.resolve(ScriptDir, "..");

function fail(message) {
  console.error(`[${Scope}] failed: ${message}`);
  process.exit(1);
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

export function getExpectedReleaseAssets({ productName, version, includeWindows }) {
  const channels = getUpdateChannels(version);
  const required = [
    `${productName}-darwin-arm64-${version}.dmg`,
    `${productName}-darwin-x64-${version}.dmg`,
    `${productName}-darwin-arm64-${version}.zip`,
    `${productName}-darwin-x64-${version}.zip`,
    ...channels.map((channel) => getMetadataFileName(channel, "mac")),
    ...["x64", "arm64"].flatMap((arch) => [
      `${productName}-linux-${arch}-${version}.AppImage`,
      `${productName}-linux-${arch}-${version}.deb`,
      ...channels.map((channel) => getMetadataFileName(channel, "linux", arch)),
    ]),
  ];
  if (includeWindows) {
    required.push(
      `${productName}-win32-x64-${version}.exe`,
      `${productName}-win32-x64-${version}.zip`,
      ...channels.map((channel) => getMetadataFileName(channel, "windows"))
    );
  }
  const optional = required.filter((name) => /\.(dmg|zip|exe|AppImage)$/.test(name)).map((name) => `${name}.blockmap`);
  return { channels, required, optional };
}

function main() {
  const args = process.argv.slice(2);
  const includeWindows = args.includes("--windows");
  const versionIndex = args.indexOf("--version");
  const positional = args.filter((arg, idx) => !arg.startsWith("--") && (versionIndex < 0 || idx !== versionIndex + 1));
  const assetDir = path.resolve(positional[0] ?? "release-artifacts");
  const pkg = JSON.parse(readFileSync(path.join(RepoRoot, "package.json"), "utf8"));
  const productName = pkg.productName;
  const version = versionIndex >= 0 ? args[versionIndex + 1] : pkg.version;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    fail(`invalid release version ${version}`);
  }
  const files = listFiles(assetDir);
  if (files.length === 0) {
    fail(`no release assets were found under ${assetDir}`);
  }

  const byName = new Map();
  for (const filePath of files) {
    const name = path.basename(filePath);
    if (byName.has(name)) {
      fail(`duplicate release asset name ${name}: ${byName.get(name)} and ${filePath}`);
    }
    byName.set(name, filePath);
  }

  const { channels, required, optional } = getExpectedReleaseAssets({ productName, version, includeWindows });
  const missing = required.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    fail(`missing release assets: ${missing.join(", ")}`);
  }
  const allowed = new Set([...required, ...optional]);
  const unexpected = [...byName.keys()].filter((name) => !allowed.has(name));
  if (unexpected.length > 0) {
    fail(
      `unexpected release assets: ${unexpected.join(", ")} (only this version's packages and update metadata are published; Windows assets require a successful Windows build)`
    );
  }

  const platforms = includeWindows ? ["mac", "windows"] : ["mac"];
  for (const platform of platforms) {
    const metadataPath = byName.get(getMetadataFileName(channels[0], platform));
    try {
      verifyUpdateMetadata({
        dir: path.dirname(metadataPath),
        platform,
        version,
        productName,
        requiredArches: platform === "mac" ? ["arm64", "x64"] : ["x64"],
      });
    } catch (error) {
      fail(error.message);
    }
  }
  for (const arch of ["x64", "arm64"]) {
    const metadataPath = byName.get(getMetadataFileName(channels[0], "linux", arch));
    try {
      verifyUpdateMetadata({
        dir: path.dirname(metadataPath),
        platform: "linux",
        version,
        productName,
        requiredArches: [arch],
      });
    } catch (error) {
      fail(error.message);
    }
  }
  console.log(`[${Scope}] channel ${channels[0]}; ${byName.size} assets verified:`);
  for (const name of [...byName.keys()].sort()) {
    console.log(`  ${name}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
