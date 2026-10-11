#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { MacAppExpectations, run, verifyDirectory, verifyMacAppBundle } from "./macos-app-verifier.mjs";
import { extractAppImage, verifyLinuxTree } from "./verify-linux-package.mjs";

const Scope = "verify-installed-app";
const DefaultAppPath = `/Applications/${MacAppExpectations.productName}.app`;
const shouldLaunchSmoke = process.argv.includes("--launch-smoke");
const shouldWindowSmoke = process.argv.includes("--window-smoke");
const appPathArg = process.argv.find((arg) => arg.endsWith(".app"));
const AppPath = path.resolve(appPathArg || DefaultAppPath);

function log(message) {
  console.log(`[${Scope}] ${message}`);
}

function fail(scope, message) {
  throw new Error(`[${scope}] ${message}`);
}

function launchSmoke(appPath) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "genieterm-installed-smoke-"));
  run(Scope, "open", ["-n", appPath, "--args", "--user-data-dir", userDataDir, "--disable-gpu"]);
  const pids = waitForLaunch(userDataDir);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // The app may have exited between pgrep and SIGTERM.
    }
  }
  rmSync(userDataDir, { recursive: true, force: true });
}

function waitForLaunch(userDataDir) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const result = spawnSync("pgrep", ["-f", userDataDir], { encoding: "utf8" });
    const pids = result.stdout.trim().split(/\s+/).filter(Boolean);
    if (pids.length > 0) {
      return pids;
    }
    spawnSync("sleep", ["0.25"]);
  }
  fail(Scope, "launch smoke did not observe a running GenieTerm process");
}

function screenshotContentProblem(buffer) {
  const png = PNG.sync.read(buffer);
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
    return "window screenshot has too few visible pixels";
  }
  if (buckets.size < 12) {
    return "window screenshot appears visually blank or monochrome";
  }
  if (nonBackgroundPixels / visiblePixels < 0.04) {
    return "window screenshot has too little foreground content";
  }
  return null;
}

// The first frame after domcontentloaded is often still the empty background, so give the UI time to render.
async function assertWindowRendersContent(window, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let problem = null;
  while (Date.now() < deadline) {
    problem = screenshotContentProblem(await window.screenshot());
    if (problem == null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(Scope, problem);
}

async function windowSmoke(appPath) {
  const executablePath =
    process.platform === "linux"
      ? path.join(appPath, "genieterm")
      : path.join(appPath, "Contents", "MacOS", MacAppExpectations.productName);
  const userDataDir = mkdtempSync(path.join(tmpdir(), "genieterm-window-smoke-"));
  let browser = null;
  let appProcess = null;
  try {
    const { child, wsUrl } = await launchPackagedAppForCdp(executablePath, userDataDir);
    appProcess = child;
    browser = await chromium.connectOverCDP(wsUrl);
    const window = await waitForVisibleAppPage(browser, 20000);
    const consoleErrors = [];
    window.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    window.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });
    await window.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    const title = await window.title();
    if (title !== MacAppExpectations.productName && !title.startsWith(`${MacAppExpectations.productName} - `)) {
      fail(Scope, `window title expected ${MacAppExpectations.productName}, got ${title}`);
    }
    if (!window.url().includes("app.asar")) {
      fail(Scope, `window URL does not point at packaged app content: ${window.url()}`);
    }
    await assertWindowRendersContent(window, 15000);
    const errorBoundaryCount = await window.getByText("Something went wrong", { exact: false }).count();
    if (errorBoundaryCount > 0) {
      fail(Scope, "window rendered the React error boundary");
    }
    if (consoleErrors.length > 0) {
      fail(Scope, `window console errors: ${consoleErrors.join("\n")}`);
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    stopAppProcesses(appProcess, userDataDir);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

// An installed .deb must keep Chromium's sandbox (AppArmor profile or setuid helper); only the
// AppImage smoke may fall back to --no-sandbox, as its AppRun does on restricted kernels.
let requireSandbox = false;

async function launchPackagedAppForCdp(executablePath, userDataDir, withoutSandbox = false) {
  const child = spawn(
    executablePath,
    [
      "--remote-debugging-port=0",
      "--user-data-dir",
      userDataDir,
      "--disable-gpu",
      ...(withoutSandbox ? ["--no-sandbox"] : []),
    ],
    {
      env: {
        ...process.env,
        GENIETERM_SKIP_SINGLE_INSTANCE: "1",
        WAVETERM_CONFIG_HOME: path.join(userDataDir, "config"),
        WAVETERM_DATA_HOME: path.join(userDataDir, "data"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let output = "";
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`timed out waiting for DevTools endpoint\n${output}`));
      }, 20000);
      const onData = (buffer) => {
        output += buffer.toString();
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", (code, signal) => {
        if (!/DevTools listening on ws:\/\//.test(output)) {
          clearTimeout(timeout);
          reject(new Error(`app exited before DevTools endpoint was ready: code=${code} signal=${signal}\n${output}`));
        }
      });
    });
    return { child, wsUrl };
  } catch (error) {
    stopAppProcesses(child, userDataDir);
    if (
      process.platform === "linux" &&
      !withoutSandbox &&
      !requireSandbox &&
      /No usable sandbox|SUID sandbox helper binary|Running as root without --no-sandbox/i.test(output)
    ) {
      log("sandbox unavailable in smoke environment; retrying this test with --no-sandbox");
      return launchPackagedAppForCdp(executablePath, userDataDir, true);
    }
    throw error;
  }
}

// Electron keeps pre-created tab views around at zero size; only the visible app page can be screenshotted.
async function waitForVisibleAppPage(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.url().includes("app.asar")) {
          continue;
        }
        const visible = await page
          .evaluate(() => window.innerWidth > 0 && window.innerHeight > 0 && document.visibilityState === "visible")
          .catch(() => false);
        if (visible) {
          return page;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(Scope, "window smoke did not observe a visible app page");
}

function stopAppProcesses(appProcess, userDataDir) {
  if (appProcess?.pid) {
    try {
      process.kill(appProcess.pid, "SIGTERM");
    } catch {
      // The launcher may have exited after spawning the packaged Electron app.
    }
  }
  const pids = spawnSync("pgrep", ["-f", userDataDir], { encoding: "utf8" }).stdout.trim().split(/\s+/).filter(Boolean);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // The process may have exited between pgrep and SIGTERM.
    }
  }
}

async function main() {
  if (process.platform === "linux" && process.argv.includes("--linux-installed")) {
    const root = process.argv[process.argv.indexOf("--linux-installed") + 1];
    if (!root || !shouldWindowSmoke) {
      fail(Scope, "Linux usage: --window-smoke --linux-installed /opt/GenieTerm (run under xvfb-run)");
    }
    verifyLinuxTree(root, process.arch);
    requireSandbox = true;
    await windowSmoke(root);
    log("installed Linux package window smoke passed with the sandbox on");
    return;
  }
  if (process.platform === "linux") {
    const imageIndex = process.argv.indexOf("--linux-appimage");
    const image = imageIndex >= 0 ? process.argv[imageIndex + 1] : null;
    if (!image || !shouldWindowSmoke) {
      fail(Scope, "Linux usage: --window-smoke --linux-appimage path/to/GenieTerm.AppImage (run under xvfb-run)");
    }
    const temporary = mkdtempSync(path.join(tmpdir(), "genieterm-linux-smoke-"));
    try {
      const root = extractAppImage(image, temporary);
      verifyLinuxTree(root, process.arch);
      await windowSmoke(root);
      log("Linux AppImage window smoke passed");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    return;
  }
  if (process.platform !== "darwin") {
    fail(Scope, "installed app verification is currently implemented for macOS only");
  }
  if (!existsSync(AppPath)) {
    fail(Scope, `${AppPath} does not exist`);
  }
  verifyDirectory(Scope, AppPath, "installed app bundle");
  verifyMacAppBundle(Scope, AppPath);
  log(`verified ${AppPath}`);
  if (shouldLaunchSmoke) {
    launchSmoke(AppPath);
    log("launch smoke passed");
  }
  if (shouldWindowSmoke) {
    await windowSmoke(AppPath);
    log("window smoke passed");
  }
  log("all installed app checks passed");
}

await main();
