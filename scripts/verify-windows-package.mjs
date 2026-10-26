#!/usr/bin/env node
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import semver from "semver";
import YAML from "yaml";
import { requireCleanWindowsInstallState } from "./windows-installer-safety.mjs";

const Scope = "verify-windows-package";
const OutputDir = path.resolve(process.argv[2] || process.env.GENIETERM_BUILD_OUTPUT || "make");
const WindowSmoke = process.argv.includes("--window-smoke");
const UpgradeFrom = process.argv.find((arg) => arg.startsWith("--upgrade-from="))?.slice("--upgrade-from=".length);
const InstallerSmoke = process.argv.includes("--installer-smoke") || UpgradeFrom != null;
const RequireSignature = process.argv.includes("--require-signature");
const RequireZip = !process.argv.includes("--no-zip");
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

async function runTerminalCommand(page, command, expectedOutput) {
  await page.locator(".xterm").first().click();
  await page.keyboard.insertText(command);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (expected) => {
      const buffer = window.term?.terminal?.buffer?.active;
      if (!buffer) {
        return false;
      }
      for (let lineIndex = 0; lineIndex < buffer.length; lineIndex += 1) {
        if (buffer.getLine(lineIndex)?.translateToString().includes(expected)) {
          return true;
        }
      }
      return false;
    },
    expectedOutput,
    { timeout: 20000 }
  );
}

async function windowSmoke(executablePath, { profileDir, longHomes = false, onReady } = {}) {
  const isolatedHome = profileDir || mkdtempSync(path.join(tmpdir(), "genieterm-windows-smoke-"));
  mkdirSync(isolatedHome, { recursive: true });
  const settingsHome = longHomes
    ? path.join(
        isolatedHome,
        ...Array.from({ length: 6 }, (_, index) => `profile 设置 ${index} ${"long-path-".repeat(6)}`)
      )
    : isolatedHome;
  const configHome = path.join(settingsHome, "config");
  const dataHome = path.join(settingsHome, "data");
  const appProcess = spawn(
    executablePath,
    ["--remote-debugging-port=0", "--user-data-dir", isolatedHome, "--disable-gpu"],
    {
      env: {
        ...process.env,
        GENIETERM_SKIP_SINGLE_INSTANCE: "1",
        WAVETERM_CONFIG_HOME: configHome,
        WAVETERM_DATA_HOME: dataHome,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let browser;
  let appOutput = "";
  let smokeFailed = false;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("DevTools endpoint timed out")), 30000);
      const onOutput = (chunk) => {
        appOutput += chunk.toString();
        const match = appOutput.match(/DevTools listening on (ws:\/\/[^\s]+)/);
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
          const skip = candidate.getByRole("button", { name: "Skip", exact: true });
          if (await skip.isVisible()) {
            // "Skip" agrees to the terms and closes the welcome without starting Quick Start
            await skip.click();
          } else {
            const telemetry = candidate.getByRole("checkbox");
            if ((await telemetry.count()) === 1) {
              await telemetry.uncheck();
            }
            await candidate.getByRole("button", { name: "Continue", exact: true }).click();
            await candidate.getByRole("button", { name: /^Skip Feature Tour/ }).click();
          }
          await candidate
            .getByText("Welcome to GenieTerm", { exact: true })
            .waitFor({ state: "hidden", timeout: 15000 });
          onboardingCompleted.add(candidate);
          console.log(`[${Scope}] completed isolated first-run onboarding`);
        }
        if (
          await candidate
            .getByText("What's new since your last update.", { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          await candidate.getByRole("button", { name: "Not Now", exact: true }).click();
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
      const errorText = request.failure()?.errorText || "";
      // a fresh profile has no terminal cache yet: /wave/file answers 204 and the renderer drops
      // the empty response, which Chromium reports as aborted
      if (errorText.includes("ERR_ABORTED") && request.url().includes("/wave/file?")) {
        return;
      }
      errors.push(`request failed: ${request.url()} ${errorText}`);
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
    const commandId = randomUUID().replaceAll("-", "");
    await runTerminalCommand(
      page,
      `Write-Output ('GENIETERM_' + 'WINDOWS_OK_${commandId}')`,
      `GENIETERM_WINDOWS_OK_${commandId}`
    );
    console.log(`[${Scope}] packaged PowerShell command verified`);
    if (longHomes) {
      const homes = await page.evaluate(() => ({ data: window.api.getDataDir(), config: window.api.getConfigDir() }));
      if (
        dataHome.length <= 400 ||
        configHome.length <= 400 ||
        path.normalize(homes.data) !== path.normalize(dataHome) ||
        path.normalize(homes.config) !== path.normalize(configHome)
      ) {
        fail("packaged app did not use the intended long Unicode data and config paths");
      }
      await setSmokeSettings(page, path.dirname(executablePath));
      verifySmokeSettings(configHome);
      console.log(
        `[${Scope}] long Unicode homes verified through CLI and terminal settings: data=${dataHome.length}, config=${configHome.length} characters`
      );
    }
    await onReady?.({ page, browser, profileDir: isolatedHome });
    if (errors.length > 0) {
      fail(`packaged window error: ${errors.join("; ")}`);
    }
  } catch (error) {
    smokeFailed = true;
    const diagnosticDir = path.resolve("artifacts", "windows-package-smoke");
    mkdirSync(diagnosticDir, { recursive: true });
    const diagnosticPath = path.join(diagnosticDir, `${Date.now()}-${randomUUID().slice(0, 8)}.log`);
    const appLogPath = path.join(dataHome, "waveapp.log");
    const appLog = existsSync(appLogPath) ? readFileSync(appLogPath, "utf8") : "";
    const pageDiagnostics = await Promise.all(
      (browser?.contexts().flatMap((context) => context.pages()) || []).map(async (candidate) => ({
        url: candidate.url(),
        content: await candidate
          .evaluate(() => {
            const buffer = window.term?.terminal?.buffer?.active;
            const lines = [];
            for (let index = Math.max(0, (buffer?.length || 0) - 40); index < (buffer?.length || 0); index += 1) {
              lines.push(buffer.getLine(index)?.translateToString() || "");
            }
            return { text: document.body?.innerText.slice(0, 4000), terminal: lines.join("\n") };
          })
          .catch(() => "unavailable"),
      }))
    ).catch(() => []);
    writeFileSync(
      diagnosticPath,
      `${error.stack || error}\nprofile=${isolatedHome}\ndata=${dataHome}\nconfig=${configHome}\npages=${JSON.stringify(pageDiagnostics)}\n${appOutput}\n${appLog}`
    );
    console.error(`[${Scope}] failed window diagnostics: ${diagnosticPath}`);
    throw error;
  } finally {
    if (appProcess.pid) {
      spawnSync("taskkill", ["/PID", String(appProcess.pid), "/T", "/F"], { windowsHide: true });
    }
    await browser?.close().catch(() => {});
    if (!profileDir && !smokeFailed) {
      try {
        rmSync(isolatedHome, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      } catch (error) {
        console.warn(`[${Scope}] isolated test profile is still locked: ${error.code || error}`);
      }
    }
  }
}

async function workspacePage(browser) {
  for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
    if ((await candidate.locator(".workspace-switcher-button").count()) > 0) {
      return candidate;
    }
  }
  fail("workspace switcher was not available in the installed app");
}

async function setSmokeSettings(page, installDir) {
  const helperDir = path.join(installDir, "resources", "app.asar.unpacked", "dist", "bin");
  const helperName = readdirSync(helperDir).find((name) => /^genie-.*-windows\.x64\.exe$/.test(name));
  if (!helperName) {
    fail("installation did not include the genie CLI");
  }
  const helperPath = path.join(helperDir, helperName).replaceAll("'", "''");
  const commandId = randomUUID().replaceAll("-", "");
  await runTerminalCommand(
    page,
    `& '${helperPath}' setconfig term:fontsize=17 autoupdate:enabled=false; if ($LASTEXITCODE -eq 0) { Write-Output ('SETTINGS_' + 'SAVED_${commandId}') }`,
    `SETTINGS_SAVED_${commandId}`
  );
  await page.waitForFunction(() => window.term?.terminal?.options.fontSize === 17, null, { timeout: 15000 });
}

async function seedUpgradeProfile({ page, browser, profileDir }, installDir, workspaceName) {
  const previousVersion = await page.evaluate(() => window.api.getAboutModalDetails().version);
  if (!semver.valid(previousVersion) || !semver.lt(previousVersion, Version)) {
    fail(`upgrade source must be older than ${Version}, got ${previousVersion}`);
  }
  await setSmokeSettings(page, installDir);
  const shellPage = await workspacePage(browser);
  await shellPage.locator(".workspace-switcher-button").click();
  const saveWorkspace = shellPage.getByText("Save workspace", { exact: true });
  if (await saveWorkspace.isVisible()) {
    await saveWorkspace.click();
  } else {
    await shellPage.locator(".workspace-switcher-content .is-current").hover();
    await shellPage.locator(".workspace-switcher-content .is-current .edit").click();
  }
  const workspaceInput = shellPage.locator(".workspace-editor input");
  await workspaceInput.fill(workspaceName);
  await workspaceInput.press("Tab");
  await shellPage.locator(".workspace-switcher-button").click();
  await shellPage.locator(".workspace-switcher-button").click();
  await shellPage.locator(".workspace-switcher-content .label").filter({ hasText: workspaceName }).waitFor();
  await shellPage.keyboard.press("Escape");
  verifySmokeSettings(path.join(profileDir, "config"));
  console.log(`[${Scope}] ${previousVersion} workspace and settings saved through the app`);
}

function verifySmokeSettings(configHome) {
  const settings = JSON.parse(readFileSync(path.join(configHome, "settings.json"), "utf8"));
  if (settings["term:fontsize"] !== 17 || settings["autoupdate:enabled"] !== false) {
    fail("saved font size and automatic-update setting were not preserved");
  }
}

async function verifyUpgradeProfile({ page, browser, profileDir }, workspaceName) {
  const version = await page.evaluate(() => window.api.getAboutModalDetails().version);
  if (version !== Version) {
    fail(`installed upgrade version expected ${Version}, got ${version}`);
  }
  verifySmokeSettings(path.join(profileDir, "config"));
  await page.waitForFunction(() => window.term?.terminal?.options.fontSize === 17, null, { timeout: 15000 });
  const shellPage = await workspacePage(browser);
  await shellPage.locator(".workspace-switcher-button").click();
  await shellPage.locator(".workspace-switcher-content .label").filter({ hasText: workspaceName }).waitFor();
  await shellPage.keyboard.press("Escape");
  console.log(`[${Scope}] NSIS upgrade to ${Version} preserved the saved workspace and rendered settings`);
}

async function installerSmoke(installerPath) {
  requireCleanWindowsInstallState(ProductName);
  if (UpgradeFrom != null) {
    requireFile(path.resolve(UpgradeFrom), 1024 * 1024);
  }
  const root = mkdtempSync(path.join(tmpdir(), "gt 升级-"));
  const installDir = path.join(root, "GenieTerm 安装");
  const profileDir = path.join(root, "用户 数据");
  const workspaceName = `Upgrade workspace 保留 ${randomUUID().slice(0, 8)}`;
  console.log(`[${Scope}] isolated installer and profile root: ${root}`);
  let smokeError;
  try {
    if (UpgradeFrom != null) {
      const previousInstall = spawnSync(path.resolve(UpgradeFrom), ["/S", `/D=${installDir}`], {
        windowsHide: true,
        timeout: 180000,
      });
      if (previousInstall.error || previousInstall.status !== 0) {
        fail(`previous NSIS install failed: ${previousInstall.error?.message || previousInstall.status}`);
      }
      await windowSmoke(path.join(installDir, `${ProductName}.exe`), {
        profileDir,
        onReady: (context) => seedUpgradeProfile(context, installDir, workspaceName),
      });
    }
    const install = spawnSync(installerPath, ["/S", `/D=${installDir}`], { windowsHide: true, timeout: 180000 });
    if (install.error || install.status !== 0) {
      fail(`NSIS silent install failed: ${install.error?.message || install.status}`);
    }
    const installedExe = path.join(installDir, `${ProductName}.exe`);
    requireX64Pe(installedExe);
    requireFile(path.join(installDir, "resources", "app.asar"), 1024);
    console.log(`[${Scope}] NSIS installation verified`);
    await windowSmoke(installedExe, {
      profileDir,
      longHomes: UpgradeFrom == null,
      onReady: UpgradeFrom != null ? (context) => verifyUpgradeProfile(context, workspaceName) : undefined,
    });
  } catch (error) {
    console.error(`[${Scope}] installer smoke failed before cleanup: ${error.stack || error}`);
    smokeError = error;
  }
  try {
    // A failed launch must still uninstall; deleting the directory alone leaves production registry entries.
    if (existsSync(installDir)) {
      const uninstaller = readdirSync(installDir).find((name) => /^Uninstall.*\.exe$/i.test(name));
      if (!uninstaller) {
        fail(`NSIS install did not include an uninstaller; preserving ${root} for recovery`);
      }
      const uninstall = spawnSync(path.join(installDir, uninstaller), ["/S"], {
        windowsHide: true,
        timeout: 180000,
      });
      if (uninstall.error || uninstall.status !== 0) {
        fail(`NSIS silent uninstall failed: ${uninstall.error?.message || uninstall.status}; preserving ${root}`);
      }
      const installedExe = path.join(installDir, `${ProductName}.exe`);
      const uninstallDeadline = Date.now() + 30000;
      while (existsSync(installedExe) && Date.now() < uninstallDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (existsSync(installedExe)) {
        fail(`NSIS uninstaller returned but GenieTerm.exe remains installed; preserving ${root}`);
      }
      let cleanupError;
      // NSIS's temporary uninstaller can remove the executable before finishing its registry cleanup.
      do {
        try {
          requireCleanWindowsInstallState(ProductName);
          cleanupError = null;
          break;
        } catch (error) {
          cleanupError = error;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } while (Date.now() < uninstallDeadline);
      if (cleanupError) {
        throw cleanupError;
      }
      console.log(`[${Scope}] NSIS uninstall verified`);
    }
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      console.warn(`[${Scope}] temporary installer test directory is still locked: ${error.code || error}`);
    }
  } catch (cleanupError) {
    if (smokeError) {
      throw new AggregateError([smokeError, cleanupError], `[${Scope}] installer smoke and cleanup failed`);
    }
    throw cleanupError;
  }
  if (smokeError) {
    throw smokeError;
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
  if (RequireZip) {
    findArtifact(names, ".zip");
  }
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
    await windowSmoke(executablePath, { longHomes: true });
  }
  if (InstallerSmoke) {
    await installerSmoke(installerPath);
  }
  console.log(
    `[${Scope}] ${ProductName} ${Version} Windows x64 package verified${WindowSmoke ? " with window smoke" : ""}${InstallerSmoke ? " and installer smoke" : ""}${UpgradeFrom != null ? " including upgrade preservation" : ""}`
  );
}

await main();
