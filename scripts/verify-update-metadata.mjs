#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const Scope = "verify-update-metadata";
const ScriptDir = path.dirname(fileURLToPath(import.meta.url));
const RepoRoot = path.resolve(ScriptDir, "..");

class MetadataError extends Error {}

function fail(message) {
  throw new MetadataError(`[${Scope}] ${message}`);
}

// Mirrors electron-builder's computeChannelNames() for the generic provider with
// generateUpdatesFilesForAllChannels: a stable build writes latest + beta + alpha metadata.
export function getUpdateChannels(version) {
  const prerelease = version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/)?.[1];
  if (prerelease == null) {
    return ["latest", "beta", "alpha"];
  }
  if (prerelease === "beta") {
    return ["beta", "alpha"];
  }
  return [prerelease];
}

export function getMetadataFileName(channel, platform) {
  return platform === "mac" ? `${channel}-mac.yml` : `${channel}.yml`;
}

function sha512Base64(filePath) {
  return createHash("sha512").update(readFileSync(filePath)).digest("base64");
}

function makeHashCache() {
  const cache = new Map();
  return (filePath) => {
    if (!cache.has(filePath)) {
      cache.set(filePath, sha512Base64(filePath));
    }
    return cache.get(filePath);
  };
}

function verifyMetadataFile(dir, fileName, options, hashFile) {
  const metadataPath = path.join(dir, fileName);
  if (!existsSync(metadataPath)) {
    fail(`missing update metadata ${fileName} in ${dir}`);
  }
  const metadata = YAML.parse(readFileSync(metadataPath, "utf8"));
  if (metadata?.version !== options.version) {
    fail(`${fileName} version expected ${options.version}, got ${metadata?.version}`);
  }
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    fail(`${fileName} lists no update files`);
  }
  for (const file of metadata.files) {
    if (typeof file?.url !== "string" || path.basename(file.url) !== file.url) {
      fail(`${fileName} has an invalid file url: ${file?.url}`);
    }
    if (!file.url.endsWith(options.payloadExtension)) {
      fail(`${fileName} lists ${file.url}, expected only ${options.payloadExtension} update payloads`);
    }
    const payloadPath = path.join(dir, file.url);
    if (!existsSync(payloadPath) || !statSync(payloadPath).isFile()) {
      fail(`${fileName} references ${file.url}, which is not in ${dir}`);
    }
    const actualSize = statSync(payloadPath).size;
    if (file.size !== actualSize) {
      fail(`${fileName} size for ${file.url} is ${file.size}, file is ${actualSize} bytes`);
    }
    if (file.sha512 !== hashFile(payloadPath)) {
      fail(`${fileName} sha512 for ${file.url} does not match the file`);
    }
  }
  const urls = metadata.files.map((file) => file.url);
  for (const requiredUrl of options.requiredUrls) {
    if (!urls.includes(requiredUrl)) {
      fail(`${fileName} does not list ${requiredUrl}`);
    }
  }
  const primary = metadata.files.find((file) => file.url === metadata.path);
  if (primary == null) {
    fail(`${fileName} path ${metadata.path} is not one of its files`);
  }
  if (metadata.sha512 !== primary.sha512) {
    fail(`${fileName} top-level sha512 does not match ${metadata.path}`);
  }
  return metadata.files.map((file) => ({ url: file.url, sha512: file.sha512, size: file.size }));
}

export function verifyUpdateMetadata({ dir, platform, version, productName, requiredArches = [] }) {
  const hashFile = makeHashCache();
  const isMac = platform === "mac";
  const payloadExtension = isMac ? ".zip" : ".exe";
  const payloadPrefix = isMac ? `${productName}-darwin-` : `${productName}-win32-`;
  const payloadSuffix = `-${version}${payloadExtension}`;
  const payloadsInDir = readdirSync(dir).filter(
    (name) => name.startsWith(payloadPrefix) && name.endsWith(payloadSuffix)
  );
  const requiredUrls = [
    ...new Set([...payloadsInDir, ...requiredArches.map((arch) => `${payloadPrefix}${arch}${payloadSuffix}`)]),
  ];
  if (requiredUrls.length === 0) {
    fail(`no ${payloadPrefix}*${payloadSuffix} update payload was found in ${dir}`);
  }
  const channels = getUpdateChannels(version);
  let referenceFiles = null;
  for (const channel of channels) {
    const fileName = getMetadataFileName(channel, platform);
    const files = verifyMetadataFile(dir, fileName, { version, payloadExtension, requiredUrls }, hashFile);
    const serialized = JSON.stringify([...files].sort((left, right) => left.url.localeCompare(right.url)));
    if (referenceFiles != null && serialized !== referenceFiles) {
      fail(`${fileName} lists different update files than ${getMetadataFileName(channels[0], platform)}`);
    }
    referenceFiles = serialized;
    console.log(`[${Scope}] verified ${fileName}: ${files.map((file) => file.url).join(", ")}`);
  }
  return channels;
}

function parseArgs(argv) {
  const options = { dir: null, platforms: [], requiredArches: [] };
  for (let idx = 0; idx < argv.length; idx++) {
    const arg = argv[idx];
    if (arg === "--mac" || arg === "--windows") {
      options.platforms.push(arg === "--mac" ? "mac" : "windows");
      continue;
    }
    if (arg === "--require-arch") {
      options.requiredArches = (argv[++idx] ?? "").split(",").filter(Boolean);
      continue;
    }
    if (arg.startsWith("--")) {
      fail(`unknown option ${arg}`);
    }
    options.dir = arg;
  }
  if (options.platforms.length === 0) {
    options.platforms.push("mac");
  }
  return options;
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(RepoRoot, "package.json"), "utf8"));
  const options = parseArgs(process.argv.slice(2));
  const dir = path.resolve(options.dir || process.env.GENIETERM_BUILD_OUTPUT || "make");
  for (const platform of options.platforms) {
    verifyUpdateMetadata({
      dir,
      platform,
      version: pkg.version,
      productName: pkg.productName,
      requiredArches: platform === "mac" ? options.requiredArches : [],
    });
  }
  console.log(`[${Scope}] all update metadata checks passed`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof MetadataError ? error.message : error);
    process.exit(1);
  }
}
