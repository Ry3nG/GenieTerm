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
].find((p) => p && existsSync(p));
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
    page.on("pageerror", (e) => Errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400 && new URL(r.url()).origin === new URL(Url).origin) Errors.push(r.status() + " " + r.url());
    });
    await page.goto(Url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("iframe[src]").count(), 0, "Interactive bundles load on selection");
    assert.equal(await page.getByRole("link", { name: "GitHub", exact: true }).count(), 1);
    assert.equal(await page.locator(".github-action svg").count(), 1);
    assert.equal(await page.locator('a[href="https://github.com/Ry3nG/GenieTerm/issues"]').count(), 1);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(16, 16, 16)");
    const film = await page.locator(".film-poster").boundingBox();
    assert.ok(film.y < height * 0.6 && film.width > width * 0.7);
    await page.locator("[data-play-film]").click();
    await page.waitForFunction(() => document.querySelector("[data-film]").currentTime > 0);
    assert.equal(await page.locator("[data-film]").evaluate((v) => v.controls && v.playsInline), true);
    assert.equal(context.pages().length, 1);
    await page.locator("[data-film]").evaluate((v) => v.pause());
    for (const view of ["terminal", "files", "host", "ai"]) {
      await page.locator('[role=tab][data-view="' + view + '"]').click();
      if (view === "terminal") {
        await page.locator(".terminal-pair img").evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
        const boxes = await page
          .locator(".terminal-pair img")
          .evaluateAll((es) => es.map((e) => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })));
        assert.equal(boxes[0].y, boxes[1].y);
        assert.ok(boxes[1].x > boxes[0].x);
      }
      if (view === "files") await page.locator("[data-ui-image]").evaluate((i) => i.decode());
      if (view === "host") {
        await page.locator("[data-live-host]").scrollIntoViewIfNeeded();
        const host = page.frameLocator("[data-live-host]");
        await host.getByRole("tab", { name: "Processes", exact: true }).click();
        await host.getByText("tensorboard", { exact: true }).waitFor();
        await host.getByRole("tab", { name: /^Ports/ }).click();
        await host.getByRole("button", { name: "Forward a port", exact: true }).waitFor();
        const count = await host.getByRole("button", { name: "Stop forwarding", exact: true }).count();
        await host.getByRole("button", { name: "Forward & open", exact: true }).first().click();
        await page.waitForFunction(
          (expected) =>
            document
              .querySelector("[data-live-host]")
              .contentDocument.querySelectorAll('button[aria-label="Stop forwarding"]').length === expected,
          count + 1
        );
        await host.getByRole("tab", { name: "Overview", exact: true }).click();
        if (width >= 768) {
          await host.getByRole("button", { name: /^CPU/ }).first().click();
          await host.getByText("Load average", { exact: true }).waitFor();
        }
        const root = host.locator("html");
        assert.equal(await root.evaluate((e) => e.scrollWidth > e.clientWidth + 1), false, name + ": Host overflow");
        const fontBytes = await root.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .filter((r) => r.name.includes("/fonts/") && /\.(woff2|ttf)$/.test(r.name))
            .reduce((sum, r) => sum + r.encodedBodySize, 0)
        );
        assert.ok(fontBytes < 250000, "Interactive text font payload exceeds budget");
      }
      if (view === "ai") {
        await page.locator("[data-live-ai]").scrollIntoViewIfNeeded();
        const ai = page.frameLocator("[data-live-ai]");
        await ai.getByRole("button", { name: "Send", exact: true }).click();
        await ai.getByRole("button", { name: /^Insert/ }).click();
        await page.waitForFunction(() =>
          document
            .querySelector("[data-live-ai]")
            .contentDocument.querySelector(".xterm-rows")
            ?.textContent.includes("find .")
        );
        await ai.getByRole("button", { name: "Fix", exact: true }).click();
        await ai.getByText("The build needs Node.js type definitions.").waitFor();
        await ai.getByRole("button", { name: "Explain", exact: true }).click();
        await ai.getByText("Shows the total disk space", { exact: false }).waitFor();
        assert.equal(
          await ai.locator("html").evaluate((e) => e.scrollWidth > e.clientWidth + 1),
          false,
          name + ": AI overflow"
        );
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        name + "/" + view + ": page overflow"
      );
      if (name !== "compact")
        await page.screenshot({ path: Output + "/" + name + "-" + view + ".png", fullPage: true });
    }
    await page.locator("[role=tab][aria-selected=true]").focus();
    await page.keyboard.press("Home");
    assert.equal(await page.locator("[role=tab][aria-selected=true]").getAttribute("data-view"), "terminal");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("[role=tab][aria-selected=true]").getAttribute("data-view"), "files");
    assert.equal(await page.locator("#contribute a").count(), 2);
    assert.equal(await page.locator("[data-asset]").count(), 6);
    console.log(
      name + ": inline video, paired terminals, Host pages and forwarding, AI Write/Fix/Explain/Insert, layout passed"
    );
    await context.close();
  }
  const nojs = await Browser.newContext({ javaScriptEnabled: false });
  const page = await nojs.newPage();
  await page.goto(Url);
  assert.equal(await page.locator("[data-film]").evaluate((v) => v.controls), true);
  assert.equal(await page.locator(".fallback-interface").isVisible(), true);
  assert.equal(await page.locator('[data-asset][href*="v1.4.1"]').count(), 6);
  assert.equal(await page.locator("[role=tab]:enabled").count(), 0);
  await nojs.close();
  const offline = await Browser.newContext();
  await offline.route("https://api.github.com/repos/Ry3nG/GenieTerm/releases/latest", (r) => r.abort());
  const p = await offline.newPage();
  await p.goto(Url);
  await p.waitForFunction(() => document.querySelector("[data-release-status]").textContent.includes("Check GitHub"));
  assert.equal(await p.locator('[data-asset][href*="v1.4.1"]').count(), 6);
  await offline.close();
  assert.deepEqual(Errors, []);
  console.log("No-JavaScript and release API fallbacks passed; no page or asset errors");
} finally {
  await Browser.close();
}
