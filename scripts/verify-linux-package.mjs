#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { extractFile } from "@electron/asar";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { verifyUpdateMetadata } from "./verify-update-metadata.mjs";

const RepoRoot = fileURLToPath(new URL("../", import.meta.url));
const Pkg = JSON.parse(readFileSync(path.join(RepoRoot, "package.json"), "utf8"));
const UpdateUrl = "https://github.com/Ry3nG/GenieTerm/releases/latest/download/";
const HelperPlatforms = [
  "linux.x64",
  "linux.arm64",
  "linux.mips",
  "linux.mips64",
  "darwin.x64",
  "darwin.arm64",
  "windows.x64.exe",
  "windows.arm64.exe",
];
const DebDependencies = [
  "libgtk-3-0",
  "libnotify4",
  "libnss3",
  "libxss1",
  "libxtst6",
  "xdg-utils",
  "libatspi2.0-0",
  "libuuid1",
  "libsecret-1-0",
  "libgbm1",
  "libasound2t64 | libasound2",
];

function check(condition, message) {
  if (!condition) {
    throw new Error(`[verify-linux-package] ${message}`);
  }
}

function requireFile(file, executable = false) {
  const stat = statSync(file);
  check(stat.isFile() && stat.size > 0, `missing or empty file ${file}`);
  check(!executable || (stat.mode & 0o111) !== 0, `file is not executable: ${file}`);
}

function requireElf(file, arch) {
  requireFile(file, true);
  const bytes = readFileSync(file);
  check(
    bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && bytes[4] === 2 && bytes[5] === 1,
    `not a 64-bit little-endian ELF: ${file}`
  );
  check(bytes.readUInt16LE(18) === (arch === "x64" ? 62 : 183), `wrong ELF architecture for ${arch}: ${file}`);
}

export function verifyLinuxTree(root, arch, pkg = Pkg) {
  check(["x64", "arm64"].includes(arch), `unsupported architecture ${arch}`);
  requireElf(path.join(root, pkg.name), arch);
  requireFile(path.join(root, "chrome-sandbox"), true);
  const resources = path.join(root, "resources");
  const archive = path.join(resources, "app.asar");
  requireFile(archive);
  const packaged = JSON.parse(extractFile(archive, "package.json").toString());
  check(
    packaged.name === pkg.name && packaged.productName === pkg.productName && packaged.version === pkg.version,
    "app.asar package identity/version mismatch"
  );
  const bin = path.join(resources, "app.asar.unpacked", "dist", "bin");
  requireElf(path.join(bin, `wavesrv.${arch}`), arch);
  for (const helper of ["genie", "wsh"]) {
    for (const platform of HelperPlatforms) {
      requireFile(path.join(bin, `${helper}-${pkg.version}-${platform}`), !platform.endsWith(".exe"));
    }
  }
  for (const name of readdirSync(bin)) {
    check(
      !/^(genie|wsh)-/.test(name) || name.startsWith(`genie-${pkg.version}-`) || name.startsWith(`wsh-${pkg.version}-`),
      `stale helper ${name}`
    );
    check(!name.startsWith("wavesrv.") || name === `wavesrv.${arch}`, `unexpected server ${name}`);
  }
}

export function extractAppImage(image, destination) {
  requireFile(image, true);
  execFileSync(path.resolve(image), ["--appimage-extract"], { cwd: destination, stdio: "ignore", timeout: 120000 });
  return path.join(destination, "squashfs-root");
}

export function verifyLinuxDesktop(text, pkg = Pkg) {
  const fields = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
  for (const [key, value] of Object.entries({
    Name: pkg.productName,
    Comment: pkg.description,
    Categories: "Development;TerminalEmulator;System;",
    StartupWMClass: pkg.productName,
    Icon: pkg.name,
  })) {
    check(fields[key] === value, `desktop ${key} expected ${value}, got ${fields[key]}`);
  }
  check(fields.Keywords?.includes("terminal;"), "desktop Keywords missing terminal");
  check(fields.Exec?.includes(`/opt/${pkg.productName}/${pkg.name}`), "desktop Exec has the wrong install path");
  check(!fields.Exec.includes("--no-sandbox"), "desktop must not disable the sandbox");
}

export function verifyDebControl(control, arch, pkg = Pkg) {
  const fields = Object.fromEntries(
    control
      .split(/\r?\n/)
      .filter((line) => /^\s*[A-Za-z-]+:/.test(line))
      .map((line) => {
        const index = line.indexOf(":");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
  for (const [key, value] of Object.entries({
    Package: pkg.name,
    Version: pkg.version.replace(/-/g, "~"),
    Architecture: arch === "x64" ? "amd64" : "arm64",
    Maintainer: `${pkg.author.name} <${pkg.author.email}>`,
    Vendor: pkg.author.name,
    Homepage: pkg.homepage,
    Priority: "optional",
    Section: "devel",
  })) {
    check(fields[key] === value, `deb ${key} expected ${value}, got ${fields[key]}`);
  }
  const depends = (fields.Depends || "").split(",").map((value) =>
    value
      .replace(/\([^)]*\)/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
  for (const dependency of DebDependencies) {
    check(depends.includes(dependency), `deb missing dependency ${dependency}`);
  }
}

export function verifyLinuxPackages({ dir, requiredArches = [process.arch], pkg = Pkg }) {
  const arches = requiredArches.length > 0 ? requiredArches : [process.arch];
  for (const arch of arches) {
    check(["x64", "arm64"].includes(arch), `unsupported architecture ${arch}`);
    const prefix = path.join(dir, `${pkg.productName}-linux-${arch}-${pkg.version}`);
    const temporary = mkdtempSync(path.join(tmpdir(), "genieterm-linux-package-"));
    try {
      const root = extractAppImage(`${prefix}.AppImage`, temporary);
      verifyLinuxTree(root, arch, pkg);
      const update = YAML.parse(readFileSync(path.join(root, "resources", "app-update.yml"), "utf8"));
      // app-update.yml contains provider settings; the version lives in app.asar/package.json.
      check(update.provider === "generic" && update.url === UpdateUrl, "AppImage update feed mismatch");
      const deb = `${prefix}.deb`;
      requireFile(deb);
      verifyDebControl(execFileSync("dpkg-deb", ["-I", deb], { encoding: "utf8" }), arch, pkg);
      const listing = execFileSync("dpkg-deb", ["-c", deb], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      for (const file of [`./opt/${pkg.productName}/${pkg.name}`, `./usr/share/applications/${pkg.name}.desktop`]) {
        check(
          listing.split("\n").some((line) => line.endsWith(` ${file}`)),
          `deb missing ${file}`
        );
      }
      check(listing.includes(`/apps/${pkg.name}.png`), "deb missing hicolor icon");
      const debRoot = path.join(temporary, "deb");
      execFileSync("dpkg-deb", ["-x", deb, debRoot]);
      verifyLinuxTree(path.join(debRoot, "opt", pkg.productName), arch, pkg);
      verifyLinuxDesktop(
        readFileSync(path.join(debRoot, "usr/share/applications", `${pkg.name}.desktop`), "utf8"),
        pkg
      );
      console.log(`[verify-linux-package] verified AppImage and deb for ${arch}`);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  verifyUpdateMetadata({
    dir,
    platform: "linux",
    version: pkg.version,
    productName: pkg.productName,
    requiredArches: arches,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--require-arch");
  const positional = args.filter((arg, idx) => !arg.startsWith("--") && (index < 0 || idx !== index + 1));
  try {
    verifyLinuxPackages({
      dir: path.resolve(positional[0] || process.env.GENIETERM_BUILD_OUTPUT || "make"),
      requiredArches: index < 0 ? [process.arch] : (args[index + 1] || "").split(","),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
