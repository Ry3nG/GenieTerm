#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const OutputDir = path.resolve(process.argv[2] || process.env.GENIETERM_BUILD_OUTPUT || "make");
const MetadataPattern = /^(alpha|beta|latest)(-.+)?\.yml$/;

function log(message) {
  console.log(`[normalize-update-metadata] ${message}`);
}

function dedupeFiles(files, isMacMetadata) {
  const seen = new Set();
  const normalized = [];
  for (const file of files) {
    if (isMacMetadata && typeof file?.url === "string" && !file.url.endsWith(".zip")) {
      continue;
    }
    const key = JSON.stringify([file?.url, file?.sha512, file?.size]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(file);
  }
  return normalized;
}

function normalizeFile(filePath) {
  const basename = path.basename(filePath);
  const raw = readFileSync(filePath, "utf8");
  const metadata = YAML.parse(raw);
  if (!metadata || !Array.isArray(metadata.files)) {
    return;
  }

  const isMacMetadata = basename.endsWith("-mac.yml");
  const originalFiles = metadata.files;
  const normalizedFiles = dedupeFiles(originalFiles, isMacMetadata);
  if (normalizedFiles.length === originalFiles.length) {
    return;
  }

  if (normalizedFiles.length === 0) {
    throw new Error(`${basename} has no update files after normalization`);
  }
  metadata.files = normalizedFiles;
  if (isMacMetadata && typeof metadata.path === "string" && !metadata.path.endsWith(".zip")) {
    metadata.path = normalizedFiles[0].url;
    metadata.sha512 = normalizedFiles[0].sha512;
  }
  writeFileSync(filePath, YAML.stringify(metadata), "utf8");
  log(`normalized ${basename}: ${originalFiles.length} files -> ${normalizedFiles.length} files`);
}

function main() {
  if (!existsSync(OutputDir)) {
    log(`output directory does not exist, skipping: ${OutputDir}`);
    return;
  }
  for (const entry of readdirSync(OutputDir, { withFileTypes: true })) {
    if (entry.isFile() && MetadataPattern.test(entry.name)) {
      normalizeFile(path.join(OutputDir, entry.name));
    }
  }
}

main();
