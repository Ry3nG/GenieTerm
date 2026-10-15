// Copyright 2026, GenieTerm. Apache-2.0.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const checked = new Set();
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
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(16, 16, 16)");
    assert.ok(await page.locator("h1").evaluate((el) => parseFloat(getComputedStyle(el).fontSize) < 40));
    const film = await page.locator(".film-poster").boundingBox();
    assert.ok(film.y < height * 0.6, name + ": film in first viewport");
    assert.ok(film.width > width * (width > 760 ? 0.45 : 0.7), name + ": large film");
    assert.equal(await page.locator('#contribute a[href$="CONTRIBUTING.md"]').count(), 1);
    assert.equal(await page.locator('#contribute a[href$="ROADMAP.md"]').count(), 1);
    assert.equal(await page.locator('#contribute a[href$="issues"]').count(), 1);
    assert.ok((await page.locator("#contribute").innerText()).split(/\s+/).length <= 12);
    await page.screenshot({ path: Output + "/" + name + "-hero.png" });
    const manifest = await (await page.request.get(new URL("img/ui/provenance.json", Url).href)).json();
    for (const view of ["terminal", "files", "host", "ai"]) {
      await page.locator('[role=tab][data-view="' + view + '"]').click();
      await page.locator("[data-ui-image]").evaluate((img) => img.decode());
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        name + "/" + view + ": overflow"
      );
      const source = await page.locator("[data-ui-image]").getAttribute("src");
      assert.ok(source.endsWith(".svg"));
      const record = manifest.renders.find((r) => source.endsWith("/" + r.name + ".svg"));
      assert.ok(record, view + ": provenance");
      if (!checked.has(source)) {
        const response = await page.request.get(new URL(source, Url).href);
        const bytes = await response.body();
        assert.equal(createHash("sha256").update(bytes).digest("hex"), record.svgSha256);
        assert.ok(bytes.toString().includes("<foreignObject"));
        assert.ok(!/data:image\/(png|jpeg)/.test(bytes.toString()));
        checked.add(source);
      }
      if (view === "terminal") {
        await page.locator('[data-session-state="terminal-reattached"]').click();
        await page.locator("[data-ui-image]").evaluate((img) => img.decode());
        assert.match(await page.locator("[data-ui-image]").getAttribute("src"), /terminal-reattached.svg$/);
      }
      await page.locator("[data-expand]").click();
      assert.equal(await page.locator(".image-dialog").evaluate((el) => el.open), true);
      await page.locator("[data-enlarged-image]").evaluate((img) => img.decode());
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".image-dialog").open);
      assert.equal(await page.locator("[data-expand]").evaluate((el) => el === document.activeElement), true);
      if (name !== "compact")
        await page.screenshot({ path: Output + "/" + name + "-" + view + ".png", fullPage: true });
    }
    await page.locator("[role=tab][aria-selected=true]").focus();
    await page.keyboard.press("Home");
    assert.equal(await page.locator("[role=tab][aria-selected=true]").getAttribute("data-view"), "terminal");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("[role=tab][aria-selected=true]").getAttribute("data-view"), "files");
    await page.keyboard.press("End");
    assert.equal(await page.locator("[role=tab][aria-selected=true]").getAttribute("data-view"), "ai");
    await page.locator("[data-play-film]").click();
    assert.equal(await page.locator(".film-dialog").evaluate((el) => el.open), true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.querySelector(".film-dialog").open && document.querySelector("video").paused
    );
    assert.equal(await page.locator("[data-play-film]").evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.locator("[data-asset]").count(), 6);
    for (const link of await page.locator("[data-asset]").evaluateAll((links) => links.map((a) => a.href)))
      assert.match(link, /^https:\/\/github\.com\/Ry3nG\/GenieTerm\/releases\/download\/v\d+\.\d+\.\d+\//);
    console.log(name + ": dark layout, film, real SVG renders, provenance, navigation, dialogs and downloads passed");
    await context.close();
  }
  const nojs = await Browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await nojs.newPage();
  await page.goto(Url);
  assert.equal(await page.locator('[data-asset][href*="v1.4.1"]').count(), 6);
  assert.equal(await page.locator("[data-play-film]").getAttribute("href"), "media/overview.mp4");
  assert.equal(await page.locator("[data-expand]").getAttribute("href"), "img/ui/host.svg");
  assert.equal(await page.locator(".fallback-views a").count(), 4);
  assert.equal(await page.locator("[role=tab]:enabled").count(), 0);
  await nojs.close();
  const offline = await Browser.newContext({ reducedMotion: "reduce" });
  await offline.route("https://api.github.com/repos/Ry3nG/GenieTerm/releases/latest", (route) => route.abort());
  const p = await offline.newPage();
  await p.goto(Url);
  await p.waitForFunction(() => document.querySelector("[data-release-status]").textContent.includes("Check GitHub"));
  assert.equal(await p.locator('[data-asset][href*="v1.4.1"]').count(), 6);
  assert.equal(await p.evaluate(() => document.getAnimations().length), 0);
  await offline.close();
  assert.deepEqual(Errors, []);
  console.log("No-JavaScript, release API failure and reduced-motion checks passed; no page or asset errors");
} finally {
  await Browser.close();
}
