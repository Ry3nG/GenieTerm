#!/usr/bin/env node

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
const RequireSignature = process.argv.includes("--require-signature");
const { productName: ProductName, version: Version } = JSON.parse(readFileSync("package.json", "utf8"));

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

function signatureStatus(filePath) {
  const escapedPath = filePath.replaceAll("'", "''");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${escapedPath}').Status`],
    { encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) {
    fail(`cannot inspect code signature: ${filePath}`);
  }
  return result.stdout.trim();
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
  const metadataPath = requireFile(path.join(OutputDir, "latest.yml"));
  const metadata = YAML.parse(readFileSync(metadataPath, "utf8"));
  if (metadata?.version !== Version || !Array.isArray(metadata.files) || metadata.files.length === 0) {
    fail(`latest.yml does not describe version ${Version}`);
  }
  const updateNames = new Set();
  for (const file of metadata.files) {
    const name = file?.url;
    if (typeof name !== "string" || path.basename(name) !== name || !names.includes(name)) {
      fail(`latest.yml references an unpublished file: ${String(name)}`);
    }
    const artifactPath = requireFile(path.join(OutputDir, name), 1024 * 1024);
    if (file.size !== statSync(artifactPath).size || file.sha512 !== (await sha512(artifactPath))) {
      fail(`latest.yml size or SHA-512 mismatch: ${name}`);
    }
    updateNames.add(name);
  }
  if (
    !updateNames.has(metadata.path) ||
    metadata.sha512 !== metadata.files.find((file) => file.url === metadata.path).sha512
  ) {
    fail("latest.yml primary update does not match its files list");
  }
  if (![...updateNames].some((name) => name.endsWith(".exe"))) {
    fail("latest.yml has no Windows installer update");
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
    const deadline = Date.now() + 30000;
    while (!page && Date.now() < deadline) {
      page = browser.contexts().flatMap((context) => context.pages())[0];
      if (!page) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!page) {
      fail("GenieTerm window did not open");
    }
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
    await page.locator(".term-connectelem").first().waitFor({ state: "visible", timeout: 30000 });
    if ((await page.title()) !== ProductName || !page.url().includes("app.asar")) {
      fail(`unexpected packaged window: ${await page.title()} ${page.url()}`);
    }
    if (errors.length > 0 || (await page.getByText("Something went wrong", { exact: false }).count()) > 0) {
      fail(`packaged window error: ${errors.join("; ")}`);
    }
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
  } finally {
    await browser?.close().catch(() => {});
    if (appProcess.pid) {
      spawnSync("taskkill", ["/PID", String(appProcess.pid), "/T", "/F"], { windowsHide: true });
    }
    rmSync(isolatedHome, { recursive: true, force: true });
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
  const signatures = executables.map((filePath) => ({
    name: path.basename(filePath),
    status: signatureStatus(filePath),
  }));
  console.log(`[${Scope}] signatures: ${signatures.map(({ name, status }) => `${name}=${status}`).join(", ")}`);
  if (RequireSignature && signatures.some(({ status }) => status !== "Valid")) {
    fail("Windows package contains an invalid or missing code signature");
  }
  if (WindowSmoke) {
    await windowSmoke(executablePath);
  }
  console.log(
    `[${Scope}] ${ProductName} ${Version} Windows x64 package verified${WindowSmoke ? " with window smoke" : ""}`
  );
}

await main();
