#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import YAML from "yaml";

const Scope = "verify-windows-package";
const OutputDir = path.resolve(process.argv[2] || process.env.GENIETERM_BUILD_OUTPUT || "make");
const WindowSmoke = process.argv.includes("--window-smoke");
const InstallerSmoke = process.argv.includes("--installer-smoke");
const RequireSignature = process.argv.includes("--require-signature");
const { productName: ProductName, version: Version } = JSON.parse(readFileSync("package.json", "utf8"));
const UpdateChannel = Version.match(/^\d+\.\d+\.\d+-([A-Za-z0-9-]+)/)?.[1] || "latest";

function fail(message) {
  throw new Error(`[${Scope}] ${message}`);
}

function requireFile(filePath, minimumSize = 1) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    fail(`missing file: ${filePath}`);
  }
  if (statSync(filePath).size < minimumSize) {
    fail(`file is too small: ${filePath}`);
  }
  return filePath;
}

function requireX64Pe(filePath) {
  requireFile(filePath, 1024);
  const file = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(4096);
    const bytesRead = readSync(file, header, 0, header.length, 0);
    const peOffset = header.readUInt32LE(0x3c);
    if (
      bytesRead < 0x40 ||
      header.toString("ascii", 0, 2) !== "MZ" ||
      peOffset + 6 > bytesRead ||
      header.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0" ||
      header.readUInt16LE(peOffset + 4) !== 0x8664
    ) {
      fail(`expected an x64 Windows executable: ${filePath}`);
    }
  } finally {
    closeSync(file);
  }
}

function findSignTool() {
  const sdkBin = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  if (existsSync(sdkBin)) {
    const versions = readdirSync(sdkBin, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = path.join(sdkBin, version, "x64", "signtool.exe");
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  const lookup = spawnSync("where.exe", ["signtool.exe"], { encoding: "utf8", windowsHide: true });
  if (lookup.status === 0) {
    return lookup.stdout.trim().split(/\r?\n/, 1)[0];
  }
  fail("Windows SDK SignTool was not found");
}

function signatureStatus(signTool, filePath) {
  const result = spawnSync(signTool, ["verify", "/pa", "/all", filePath], { encoding: "utf8", windowsHide: true });
  if (result.error) {
    fail(`cannot run SignTool: ${result.error.message}`);
  }
  if (result.status === 0) {
    return "Valid";
  }
  if (/no signature found/i.test(`${result.stdout}\n${result.stderr}`)) {
    return "NotSigned";
  }
  return `Invalid (SignTool exit ${result.status})`;
}

function findArtifact(names, extension) {
  const matches = names.filter(
    (name) =>
      name.startsWith(`${ProductName}-`) &&
      name.includes(`-x64-${Version}.`) &&
      !name.includes(".__uninstaller") &&
      name.endsWith(extension)
  );
  if (matches.length !== 1) {
    fail(`expected one Windows x64 ${extension} artifact, found ${matches.join(", ") || "none"}`);
  }
  return requireFile(path.join(OutputDir, matches[0]), 1024 * 1024);
}

async function sha512(filePath) {
  const digest = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
  }
  return digest.digest("base64");
}

async function verifyUpdateMetadata(names) {
  const metadataName = `${UpdateChannel}.yml`;
  const metadataPath = requireFile(path.join(OutputDir, metadataName));
  const metadata = YAML.parse(readFileSync(metadataPath, "utf8"));
  if (metadata?.version !== Version || !Array.isArray(metadata.files) || metadata.files.length === 0) {
    fail(`${metadataName} does not describe version ${Version}`);
  }
  const updateNames = new Set();
  for (const file of metadata.files) {
    const name = file?.url;
    if (typeof name !== "string" || path.basename(name) !== name || !names.includes(name)) {
      fail(`${metadataName} references an unpublished file: ${String(name)}`);
    }
    const artifactPath = requireFile(path.join(OutputDir, name), 1024 * 1024);
    if (file.size !== statSync(artifactPath).size || file.sha512 !== (await sha512(artifactPath))) {
      fail(`${metadataName} size or SHA-512 mismatch: ${name}`);
    }
    updateNames.add(name);
  }
  if (
    !updateNames.has(metadata.path) ||
    metadata.sha512 !== metadata.files.find((file) => file.url === metadata.path).sha512
  ) {
    fail(`${metadataName} primary update does not match its files list`);
  }
  if (![...updateNames].some((name) => name.endsWith(".exe"))) {
    fail(`${metadataName} has no Windows installer update`);
  }
}

async function windowSmoke(executablePath) {
  const isolatedHome = mkdtempSync(path.join(tmpdir(), "genieterm-windows-smoke-"));
  const appProcess = spawn(
    executablePath,
    ["--remote-debugging-port=0", "--user-data-dir", isolatedHome, "--disable-gpu"],
    {
      env: {
        ...process.env,
        GENIETERM_SKIP_SINGLE_INSTANCE: "1",
        WAVETERM_CONFIG_HOME: path.join(isolatedHome, "config"),
        WAVETERM_DATA_HOME: path.join(isolatedHome, "data"),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let browser;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("DevTools endpoint timed out")), 30000);
      const onOutput = (chunk) => {
        output += chunk.toString();
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      };
      appProcess.stdout.on("data", onOutput);
      appProcess.stderr.on("data", onOutput);
      appProcess.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      appProcess.on("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`GenieTerm exited before opening DevTools (code ${code})`));
      });
    });
    browser = await chromium.connectOverCDP(wsUrl);
    let page;
    const onboardingCompleted = new Set();
    const deadline = Date.now() + 45000;
    while (!page && Date.now() < deadline) {
      const pages = browser.contexts().flatMap((context) => context.pages());
      for (const candidate of pages) {
        if (!candidate.url().includes("app.asar")) {
          continue;
        }
        if (
          !onboardingCompleted.has(candidate) &&
          (await candidate
            .getByText("Welcome to GenieTerm", { exact: true })
            .isVisible()
            .catch(() => false))
        ) {
          await candidate.getByRole("button", { name: "Continue", exact: true }).click();
          const skipTour = candidate.getByRole("button", { name: /Skip Feature Tour/ });
          await skipTour.waitFor({ state: "visible", timeout: 15000 });
          await skipTour.click();
          onboardingCompleted.add(candidate);
          console.log(`[${Scope}] completed isolated first-run onboarding`);
        }
        if ((await candidate.locator(".term-connectelem").count()) > 0) {
          page = candidate;
          break;
        }
      }
      if (!page) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!page) {
      const windows = await Promise.all(
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .map(async (candidate) => ({
            title: await candidate.title(),
            url: candidate.url(),
            text: (
              await candidate
                .locator("body")
                .innerText()
                .catch(() => "")
            ).slice(0, 400),
          }))
      );
      fail(`GenieTerm terminal did not open; pages=${JSON.stringify(windows)}`);
    }
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`${message.text()} at ${message.location().url}`);
      }
    });
    page.on("requestfailed", (request) => {
      errors.push(`request failed: ${request.url()} ${request.failure()?.errorText || ""}`);
    });
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
    await page.locator(".term-connectelem").first().waitFor({ state: "visible", timeout: 10000 });
    if (!(await page.title()).startsWith(ProductName) || !page.url().includes("app.asar")) {
      fail(`unexpected packaged window: ${await page.title()} ${page.url()}`);
    }
    if (errors.length > 0 || (await page.getByText("Something went wrong", { exact: false }).count()) > 0) {
      fail(`packaged window error: ${errors.join("; ")}`);
    }
    await page.waitForFunction(
      () => {
        const buffer = window.term?.terminal?.buffer?.active;
        if (!buffer) {
          return false;
        }
        for (let lineIndex = 0; lineIndex < buffer.length; lineIndex += 1) {
          if (buffer.getLine(lineIndex)?.translateToString().trim().endsWith(">")) {
            return true;
          }
        }
        return false;
      },
      null,
      { timeout: 30000 }
    );
    await page.locator(".xterm").first().click();
    await page.keyboard.type("Write-Output ('GENIETERM_' + 'WINDOWS_OK')");
    await page.keyboard.press("Enter");
    let commandOutputSeen = false;
    const commandDeadline = Date.now() + 20000;
    while (!commandOutputSeen && Date.now() < commandDeadline) {
      commandOutputSeen = await page.evaluate(() => {
        const terminal = window.term?.terminal;
        const buffer = terminal?.buffer?.active;
        if (!buffer) {
          return false;
        }
        for (let lineIndex = 0; lineIndex < buffer.length; lineIndex += 1) {
          if (buffer.getLine(lineIndex)?.translateToString().includes("GENIETERM_WINDOWS_OK")) {
            return true;
          }
        }
        return false;
      });
      if (!commandOutputSeen) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!commandOutputSeen) {
      fail("local PowerShell command produced no terminal output");
    }
    console.log(`[${Scope}] packaged PowerShell command verified`);
  } finally {
    if (appProcess.pid) {
      spawnSync("taskkill", ["/PID", String(appProcess.pid), "/T", "/F"], { windowsHide: true });
    }
    await browser?.close().catch(() => {});
    try {
      rmSync(isolatedHome, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      console.warn(`[${Scope}] isolated test profile is still locked: ${error.code || error}`);
    }
  }
}

async function installerSmoke(installerPath) {
  const root = mkdtempSync(path.join(tmpdir(), "genieterm-installer-smoke-"));
  const installDir = path.join(root, "installed");
  try {
    const install = spawnSync(installerPath, ["/S", `/D=${installDir}`], { windowsHide: true, timeout: 180000 });
    if (install.error || install.status !== 0) {
      fail(`NSIS silent install failed: ${install.error?.message || install.status}`);
    }
    const installedExe = path.join(installDir, `${ProductName}.exe`);
    requireX64Pe(installedExe);
    requireFile(path.join(installDir, "resources", "app.asar"), 1024);
    console.log(`[${Scope}] NSIS installation verified`);
    await windowSmoke(installedExe);
    spawnSync("taskkill", ["/IM", `${ProductName}.exe`, "/T", "/F"], { windowsHide: true, timeout: 10000 });
    const uninstaller = readdirSync(installDir).find((name) => /^Uninstall.*\.exe$/i.test(name));
    if (!uninstaller) {
      fail("NSIS install did not include an uninstaller");
    }
    const uninstall = spawnSync(path.join(installDir, uninstaller), ["/S"], {
      windowsHide: true,
      timeout: 180000,
    });
    if (uninstall.error || uninstall.status !== 0) {
      fail(`NSIS silent uninstall failed: ${uninstall.error?.message || uninstall.status}`);
    }
    const uninstallDeadline = Date.now() + 30000;
    while (existsSync(installedExe) && Date.now() < uninstallDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (existsSync(installedExe)) {
      fail("NSIS uninstaller returned but GenieTerm.exe remains installed");
    }
    console.log(`[${Scope}] NSIS uninstall verified`);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      console.warn(`[${Scope}] temporary installer test directory is still locked: ${error.code || error}`);
    }
  }
}

async function main() {
  if (process.platform !== "win32") {
    fail("run this verifier on native Windows");
  }
  if (!existsSync(OutputDir)) {
    fail(`missing package output: ${OutputDir}`);
  }
  const entries = readdirSync(OutputDir, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const unpacked = entries.find((entry) => entry.isDirectory() && /^win(?:32)?(?:-x64)?-unpacked$/.test(entry.name));
  if (!unpacked) {
    fail("missing unpacked Windows x64 app");
  }
  const unpackedDir = path.join(OutputDir, unpacked.name);
  const executablePath = path.join(unpackedDir, `${ProductName}.exe`);
  requireX64Pe(executablePath);
  requireFile(path.join(unpackedDir, "resources", "app.asar"), 1024);
  const helperDir = path.join(unpackedDir, "resources", "app.asar.unpacked", "dist", "bin");
  const executables = [executablePath];
  for (const name of ["wavesrv.x64.exe", `genie-${Version}-windows.x64.exe`, `wsh-${Version}-windows.x64.exe`]) {
    const helperPath = path.join(helperDir, name);
    requireX64Pe(helperPath);
    executables.push(helperPath);
  }
  for (const name of readdirSync(helperDir)) {
    if (/^(genie|wsh)-.*-windows\.x64\.exe$/.test(name) && !name.includes(`-${Version}-`)) {
      fail(`stale Windows helper: ${name}`);
    }
  }
  // An NSIS bootstrapper may be x86 even when its installed app is x64.
  const installerPath = findArtifact(names, ".exe");
  executables.push(installerPath);
  findArtifact(names, ".zip");
  await verifyUpdateMetadata(names);
  const signTool = findSignTool();
  const signatures = executables.map((filePath) => ({
    name: path.basename(filePath),
    status: signatureStatus(signTool, filePath),
  }));
  console.log(`[${Scope}] signatures: ${signatures.map(({ name, status }) => `${name}=${status}`).join(", ")}`);
  if (RequireSignature && signatures.some(({ status }) => status !== "Valid")) {
    fail("Windows package contains an invalid or missing code signature");
  }
  if (WindowSmoke) {
    await windowSmoke(executablePath);
  }
  if (InstallerSmoke) {
    await installerSmoke(installerPath);
  }
  console.log(
    `[${Scope}] ${ProductName} ${Version} Windows x64 package verified${WindowSmoke ? " with window smoke" : ""}${InstallerSmoke ? " and installer smoke" : ""}`
  );
}

await main();
