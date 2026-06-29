// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RootDir = path.resolve(__dirname, "..");
const SourceDir = path.join(RootDir, "assets", "logo");
const BuildIconsDir = path.join(RootDir, "build", "icons");
const PublicLogosDir = path.join(RootDir, "public", "logos");
const FrontendAssetDir = path.join(RootDir, "frontend", "app", "asset");
const TsunamiPublicDir = path.join(RootDir, "tsunami", "frontend", "public");
const DefaultVariant = "default";
const Variants = {
  default: {
    bgTop: "#171a21",
    bgMid: "#0d1015",
    bgBottom: "#020304",
    rimA: "#3a404b",
    rimB: "#08090c",
    smokeTop: "#f3f6f8",
    smokeMid: "#8f98a5",
    smokeDeep: "#202734",
    highlight: "#ffffff",
    groove: "#66e5ff",
    grooveSoft: "#2fb4d8",
    shadow: "#000000",
  },
  black: {
    bgTop: "#050506",
    bgMid: "#030303",
    bgBottom: "#000000",
    rimA: "#25272c",
    rimB: "#000000",
    smokeTop: "#f4f4f2",
    smokeMid: "#8b8d91",
    smokeDeep: "#17181b",
    highlight: "#ffffff",
    groove: "#cfd4da",
    grooveSoft: "#62666d",
    shadow: "#000000",
  },
  white: {
    bgTop: "#fbfbf8",
    bgMid: "#f0f1f2",
    bgBottom: "#d9dde3",
    rimA: "#ffffff",
    rimB: "#b9c0ca",
    smokeTop: "#6d737d",
    smokeMid: "#2a2e36",
    smokeDeep: "#111318",
    highlight: "#ffffff",
    groove: "#485363",
    grooveSoft: "#9aa4b1",
    shadow: "#87909d",
  },
};

const SmokePath = [
  "M528 768",
  "C477 773 423 751 393 710",
  "C360 665 358 604 391 558",
  "C417 523 459 504 498 483",
  "C548 456 566 418 546 377",
  "C534 352 511 331 482 314",
  "C548 317 605 349 629 397",
  "C655 449 636 509 588 546",
  "C560 568 524 585 497 611",
  "C468 638 462 675 485 704",
  "C508 733 550 740 596 724",
  "C582 750 559 765 528 768Z",
].join(" ");

const GroovePath = [
  "M518 730",
  "C478 708 458 669 474 634",
  "C489 601 524 583 558 560",
  "C604 529 621 487 608 445",
  "C596 407 569 378 531 357",
].join(" ");

const HighlightPath = ["M433 679", "C414 637 425 592 459 562", "C484 540 520 526 548 500"].join(" ");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function logoSvg(variantName, size = 1024) {
  const c = Variants[variantName] ?? Variants[DefaultVariant];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="180" y1="92" x2="850" y2="948" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${c.bgTop}"/>
      <stop offset="0.55" stop-color="${c.bgMid}"/>
      <stop offset="1" stop-color="${c.bgBottom}"/>
    </linearGradient>
    <linearGradient id="rim" x1="196" y1="96" x2="850" y2="924" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${c.rimA}" stop-opacity="0.72"/>
      <stop offset="0.55" stop-color="${c.rimB}" stop-opacity="0.1"/>
      <stop offset="1" stop-color="${c.rimB}" stop-opacity="0.7"/>
    </linearGradient>
    <linearGradient id="smoke" x1="414" y1="306" x2="594" y2="766" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${c.smokeTop}"/>
      <stop offset="0.46" stop-color="${c.smokeMid}"/>
      <stop offset="1" stop-color="${c.smokeDeep}"/>
    </linearGradient>
    <linearGradient id="smokeEdge" x1="398" y1="340" x2="640" y2="744" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${c.highlight}" stop-opacity="0.68"/>
      <stop offset="0.42" stop-color="${c.highlight}" stop-opacity="0.2"/>
      <stop offset="1" stop-color="${c.shadow}" stop-opacity="0.42"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="${c.shadow}" flood-opacity="0.34"/>
    </filter>
    <filter id="innerGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="${c.groove}" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="202" fill="url(#bg)"/>
  <rect x="66" y="66" width="892" height="892" rx="200" fill="none" stroke="url(#rim)" stroke-width="4"/>
  <ellipse cx="512" cy="846" rx="220" ry="34" fill="${c.shadow}" opacity="0.16"/>
  <g filter="url(#softShadow)">
    <path d="${SmokePath}" fill="${c.shadow}" opacity="0.32" transform="translate(0 10)"/>
    <path d="${SmokePath}" fill="url(#smoke)"/>
    <path d="${SmokePath}" fill="none" stroke="url(#smokeEdge)" stroke-width="9" stroke-linejoin="round" opacity="0.72"/>
    <path d="${GroovePath}" fill="none" stroke="${c.grooveSoft}" stroke-width="25" stroke-linecap="round" opacity="0.18"/>
    <path d="${GroovePath}" fill="none" stroke="${c.groove}" stroke-width="10" stroke-linecap="round" opacity="0.42" filter="url(#innerGlow)"/>
    <path d="${HighlightPath}" fill="none" stroke="${c.highlight}" stroke-width="11" stroke-linecap="round" opacity="0.34"/>
  </g>
</svg>
`;
}

async function renderSvg(svg, outPath, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outPath);
}

async function renderVariant(variantName) {
  const svg = logoSvg(variantName);
  const sourceSvgPath = path.join(SourceDir, `genieterm-logo-${variantName}.svg`);
  fs.writeFileSync(sourceSvgPath, svg);

  const isDefault = variantName === DefaultVariant;
  const suffix = isDefault ? "" : `-${variantName}`;
  await renderSvg(svg, path.join(SourceDir, `genieterm-logo${suffix}-1024.png`), 1024);
  await renderSvg(svg, path.join(PublicLogosDir, `genieterm-logo${suffix}.png`), 1024);
  await renderSvg(svg, path.join(PublicLogosDir, `genieterm-logo${suffix}-256.png`), 256);
  await renderSvg(svg, path.join(FrontendAssetDir, `genieterm-logo${suffix}.png`), 512);
  await renderSvg(svg, path.join(TsunamiPublicDir, `genieterm-logo${suffix}-256.png`), 256);

  if (isDefault) {
    await renderSvg(svg, path.join(RootDir, "assets", "genieterm-logo.png"), 1024);
    await renderSvg(svg, path.join(RootDir, "assets", "appicon-windows.png"), 256);
    for (const size of [16, 32, 48, 64, 128, 256, 512]) {
      await renderSvg(svg, path.join(BuildIconsDir, `${size}x${size}.png`), size);
    }
    await renderSvg(svg, path.join(SourceDir, "genieterm-logo-1024.png"), 1024);
  }
}

function makeIco(pngEntries, outPath) {
  const headerSize = 6;
  const entrySize = 16;
  const imageOffset = headerSize + pngEntries.length * entrySize;
  const totalBytes = imageOffset + pngEntries.reduce((sum, entry) => sum + entry.buffer.length, 0);
  const out = Buffer.alloc(totalBytes);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(pngEntries.length, 4);
  let offset = imageOffset;
  pngEntries.forEach((entry, index) => {
    const entryOffset = headerSize + index * entrySize;
    out.writeUInt8(entry.size >= 256 ? 0 : entry.size, entryOffset);
    out.writeUInt8(entry.size >= 256 ? 0 : entry.size, entryOffset + 1);
    out.writeUInt8(0, entryOffset + 2);
    out.writeUInt8(0, entryOffset + 3);
    out.writeUInt16LE(1, entryOffset + 4);
    out.writeUInt16LE(32, entryOffset + 6);
    out.writeUInt32LE(entry.buffer.length, entryOffset + 8);
    out.writeUInt32LE(offset, entryOffset + 12);
    entry.buffer.copy(out, offset);
    offset += entry.buffer.length;
  });
  fs.writeFileSync(outPath, out);
}

async function renderMacIconSet() {
  const svg = logoSvg(DefaultVariant);
  const iconsetDir = path.join(SourceDir, "GenieTerm.iconset");
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  ensureDir(iconsetDir);
  const iconSetEntries = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  for (const [fileName, size] of iconSetEntries) {
    await renderSvg(svg, path.join(iconsetDir, fileName), size);
  }
  childProcess.execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(RootDir, "build", "icon.icns")]);
  fs.rmSync(iconsetDir, { recursive: true, force: true });
}

async function renderWindowsIcon() {
  const svg = logoSvg(DefaultVariant);
  const entries = [];
  for (const size of [16, 32, 48, 64, 128, 256]) {
    const buffer = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
    entries.push({ size, buffer });
  }
  makeIco(entries, path.join(RootDir, "build", "icon.ico"));
}

async function main() {
  for (const dir of [SourceDir, BuildIconsDir, PublicLogosDir, FrontendAssetDir, TsunamiPublicDir]) {
    ensureDir(dir);
  }
  for (const variantName of Object.keys(Variants)) {
    await renderVariant(variantName);
  }
  await renderMacIconSet();
  await renderWindowsIcon();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
