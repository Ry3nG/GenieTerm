// Copyright 2026, GenieTerm. Apache-2.0.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const Base = process.argv[2] || "http://127.0.0.1:7007";
const Output = "site/img/ui";
const TerminalIconFont = `@font-face{font-family:'Font Awesome 6 Pro';font-style:normal;font-weight:900;src:url(data:font/woff2;base64,${readFileSync("site/fonts/status-icon.woff2").toString("base64")}) format('woff2');}`;
const EmbeddedFonts = [
  ["Inter", "site/fonts/inter-latin.woff2", "100 900"],
  ["Hack", "site/fonts/hack-latin.woff2", "400"],
  ["Hack", "site/fonts/hack-latin-bold.woff2", "700"],
]
  .map(
    ([family, file, weight]) =>
      `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(file).toString("base64")}) format('woff2');}`
  )
  .join("\n");
const Styles = [
  "display",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "box-sizing",
  "padding",
  "margin",
  "border",
  "border-radius",
  "border-collapse",
  "border-spacing",
  "background",
  "color",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "line-height",
  "letter-spacing",
  "white-space",
  "text-align",
  "text-transform",
  "text-decoration",
  "text-overflow",
  "text-indent",
  "vertical-align",
  "word-break",
  "overflow-wrap",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-self",
  "align-content",
  "justify-content",
  "justify-items",
  "gap",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "grid-auto-flow",
  "z-index",
  "transform",
  "transform-origin",
  "box-shadow",
  "clip-path",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "d",
  "visibility",
  "content",
  "list-style",
  "object-fit",
  "appearance",
  "filter",
];
const Cases = [
  {
    name: "terminal-reattached",
    preview: "site-terminal&state=reattached&width=540",
    selector: "[data-site-terminal]",
    ready: "[data-ready=true]",
    source: "frontend/preview/previews/site-terminal.preview.tsx",
    component: "xterm.js + BlockStatusLineContent",
  },
  {
    name: "terminal",
    preview: "site-terminal&width=540",
    selector: "[data-site-terminal]",
    ready: "[data-ready=true]",
    source: "frontend/preview/previews/site-terminal.preview.tsx",
    component: "xterm.js + BlockStatusLineContent",
  },
  {
    name: "host",
    preview: "host&hostheight=700",
    selector: "[data-blockid]",
    source: "frontend/app/view/host/host.tsx",
    component: "HostView",
  },
  {
    name: "files",
    preview: "site-files",
    selector: "[data-site-files]",
    source: "frontend/app/view/preview/preview-directory.tsx",
    component: "DirectoryPreview",
  },
  {
    name: "command-ai",
    preview: "commandai",
    selector: '[data-case="Fix"] [data-onboarding="commandai-sheet"]',
    source: "frontend/app/view/term/command-composer-ui.tsx",
    component: "CommandAiSheet",
  },
];
const Executable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
const Browser = await chromium.launch({ executablePath: Executable });
mkdirSync(Output, { recursive: true });
const records = [];
try {
  for (const item of Cases) {
    const page = await Browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 3 });
    await page.goto(`${Base}/?preview=${item.preview}`, { waitUntil: "networkidle" });
    const target = page.locator(item.selector).first();
    await target.waitFor();
    if (item.ready) await page.locator(item.ready).waitFor();
    await page.evaluate(() => document.fonts.ready);
    // html-to-image deep-clones SVG subtrees, so their inherited CSS variables must be resolved first.
    await target.evaluate((element) => {
      for (const node of element.querySelectorAll("svg *")) {
        const computed = getComputedStyle(node);
        for (const property of [
          "fill",
          "stroke",
          "stop-color",
          "stop-opacity",
          "stroke-width",
          "stroke-dasharray",
          "stroke-linecap",
          "stroke-linejoin",
          "vector-effect",
        ]) {
          const value = computed.getPropertyValue(property).replace(/url\(["']?[^#)]*#([^"')]+)["']?\)/g, "url(#$1)");
          node.style.setProperty(property, value);
        }
      }
    });
    await page.addScriptTag({ path: "node_modules/html-to-image/dist/html-to-image.js" });
    const svg = await target.evaluate(
      async (element, { properties, fonts, terminal }) => {
        const metrics = [element, ...element.querySelectorAll("*")].map((node, index) => {
          node.setAttribute("data-render-index", String(index));
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          const inset = (names) =>
            names.reduce((sum, name) => sum + (parseFloat(style.getPropertyValue(name)) || 0), 0);
          const contentBox = style.boxSizing === "content-box";
          return {
            fontSize: style.fontSize,
            width:
              style.width.endsWith("px") && style.transform === "none"
                ? box.width -
                  (contentBox ? inset(["padding-left", "padding-right", "border-left-width", "border-right-width"]) : 0)
                : null,
            height:
              style.height.endsWith("px") && style.transform === "none"
                ? box.height -
                  (contentBox ? inset(["padding-top", "padding-bottom", "border-top-width", "border-bottom-width"]) : 0)
                : null,
          };
        });
        const fontEmbedCSS = (terminal ? "" : await window.htmlToImage.getFontEmbedCSS(element)) + "\n" + fonts;
        const url = await window.htmlToImage.toSvg(element, {
          backgroundColor: "#101012",
          includeStyleProperties: properties,
          fontEmbedCSS,
        });
        const document = new DOMParser().parseFromString(
          decodeURIComponent(url.slice(url.indexOf(",") + 1)),
          "image/svg+xml"
        );
        for (const node of document.querySelectorAll("[data-render-index]")) {
          const measured = metrics[Number(node.getAttribute("data-render-index"))];
          node.style.fontSize = measured.fontSize;
          // CSSOM serialization rounds fractional widths; rounding up prevents flex items wrapping by 1/64 px.
          if (measured.width != null) node.style.width = `${Math.ceil(measured.width * 100) / 100}px`;
          if (measured.height != null) node.style.height = `${Math.ceil(measured.height * 100) / 100}px`;
          node.removeAttribute("data-render-index");
        }
        for (const node of element.querySelectorAll("[data-render-index]")) node.removeAttribute("data-render-index");
        element.removeAttribute("data-render-index");
        return new XMLSerializer().serializeToString(document);
      },
      {
        properties: Styles,
        fonts: EmbeddedFonts + (item.name.startsWith("terminal") ? TerminalIconFont : ""),
        terminal: item.name.startsWith("terminal"),
      }
    );
    if (svg.includes("data:image/png") || svg.includes("data:image/jpeg"))
      throw new Error(`${item.name}: unexpected raster content in SVG`);
    writeFileSync(`${Output}/${item.name}.svg`, svg);
    await target.screenshot({ path: `${Output}/${item.name}.png`, animations: "disabled" });
    records.push({
      ...item,
      dimensions: await target.boundingBox(),
      sourceSha256: createHash("sha256").update(readFileSync(item.source)).digest("hex"),
      svgSha256: createHash("sha256").update(svg).digest("hex"),
    });
    console.log(`${item.name}: ${item.component}, SVG + 3x PNG, ${svg.length} SVG bytes`);
    await page.close();
  }
  writeFileSync(
    `${Output}/provenance.json`,
    JSON.stringify(
      {
        version: JSON.parse(readFileSync("package.json")).version,
        baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        data: "Illustrative fixtures rendered with product components; no live SSH or AI requests.",
        renders: records,
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await Browser.close();
}
