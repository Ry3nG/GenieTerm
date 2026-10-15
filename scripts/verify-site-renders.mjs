// Copyright 2026, GenieTerm. Apache-2.0.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const Base = process.argv[2] || "http://127.0.0.1:58764/";
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
const browser = await chromium.launch({ executablePath });
const measurements = [];
try {
  const page = await browser.newPage();
  for (const name of ["terminal", "terminal-reattached"]) {
    await page.goto(new URL(`img/ui/${name}.svg`, Base).href);
    await page.evaluate(() => document.fonts.ready);
    const measured = await page.evaluate(() => {
      const rect = (e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const screen = document.querySelector(".xterm-screen");
      const status = document.querySelector("[data-block-status]");
      return {
        row: rect(document.querySelector(".xterm-rows > div")),
        screen: rect(screen),
        container: rect(screen.parentElement),
        status: status ? rect(status) : null,
        buttons: [...document.querySelectorAll("button")].map(rect),
      };
    });
    assert.ok(measured.screen.right <= measured.container.right + 0.1, name + ": terminal exceeds its container");
    if (measured.status) {
      assert.equal(measured.buttons.length, 2);
      assert.equal(measured.buttons[0].y, measured.buttons[1].y, "Action buttons must share a baseline");
      for (const button of measured.buttons) {
        assert.ok(button.bottom <= measured.status.bottom + 0.1, "Action button escapes status bar");
        assert.ok(button.right <= measured.status.right + 0.1, "Action button escapes status bar");
      }
    }
    measurements.push(measured);
  }
  assert.deepEqual(measurements[0].row, measurements[1].row, "Comparison text origins and line boxes differ");
  console.log(
    "SVG geometry verified: status controls contained, text origins and baselines match, no terminal overflow"
  );
} finally {
  await browser.close();
}
