// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const RepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OutputDir = path.join(RepoRoot, "artifacts", "monaco-workers", String(Date.now()));
const Report = { checks: [], errors: [], warnings: [] };
const Html = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="editor" style="width:900px;height:600px"></div>
<script type="module">
import * as monaco from "monaco-editor";
import { loadMonaco } from "/frontend/app/monaco/monaco-env.ts";
loadMonaco();
window.monacoProbe = { monaco };
</script></body></html>`;

let server;
let browser;
let page;

async function check(name, action) {
  const evidence = await action();
  Report.checks.push({ name, evidence });
  console.log(`[monaco-workers] PASS ${name}`);
  assert.deepEqual(Report.errors, [], "Uncaught editor/worker errors");
  assert.deepEqual(Report.warnings, [], "Worker initialization warnings");
}

async function replaceModel(language, value) {
  await page.evaluate(
    ({ language, value }) => {
      const probe = window.monacoProbe;
      probe.editor?.setModel(null);
      probe.editor?.dispose();
      probe.model?.dispose();
      probe.model = probe.monaco.editor.createModel(value, language);
      probe.editor = probe.monaco.editor.create(document.getElementById("editor"), { model: probe.model });
    },
    { language, value }
  );
}

async function diagnostics() {
  await page.waitForFunction(() => {
    const { monaco, model } = window.monacoProbe;
    return monaco.editor.getModelMarkers({ resource: model.uri }).some((marker) => marker.severity === 8);
  });
  return page.evaluate(() => {
    const { monaco, model } = window.monacoProbe;
    return monaco.editor.getModelMarkers({ resource: model.uri }).map(({ message }) => message);
  });
}

async function workerResponse(method, urlPart) {
  await page.waitForFunction(
    ({ method, urlPart }) =>
      window.workerCalls.some((call) => call.url.includes(urlPart) && call.method === method && call.completed),
    { method, urlPart }
  );
  const calls = await page.evaluate(
    ({ method, urlPart }) =>
      window.workerCalls.filter((call) => call.url.includes(urlPart) && call.method === method && call.completed),
    { method, urlPart }
  );
  assert.ok(
    calls.every((call) => !call.error),
    JSON.stringify(calls)
  );
  return calls;
}

try {
  mkdirSync(OutputDir, { recursive: true });
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find((candidate) => candidate && existsSync(candidate));
  assert.ok(executablePath, "Install Playwright Chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE");
  server = await createServer({
    configFile: false,
    root: RepoRoot,
    cacheDir: path.join(OutputDir, "vite-cache"),
    resolve: { alias: { "@": path.join(RepoRoot, "frontend") } },
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: {
      noDiscovery: true,
      include: ["monaco-editor", "monaco-editor/esm/vs/common/workers.js", "monaco-yaml", "monaco-yaml/yaml.worker.js"],
    },
    plugins: [
      {
        name: "monaco-worker-regression",
        configureServer(vite) {
          vite.middlewares.use("/__monaco_regression.html", async (_req, res, next) => {
            try {
              const html = await vite.transformIndexHtml("/__monaco_regression.html", Html);
              res.setHeader("Content-Type", "text/html");
              res.end(html);
            } catch (error) {
              next(error);
            }
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => Report.errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) Report.warnings.push(message.text());
  });
  await page.addInitScript(() => {
    window.workerCalls = [];
    const OriginalWorker = window.Worker;
    window.Worker = new Proxy(OriginalWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args);
        const requests = new Map();
        const postMessage = worker.postMessage.bind(worker);
        worker.postMessage = (...messages) => {
          const message = messages[0];
          if (message?.method === "$fmr") {
            const call = { url: String(args[0]), method: message.args[0], completed: false };
            requests.set(message.req, call);
            window.workerCalls.push(call);
          }
          return postMessage(...messages);
        };
        worker.addEventListener("message", ({ data }) => {
          const call = requests.get(data?.seq);
          if (call) {
            call.completed = true;
            call.error = data.err;
            call.result = data.res;
          }
        });
        return worker;
      },
    });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__monaco_regression.html`);
  await page.waitForFunction(() => window.monacoProbe);
  await check("Plaintext disposal initializes the YAML reset worker", async () => {
    await replaceModel("plaintext", "owned plaintext model");
    await replaceModel("json", '{"value": invalid}');
    return workerResponse("resetSchema", "yamlworker");
  });
  await check("JSON validation still runs in its own worker", diagnostics);
  await check("YAML validation runs in its own worker", async () => {
    await replaceModel("yaml", "key: [\n");
    return diagnostics();
  });
  await check("YAML formatting and completion use the language service", async () => {
    const formatted = await page.evaluate(async () => {
      const { editor, model } = window.monacoProbe;
      model.setValue("key:    true\n");
      await editor.getAction("editor.action.formatDocument").run();
      return model.getValue();
    });
    assert.equal(formatted, "key: true\n");
    await page.evaluate(() => {
      const { editor, model } = window.monacoProbe;
      model.setValue("key: tr");
      editor.setPosition({ lineNumber: 1, column: 8 });
      editor.focus();
      editor.trigger("regression", "editor.action.triggerSuggest", {});
    });
    const completion = await workerResponse("doComplete", "yamlworker");
    // Monaco also schedules word highlighting after a cursor move; close a settled editor below.
    await page.waitForTimeout(150);
    return { formatted, completion };
  });
  await check("YAML disposal and subsequent plaintext editing remain usable", async () => {
    await replaceModel("plaintext", "another owned model");
    await page.evaluate(() => {
      const { editor, model } = window.monacoProbe;
      editor.setModel(null);
      editor.dispose();
      model.dispose();
    });
    await workerResponse("resetSchema", "yamlworker");
    await page.waitForTimeout(1000);
  });
  Report.status = "passed";
} catch (error) {
  Report.status = "failed";
  Report.error = error.stack || String(error);
  console.error(Report.error);
  process.exitCode = 1;
} finally {
  Report.workerCalls = await page?.evaluate(() => window.workerCalls).catch(() => null);
  Report.markers = await page?.evaluate(() => window.monacoProbe?.monaco.editor.getModelMarkers({})).catch(() => null);
  await browser?.close();
  await server?.close();
  writeFileSync(path.join(OutputDir, "report.json"), JSON.stringify(Report, null, 2));
  console.log(`[monaco-workers] ${Report.status}; evidence ${OutputDir}`);
}
