#!/usr/bin/env node

// Performance benchmark for a packaged GenieTerm (macOS). Launches the app with isolated data and config
// directories, drives it over the Chrome DevTools protocol, and prints one JSON report.
//
//   node scripts/perf-bench.mjs /path/to/GenieTerm.app [--out report.json] [--tabs 4] [--settings '{"k":v}']
//
// Measures: time to the first visible window and terminal, idle footprint per process, keystroke echo round trip (input RPC
// sent -> echoed byte received), output throughput for `seq 1 200000`, renderer heap, and footprint growth when
// opening extra tabs. Footprint is macOS phys_footprint (what Activity Monitor shows), not RSS.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ThroughputLines = 200000;
const EchoSamples = 25;

function parseArgs(argv) {
  const opts = { app: null, out: null, tabs: 3, settings: null, startupRuns: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      opts.out = argv[++i];
    } else if (arg === "--tabs") {
      opts.tabs = Number(argv[++i]);
    } else if (arg === "--startup-runs") {
      opts.startupRuns = Number(argv[++i]);
    } else if (arg === "--settings") {
      opts.settings = JSON.parse(argv[++i]);
    } else if (!opts.app) {
      opts.app = arg;
    }
  }
  if (!opts.app) {
    console.error("usage: perf-bench.mjs <GenieTerm.app> [--out report.json] [--tabs N] [--settings JSON]");
    process.exit(2);
  }
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const progress = (msg) => console.error(`[perf-bench] ${msg}`);

function processTree(rootPid) {
  const rows = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .stdout.split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }));
  const pids = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (pids.has(row.ppid) && !pids.has(row.pid)) {
        pids.add(row.pid);
        grew = true;
      }
    }
  }
  return rows.filter((row) => pids.has(row.pid));
}

function processLabel(cmd) {
  if (cmd.includes("wavesrv")) {
    return "wavesrv";
  }
  const type = cmd.match(/--type=(\S+)/)?.[1];
  if (!type) {
    return cmd.includes("Contents/MacOS/GenieTerm") ? "main" : path.basename(cmd.split(" ")[0]);
  }
  if (type === "utility") {
    return `utility:${(cmd.match(/--utility-sub-type=(\S+)/)?.[1] ?? "?").split(".").pop()}`;
  }
  return type;
}

function footprintMB(pid) {
  const out = spawnSync("footprint", [String(pid)], { encoding: "utf8" }).stdout ?? "";
  const m = out.match(/Footprint:\s+([\d.]+)\s+(KB|MB|GB)/);
  if (!m) {
    return 0;
  }
  const value = Number(m[1]);
  return m[2] === "GB" ? value * 1024 : m[2] === "KB" ? value / 1024 : value;
}

function cpuSeconds(pids) {
  const out = spawnSync("ps", ["-o", "pid=,time=", "-p", pids.join(",")], { encoding: "utf8" }).stdout ?? "";
  const times = {};
  for (const line of out.split("\n").filter(Boolean)) {
    const [pid, time] = line.trim().split(/\s+/);
    const parts = time.split(":").map(Number);
    times[pid] = parts.reduce((acc, part) => acc * 60 + part, 0);
  }
  return times;
}

async function sampleProcesses(rootPid, cpuWindowMs) {
  const pids = processTree(rootPid).map((row) => row.pid);
  const before = cpuSeconds(pids);
  await sleep(cpuWindowMs);
  const after = cpuSeconds(pids);
  const rows = processTree(rootPid).map((row) => ({
    process: processLabel(row.cmd),
    footprintMB: Number(footprintMB(row.pid).toFixed(1)),
    cpuPct:
      before[row.pid] != null && after[row.pid] != null
        ? Number(((100 * (after[row.pid] - before[row.pid])) / (cpuWindowMs / 1000)).toFixed(1))
        : null,
  }));
  rows.sort((a, b) => b.footprintMB - a.footprintMB);
  return {
    totalFootprintMB: Number(rows.reduce((acc, row) => acc + row.footprintMB, 0).toFixed(1)),
    totalCpuPct: Number(rows.reduce((acc, row) => acc + (row.cpuPct ?? 0), 0).toFixed(1)),
    processes: rows,
  };
}

function decodeAppend(payload) {
  if (!payload.includes('"fileop":"append"')) {
    return null;
  }
  const b64 = payload.match(/"data64":"([^"]*)"/)?.[1];
  return b64 == null ? null : Buffer.from(b64, "base64").toString("latin1");
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(2));
}

async function visibleAppPage(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      if (!page.url().includes("app.asar")) {
        continue;
      }
      const visible = await page
        .evaluate(() => window.innerWidth > 0 && document.visibilityState === "visible")
        .catch(() => false);
      if (visible) {
        return page;
      }
    }
    await sleep(100);
  }
  throw new Error("no visible app page");
}

function launchApp(appPath, dataDir) {
  const configDir = path.join(dataDir, "config");
  const app = spawn(
    path.join(appPath, "Contents", "MacOS", "GenieTerm"),
    ["--remote-debugging-port=0", "--user-data-dir", dataDir],
    {
      env: {
        ...process.env,
        GENIETERM_SKIP_SINGLE_INSTANCE: "1",
        WAVETERM_CONFIG_HOME: configDir,
        WAVETERM_DATA_HOME: path.join(dataDir, "data"),
      },
    }
  );
  const session = { app, launchTs: Date.now(), wsUrl: null, browser: null };
  app.stderr.on("data", (chunk) => {
    session.wsUrl ??= chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? null;
  });
  return session;
}

async function connect(session) {
  for (let i = 0; i < 300 && !session.wsUrl; i++) {
    await sleep(50);
  }
  if (!session.wsUrl) {
    throw new Error("GenieTerm did not expose a DevTools endpoint");
  }
  session.browser = await chromium.connectOverCDP(session.wsUrl);
  return session.browser;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// helpers and wavesrv are reparented once the main process exits, so remember their pids up front and wait for
// every one of them: a survivor keeps Chromium's profile lock and the next launch on this data dir would bail out
async function stopApp(session) {
  const pids = processTree(session.app.pid).map((row) => row.pid);
  await session.browser?.close().catch(() => {});
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already exited
    }
  }
  for (let i = 0; i < 100 && pids.some(isAlive); i++) {
    await sleep(100);
  }
  for (const pid of pids.filter(isAlive)) {
    process.kill(pid, "SIGKILL");
  }
}

async function measureSession(opts, dataDir, report) {
  const session = launchApp(opts.app, dataDir);
  try {
    const browser = await connect(session);
    let page = await visibleAppPage(browser, 30000);
    for (const label of ["Continue", "Skip tour"]) {
      const button = page.getByText(label, { exact: true });
      await button
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      if (await button.count()) {
        await button.first().click();
        await sleep(800);
      }
    }
    page = await visibleAppPage(browser, 10000);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    const received = [];
    const sent = [];
    cdp.on("Network.webSocketFrameReceived", (event) => {
      const data = decodeAppend(event.response.payloadData);
      if (data == null) {
        return;
      }
      received.push({ ts: performance.now(), data });
    });
    cdp.on("Network.webSocketFrameSent", (event) => {
      if (event.response.payloadData.includes("controllerinput")) {
        sent.push(performance.now());
      }
    });

    const textarea = page.locator(".xterm-helper-textarea").first();
    await textarea.waitFor({ timeout: 15000 });
    await sleep(5000);
    progress("sampling idle");
    report.idle = await sampleProcesses(session.app.pid, 10000);
    report.idleHeap = await page.evaluate(() => ({
      jsHeapUsedMB: Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)),
      domNodes: document.getElementsByTagName("*").length,
    }));

    progress("measuring keystroke echo");
    await textarea.focus();
    const echoMs = [];
    for (let i = 0; i < EchoSamples; i++) {
      const sentBefore = sent.length;
      const recvBefore = received.length;
      await page.keyboard.type("x");
      for (let wait = 0; wait < 100 && (sent.length === sentBefore || received.length === recvBefore); wait++) {
        await sleep(5);
      }
      if (sent.length > sentBefore && received.length > recvBefore) {
        echoMs.push(received[recvBefore].ts - sent[sentBefore]);
      }
      await sleep(60);
    }
    await page.keyboard.press("Control+U");
    report.keystrokeEchoMs = { p50: percentile(echoMs, 50), p95: percentile(echoMs, 95), samples: echoMs.length };

    await sleep(500);
    progress("measuring throughput");
    const recvStart = received.length;
    const throughputStart = performance.now();
    await page.keyboard.type(`seq 1 ${ThroughputLines}\n`);
    let lastLineTs = null;
    for (let i = 0; i < 600 && lastLineTs == null; i++) {
      await sleep(100);
      for (let j = recvStart; j < received.length; j++) {
        if (received[j].data.includes(`${ThroughputLines}\r\n`)) {
          lastLineTs = received[j].ts;
          break;
        }
      }
    }
    report.throughput = {
      lines: ThroughputLines,
      seconds: lastLineTs == null ? null : Number(((lastLineTs - throughputStart) / 1000).toFixed(2)),
      appendMessages: received.length - recvStart,
    };
    await sleep(3000);
    report.afterThroughput = await sampleProcesses(session.app.pid, 5000);

    progress("opening tabs");
    const pagesBefore = browser.contexts().flatMap((context) => context.pages()).length;
    for (let i = 0; i < opts.tabs; i++) {
      const current = await visibleAppPage(browser, 10000);
      await current.evaluate(() => window.api.createTab());
      await sleep(2500);
    }
    await sleep(5000);
    report.extraTabs = opts.tabs;
    report.rendererPagesAdded = browser.contexts().flatMap((context) => context.pages()).length - pagesBefore;
    report.withTabs = await sampleProcesses(session.app.pid, 5000);
    // an attached DevTools client keeps every page "visible", so detach before measuring background tabs; they
    // stop rendering and release their WebGL renderers after a delay
    await browser.close().catch(() => {});
    session.browser = null;
    await sleep(30000);
    report.withTabsSettled = await sampleProcesses(session.app.pid, 5000);
  } finally {
    await stopApp(session);
  }
}

// second launch on the same data dir: onboarding is done and the workspace restores, like a returning user
async function measureRelaunch(opts, dataDir, report) {
  progress("measuring relaunch");
  const session = launchApp(opts.app, dataDir);
  try {
    const browser = await connect(session);
    const page = await visibleAppPage(browser, 30000);
    report.relaunchToWindowMs = Date.now() - session.launchTs;
    await page.locator(".xterm-helper-textarea").first().waitFor({ timeout: 30000 });
    report.relaunchToTerminalMs = Date.now() - session.launchTs;
    await browser.close().catch(() => {});
    session.browser = null;
    await sleep(15000);
    report.relaunchIdle = await sampleProcesses(session.app.pid, 10000);
  } finally {
    await stopApp(session);
  }
}

// startup only: complete onboarding once, then relaunch N times on the warm data dir and report the spread
async function measureStartupRuns(opts, dataDir, report) {
  const first = launchApp(opts.app, dataDir);
  try {
    const page = await visibleAppPage(await connect(first), 30000);
    for (const label of ["Continue", "Skip tour"]) {
      const button = page.getByText(label, { exact: true });
      await button
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      if (await button.count()) {
        await button.first().click();
        await sleep(800);
      }
    }
    await sleep(3000);
  } finally {
    await stopApp(first);
  }
  const windowMs = [];
  const terminalMs = [];
  for (let i = 0; i < opts.startupRuns; i++) {
    progress(`startup run ${i + 1}/${opts.startupRuns}`);
    const session = launchApp(opts.app, dataDir);
    try {
      const page = await visibleAppPage(await connect(session), 30000);
      windowMs.push(Date.now() - session.launchTs);
      await page.locator(".xterm-helper-textarea").first().waitFor({ timeout: 30000 });
      terminalMs.push(Date.now() - session.launchTs);
      await sleep(3000);
    } finally {
      await stopApp(session);
    }
  }
  report.startupRuns = opts.startupRuns;
  report.relaunchToWindowMs = { p50: percentile(windowMs, 50), min: Math.min(...windowMs), max: Math.max(...windowMs) };
  report.relaunchToTerminalMs = {
    p50: percentile(terminalMs, 50),
    min: Math.min(...terminalMs),
    max: Math.max(...terminalMs),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dataDir = mkdtempSync(path.join(tmpdir(), "genieterm-bench-"));
  const configDir = path.join(dataDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    path.join(configDir, "settings.json"),
    JSON.stringify({ "autoupdate:enabled": false, ...opts.settings })
  );
  const report = { app: opts.app, settings: opts.settings ?? {} };
  try {
    if (opts.startupRuns > 0) {
      await measureStartupRuns(opts, dataDir, report);
    } else {
      await measureSession(opts, dataDir, report);
      await measureRelaunch(opts, dataDir, report);
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
  const json = JSON.stringify(report, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, json);
  }
  console.log(json);
}

main().catch((err) => {
  console.error(`[perf-bench] ${err.stack ?? err}`);
  process.exit(1);
});
