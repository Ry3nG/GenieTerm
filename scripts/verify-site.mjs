// Copyright 2026, GenieTerm. Apache-2.0.
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const Url = process.argv[2] || "http://127.0.0.1:58764/";
const Output = "artifacts/site-qa";
const Executable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && existsSync(candidate));
const Browser = await chromium.launch({ executablePath: Executable, headless: true });
const Errors = [];
mkdirSync(Output, { recursive: true });

try {
  for (const [name, width, height] of [
    ["desktop", 1440, 1100],
    ["narrow", 768, 1024],
    ["mobile", 390, 844],
    ["compact", 320, 740],
  ]) {
    const context = await Browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("pageerror", (error) => Errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && new URL(response.url()).origin === new URL(Url).origin) {
        Errors.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto(Url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    for (const view of ["sessions", "host", "files", "ai"]) {
      await page.locator(`[data-view="${view}"]`).click();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${name}/${view}: horizontal overflow`
      );
      assert.equal(await page.locator(".workspace img,.workspace canvas").count(), 0);
      if (view === "sessions") {
        await page.locator("[data-session]").click();
        assert.match(await page.locator("[data-session-label]").innerText(), /Disconnected/);
        assert.match(await page.locator(".process-state").innerText(), /RUNNING/);
        await page.locator("[data-session]").click();
        assert.match(await page.locator(".terminal-output").innerText(), /buffered output restored/);
      }
      if (view === "host") {
        await page.locator("[data-forward]").click();
        assert.match(await page.locator("[data-port-result]").innerText(), /localhost:6006/);
        await page.locator("[data-forward]").click();
        assert.equal(await page.locator("[data-port-result]").innerText(), "");
      }
      if (view === "files") {
        await page.locator('[data-file="results.csv"]').click();
        assert.match(await page.locator("[data-file-content]").innerText(), /epoch,loss,accuracy/);
      }
      if (view === "ai") {
        await page.locator("[data-insert]").click();
        assert.equal(await page.locator("[data-ai-prompt]").innerText(), "npm install --save-dev @types/node");
      }
      if (name !== "compact") {
        await page.screenshot({ path: `${Output}/${name}-${view}.png`, fullPage: true });
      }
    }
    await page.locator('[data-view="sessions"]').click();
    await page.locator("[data-session]").click();
    await page.locator('[data-view="host"]').click();
    await page.locator('[data-view="sessions"]').click();
    assert.equal(await page.locator(".is-disconnected").count(), 0);
    await page.locator("[role=tab][aria-selected=true]").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("[role=tab][aria-selected=true]").getAttribute("data-view"), "host");
    await page.keyboard.press("End");
    assert.equal(await page.locator("[role=tab][aria-selected=true]").getAttribute("data-view"), "ai");
    await page.keyboard.press("Home");
    assert.equal(await page.locator("[role=tab][aria-selected=true]").getAttribute("data-view"), "sessions");
    await page.locator("[data-play-film]").click();
    assert.equal(await page.locator("dialog").evaluate((element) => element.open), true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog").open && document.querySelector("video").paused);
    assert.equal(
      await page.locator("[data-play-film]").evaluate((element) => element === document.activeElement),
      true
    );
    assert.equal(await page.locator("[data-asset]").count(), 6);
    for (const link of await page.locator("[data-asset]").evaluateAll((links) => links.map((link) => link.href))) {
      assert.match(link, /^https:\/\/github\.com\/Ry3nG\/GenieTerm\/releases\/download\/v\d+\.\d+\.\d+\//);
    }
    console.log(`${name}: native demos, interactions, keyboard, film, downloads and layout passed`);
    await context.close();
  }

  const noJs = await Browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await noJs.newPage();
  await page.goto(Url);
  assert.equal(await page.locator('[data-asset][href*="v1.4.1"]').count(), 6);
  assert.equal(await page.locator("[data-play-film]").getAttribute("href"), "media/overview.mp4");
  assert.equal(await page.locator("[role=tab]:enabled").count(), 0);
  await noJs.close();
  console.log("No-JavaScript download and film fallback passed");

  const offline = await Browser.newContext();
  await offline.route("https://api.github.com/repos/Ry3nG/GenieTerm/releases/latest", (route) => route.abort());
  const offlinePage = await offline.newPage();
  await offlinePage.goto(Url);
  await offlinePage.waitForFunction(() =>
    document.querySelector("[data-release-status]").textContent.includes("Check GitHub")
  );
  assert.equal(await offlinePage.locator('[data-asset][href*="v1.4.1"]').count(), 6);
  await offlinePage.locator('[data-view="ai"]').click();
  assert.equal(await offlinePage.locator("[data-insert]").count(), 1);
  await offline.close();
  assert.deepEqual(Errors, []);
  console.log("Release API failure fallback passed; no page or asset errors");
} finally {
  await Browser.close();
}
