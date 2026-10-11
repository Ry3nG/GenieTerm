#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const ScriptDir = path.dirname(fileURLToPath(import.meta.url));
const RepoRoot = path.resolve(ScriptDir, "..");
const PreviewDir = path.join(RepoRoot, "frontend", "preview");
const ArtifactDir = path.join(RepoRoot, "artifacts", "visual-qa");
const Host = "127.0.0.1";
const PageTimeoutMs = 10000;
const NavigationTimeoutMs = 15000;
const CleanupTimeoutMs = 5000;

const PreviewCases = [
  {
    name: "blockstatus",
    path: "/?preview=blockstatus",
    checks: [
      "Couldn't connect to",
      "Reconnecting in 4s (attempt 2)",
      "isn't responding",
      "Connected without the GenieTerm helper",
      "Installing the GenieTerm helper",
      "Enable and reconnect",
      "Restart terminal",
      "PowerShell",
      "Keep running",
    ],
    viewports: [
      { name: "desktop", width: 1100, height: 2100 },
      { name: "narrow", width: 360, height: 2100 },
    ],
  },
  {
    name: "commandpalette",
    path: "/?preview=commandpalette",
    checks: ["Recent", "Terminal", "Split Block Right", "↑↓ navigate · ↵ run · esc close"],
    viewports: [
      { name: "desktop", width: 1180, height: 820 },
      { name: "narrow", width: 390, height: 740 },
    ],
  },
  {
    name: "transfer-queue",
    path: "/?preview=transfer-queue",
    checks: ["Files transfer queue strip", "upload", "download", "failed"],
    viewports: [
      { name: "desktop", width: 1180, height: 760 },
      { name: "narrow", width: 720, height: 760 },
    ],
  },
  {
    name: "processviewer",
    path: "/?preview=processviewer",
    checks: ["processviewer block", "Processes", "kernel_task", "WindowServer"],
    viewports: [
      { name: "desktop", width: 1180, height: 820 },
      { name: "narrow", width: 760, height: 820 },
    ],
  },
  {
    name: "host",
    path: "/?preview=host",
    checks: ["gpu-01", "Overview", "GPUs", "NVIDIA H100 80GB HBM3", "Load average", "Ports", "tensorboard"],
    viewports: [
      { name: "desktop", width: 1300, height: 1900 },
      { name: "narrow", width: 760, height: 1900 },
      { name: "compact", width: 480, height: 1900 },
    ],
  },
  {
    name: "web",
    path: "/?preview=web",
    checks: ["full web block", "preview mock", "electron webview unavailable"],
    viewports: [
      { name: "desktop", width: 1240, height: 900 },
      { name: "narrow", width: 760, height: 900 },
    ],
  },
  {
    name: "onboarding",
    path: "/?preview=onboarding",
    checks: [
      "Welcome to GenieTerm",
      "Sessions that outlive the connection",
      "Every command, kept together",
      "Remote files, next to your shell",
      "The machine, not just the shell",
      "GenieTerm 1.0",
    ],
    viewports: [{ name: "desktop", width: 1300, height: 900 }],
  },
  {
    name: "commandai",
    path: "/?preview=commandai",
    checks: [
      "Choose the AI that writes your commands",
      "Insert",
      "Run it anyway?",
      "exit 2",
      "Sign in to Codex",
      "Goes to Claude Code",
    ],
    viewports: [
      { name: "desktop", width: 1300, height: 1000 },
      { name: "narrow", width: 640, height: 1000 },
    ],
  },
  {
    name: "settings",
    path: "/?preview=settings",
    checks: ["Appearance", "Terminal font size", "Command presentation", "Durable SSH sessions", "Automatic updates"],
    viewports: [
      { name: "desktop", width: 1300, height: 1000 },
      { name: "narrow", width: 640, height: 1000 },
    ],
  },
  {
    name: "files-directory",
    path: "/?preview=files-directory",
    checks: ["Name", "Last Modified", "TypeScript", "Folder"],
    viewports: [
      { name: "desktop", width: 1500, height: 800 },
      { name: "narrow", width: 760, height: 800 },
    ],
  },
  {
    name: "files-upload-drop",
    path: "/?preview=files-upload-drop",
    checks: ["Files upload drop affordance", "reports", "release notes.txt"],
    viewports: [
      { name: "desktop", width: 980, height: 680 },
      { name: "narrow", width: 640, height: 680 },
    ],
  },
];

function log(message) {
  console.log(`[preview-visual-qa] ${message}`);
}

function fail(message) {
  console.error(`[preview-visual-qa] failed: ${message}`);
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

function assertScreenshotHasContent(filePath) {
  const png = PNG.sync.read(readFileSync(filePath));
  const buckets = new Set();
  let visiblePixels = 0;
  let nonBackgroundPixels = 0;
  for (let idx = 0; idx < png.data.length; idx += 4 * 53) {
    const r = png.data[idx];
    const g = png.data[idx + 1];
    const b = png.data[idx + 2];
    const a = png.data[idx + 3];
    if (a < 8) {
      continue;
    }
    visiblePixels += 1;
    buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
    if (Math.abs(r - 18) > 8 || Math.abs(g - 18) > 8 || Math.abs(b - 18) > 8) {
      nonBackgroundPixels += 1;
    }
  }
  if (visiblePixels < 500) {
    throw new Error(`screenshot has too few visible pixels: ${filePath}`);
  }
  if (buckets.size < 18) {
    throw new Error(`screenshot appears visually blank or monochrome: ${filePath}`);
  }
  if (nonBackgroundPixels / visiblePixels < 0.08) {
    throw new Error(`screenshot has too little foreground content: ${filePath}`);
  }
}

async function assertNoHorizontalDocumentOverflow(page, caseName, viewportName) {
  const documentOverflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
    return {
      width,
      scrollWidth,
      overflow: scrollWidth - width,
    };
  });
  if (documentOverflow.overflow <= 2) {
    return;
  }
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
          right: rect.right,
          left: rect.left,
          width: rect.width,
          position: style.position,
        };
      })
      .filter((item) => item.width > 1 && item.position !== "fixed" && item.right - width > 2);
  });
  if (overflow.length > 0) {
    throw new Error(
      `${caseName}/${viewportName} has ${documentOverflow.overflow}px horizontal document overflow: ${JSON.stringify(
        overflow.slice(0, 5)
      )}`
    );
  }
  throw new Error(`${caseName}/${viewportName} has ${documentOverflow.overflow}px horizontal document overflow`);
}

async function assertPaletteInteractions(page) {
  const input = page.getByRole("combobox", { name: "Search commands" });
  const options = page.getByRole("option");
  const selected = page.locator('[role="option"][aria-selected="true"]');
  const assertSelection = async (option) => {
    assert.equal(await selected.getAttribute("id"), await option.getAttribute("id"));
    assert.equal(await input.getAttribute("aria-activedescendant"), await option.getAttribute("id"));
  };
  await input.press("ArrowUp");
  await assertSelection(options.last());
  await input.press("ArrowDown");
  await assertSelection(options.first());
  await input.press("Control+n");
  await assertSelection(options.nth(1));
  await input.press("Control+p");
  await assertSelection(options.first());
  await input.press("End");
  await assertSelection(options.last());
  assert(
    await selected.evaluate((element) => {
      const row = element.getBoundingClientRect();
      const list = element.closest('[role="listbox"]').getBoundingClientRect();
      return row.top >= list.top && row.bottom <= list.bottom + 1;
    })
  );
  await input.press("Home");
  await assertSelection(options.first());
  await input.press("Tab");
  assert(await input.evaluate((element) => element === document.activeElement));
  await input.fill("ssh");
  await page.getByRole("group", { name: "Results", exact: true }).waitFor();
  assert.equal(await page.getByRole("group", { name: "Recent", exact: true }).count(), 0);
  assert.equal(await options.count(), 3);
  await input.fill("no-such-command-zzzzz");
  await page.getByRole("status").filter({ hasText: "No matching commands" }).waitFor();
  assert.equal(await input.getAttribute("aria-activedescendant"), null);
  await input.press("Enter");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await input.fill("cls");
  await input.press("Enter");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.locator("output").filter({ hasText: "Clear Terminal" }).waitFor();
  const reopen = page.getByRole("button", { name: "Open command palette" });
  await reopen.click();
  assert.match(await selected.innerText(), /Clear Terminal/);
  await input.fill("copy");
  assert((await options.first().locator(".font-medium").count()) > 0);
  await options.last().hover();
  await assertSelection(options.last());
  await options.last().click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await reopen.click();
  await input.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert(await reopen.evaluate((element) => element === document.activeElement));
  await page.keyboard.press("ArrowDown");
  assert(await reopen.evaluate((element) => element === document.activeElement));
}

async function runPreviewCase(browser, baseUrl, previewCase) {
  for (const viewport of previewCase.viewports) {
    const page = await browser.newPage({
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
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

    const url = new URL(previewCase.path, baseUrl).toString();
    log(`checking ${previewCase.name}/${viewport.name}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NavigationTimeoutMs });
    await page.locator("body").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts?.ready);
    // parts of a preview (lazy-loaded charts, editors) render after the first text, so wait for each one
    for (const text of previewCase.checks) {
      const found = await page
        .getByText(text, { exact: false })
        .first()
        .waitFor({ state: "attached", timeout: PageTimeoutMs })
        .then(() => true)
        .catch(() => false);
      if (!found) {
        throw new Error(`${previewCase.name}/${viewport.name} missing required text: ${text}`);
      }
    }

    const errorBoundaryCount = await page.getByText("Something went wrong", { exact: false }).count();
    if (errorBoundaryCount > 0) {
      throw new Error(`${previewCase.name}/${viewport.name} rendered the error boundary`);
    }
    if (consoleErrors.length > 0) {
      throw new Error(`${previewCase.name}/${viewport.name} console errors: ${consoleErrors.join("\n")}`);
    }

    await assertNoHorizontalDocumentOverflow(page, previewCase.name, viewport.name);

    const screenshotPath = path.join(ArtifactDir, `${previewCase.name}-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    assertScreenshotHasContent(screenshotPath);
    log(`captured ${path.relative(RepoRoot, screenshotPath)}`);
    if (previewCase.name === "commandpalette") {
      await assertPaletteInteractions(page);
      assert.deepEqual(consoleErrors, []);
    }
    await page.close();
  }
}

async function main() {
  mkdirSync(ArtifactDir, { recursive: true });
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
    for (const previewCase of PreviewCases) {
      await runPreviewCase(browser, baseUrl, previewCase);
    }
    log("all preview visual QA checks passed");
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
