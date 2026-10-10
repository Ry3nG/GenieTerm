#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ScriptDir = path.dirname(fileURLToPath(import.meta.url));
const RepoRoot = path.resolve(ScriptDir, "..");
const PreviewDir = path.join(RepoRoot, "frontend", "preview");
const Host = "127.0.0.1";
const PageTimeoutMs = 10000;
const NavigationTimeoutMs = 15000;
const CleanupTimeoutMs = 5000;

function log(message) {
  console.log(`[preview-interaction-qa] ${message}`);
}

function fail(message) {
  console.error(`[preview-interaction-qa] failed: ${message}`);
  process.exit(1);
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, Host, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate a preview server port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForServer(url, child) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 30000) {
    if (child.exitCode != null) {
      throw new Error(`preview server exited before becoming ready with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`preview server did not become ready: ${lastError}`);
}

function startPreviewServer(port) {
  const child = spawn("npx", ["vite", "--host", Host, "--port", String(port), "--strictPort"], {
    cwd: PreviewDir,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => process.stdout.write(data));
  child.stderr.on("data", (data) => process.stderr.write(data));
  return child;
}

function findBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

async function stopPreviewServer(child) {
  if (child.exitCode != null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function cleanupWithTimeout(label, cleanup) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      log(`${label} cleanup timed out`);
      resolve();
    }, CleanupTimeoutMs);
  });
  await Promise.race([
    cleanup().catch((error) => {
      log(`${label} cleanup failed: ${error.message}`);
    }),
    timeout,
  ]);
  if (timer) {
    clearTimeout(timer);
  }
}

async function newCheckedPage(browser, baseUrl, previewName, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(PageTimeoutMs);
  page.setDefaultNavigationTimeout(NavigationTimeoutMs);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  log(`checking ${previewName}`);
  await page.goto(`${baseUrl}/?preview=${previewName}`, {
    waitUntil: "domcontentloaded",
    timeout: NavigationTimeoutMs,
  });
  await page.locator("body").waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts?.ready);
  return {
    page,
    async assertClean() {
      if (consoleErrors.length > 0) {
        throw new Error(`${previewName} console errors: ${consoleErrors.join("\n")}`);
      }
      await assertCount(page.getByText("Something went wrong", { exact: false }), 0, "React error boundary");
    },
  };
}

async function assertVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 5000 });
  if (!(await locator.isVisible())) {
    throw new Error(`Expected visible: ${label}`);
  }
}

async function assertCount(locator, expected, label) {
  const actual = await locator.count();
  if (actual !== expected) {
    throw new Error(`Expected ${expected} matches for ${label}, got ${actual}`);
  }
}

async function runPreviewIndexInteraction(browser, baseUrl) {
  const { page, assertClean } = await newCheckedPage(browser, baseUrl, "transfer-queue", { width: 1280, height: 900 });
  await assertVisible(page.getByText("transfer-queue", { exact: true }), "preview header");
  await page.getByRole("link", { name: "index" }).click();
  await assertVisible(page.getByText("GenieTerm Preview Server"), "preview index title");
  await page.getByRole("link", { name: "transfer-queue" }).click();
  await assertVisible(page.getByRole("region", { name: "Transfer status" }).first(), "transfer status region");
  await assertClean();
  await page.close();
  log("preview index navigation passed");
}

async function runTransferQueueInteractions(browser, baseUrl) {
  const { page, assertClean } = await newCheckedPage(browser, baseUrl, "transfer-queue", { width: 920, height: 760 });
  await assertVisible(page.getByRole("region", { name: "Transfer status" }).first(), "transfer status region");
  await assertVisible(page.getByText("failed", { exact: false }).first(), "failed transfer state");
  await page.keyboard.press("Tab");
  await assertClean();
  await page.close();
  log("transfer queue interaction smoke passed");
}

async function runHostInteractions(browser, baseUrl) {
  const { page, assertClean } = await newCheckedPage(browser, baseUrl, "host", { width: 1300, height: 1900 });
  await assertVisible(page.getByText("NVIDIA H100 80GB HBM3", { exact: false }).first(), "GPU cards");
  const portsBlockId = await page
    .locator("[data-blockid]")
    .filter({ has: page.getByRole("tab", { name: /Ports/, selected: true }) })
    .first()
    .getAttribute("data-blockid");
  const portsBlock = page.locator(`[data-blockid="${portsBlockId}"]`).first();
  await assertVisible(portsBlock.getByText("TensorBoard", { exact: true }), "named service row");
  await assertCount(portsBlock.getByText("Owner not visible"), 0, "system listeners folded away");
  await portsBlock.getByRole("button", { name: /Other listeners/ }).click();
  await assertCount(portsBlock.getByText("Owner not visible"), 2, "system listeners after expanding");
  const jupyterRow = portsBlock.locator("div.group").filter({ hasText: "Jupyter" });
  await jupyterRow.getByRole("button", { name: "Forward & open" }).click();
  await assertVisible(jupyterRow.getByRole("button", { name: "Open" }), "open button after forwarding");
  await assertVisible(jupyterRow.getByText("localhost:8888"), "local address after forwarding");
  await portsBlock.getByRole("button", { name: "Forward a port" }).click();
  const forwardForm = portsBlock.locator("form");
  await forwardForm.getByLabel("Remote port").fill("99999");
  await forwardForm.getByRole("button", { name: "Forward", exact: true }).click();
  await assertVisible(forwardForm.getByText("Ports are numbers from 1 to 65535."), "port validation");
  await forwardForm.getByRole("button", { name: "Cancel" }).click();
  await portsBlock.getByRole("tab", { name: "Processes" }).click();
  await assertVisible(portsBlock.getByText("tensorboard").first(), "processes tab");
  await assertClean();
  await page.close();
  log("host interactions passed");
}

async function runFilesUploadDropInteractions(browser, baseUrl) {
  const { page, assertClean } = await newCheckedPage(browser, baseUrl, "files-upload-drop", {
    width: 760,
    height: 680,
  });
  await assertVisible(page.getByText("reports"), "directory row");
  await assertVisible(page.getByText("release notes.txt"), "file row");
  await assertVisible(page.getByText("Drop to upload"), "drop overlay");
  await page.mouse.move(380, 320);
  await assertClean();
  await page.close();
  log("files upload drop interaction smoke passed");
}

async function main() {
  const port = await findFreePort();
  const baseUrl = `http://${Host}:${port}`;
  const server = startPreviewServer(port);
  let browser = null;
  let failure = null;
  try {
    await waitForServer(baseUrl, server);
    const executablePath = findBrowserExecutable();
    if (!executablePath) {
      throw new Error(
        "No Chromium-compatible browser was found. Install Google Chrome or run `npx playwright install chromium`."
      );
    }
    browser = await chromium.launch({ executablePath });
    await runPreviewIndexInteraction(browser, baseUrl);
    await runTransferQueueInteractions(browser, baseUrl);
    await runHostInteractions(browser, baseUrl);
    await runFilesUploadDropInteractions(browser, baseUrl);
    log("all preview interaction QA checks passed");
  } catch (error) {
    failure = error.stack || error.message;
  } finally {
    if (browser) {
      await cleanupWithTimeout("browser", () => browser.close());
    }
    await cleanupWithTimeout("preview server", () => stopPreviewServer(server));
  }
  if (failure) {
    fail(failure);
  }
}

await main();
process.exit(0);
