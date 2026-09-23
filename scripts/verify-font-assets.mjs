#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const CssDir = path.resolve("public/fontawesome/css");
const missing = [];
let checked = 0;

for (const name of readdirSync(CssDir).filter((entry) => entry.endsWith(".css"))) {
  const cssPath = path.join(CssDir, name);
  const css = readFileSync(cssPath, "utf8");
  for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
    const reference = match[1]
      .trim()
      .replace(/^["']|["']$/g, "")
      .split(/[?#]/, 1)[0];
    if (
      !reference ||
      reference.startsWith("data:") ||
      reference.startsWith("http:") ||
      reference.startsWith("https:")
    ) {
      continue;
    }
    checked += 1;
    if (!existsSync(path.resolve(CssDir, reference))) {
      missing.push(`${name}: ${reference}`);
    }
  }
}

if (missing.length > 0) {
  throw new Error(`Font Awesome CSS references missing assets:\n${missing.join("\n")}`);
}

console.log(`[verify-font-assets] ${checked} local font references exist`);
