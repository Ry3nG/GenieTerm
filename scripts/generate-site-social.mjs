// Copyright 2026, GenieTerm. Apache-2.0.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Logo = (await readFile(path.join(Root, "site/img/logo.svg"))).toString("base64");
const Film = (await readFile(path.join(Root, "site/media/overview.jpg"))).toString("base64");
const Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#292927" stroke-opacity=".35"/></pattern></defs>
<rect width="1200" height="630" fill="#101010"/><rect width="1200" height="630" fill="url(#grid)"/>
<image href="data:image/svg+xml;base64,${Logo}" x="48" y="36" width="40" height="40"/>
<text x="102" y="67" fill="#eeede9" font-family="Arial,sans-serif" font-size="32">GenieTerm</text>
<path d="M48 100H1152M48 564H1152" stroke="#30302e"/>
<text x="48" y="143" fill="#999995" font-family="monospace" font-size="12">REMOTE WORKSPACE / OPEN SOURCE</text>
<g font-family="Arial,sans-serif" font-size="26" fill="#eeede9"><text x="86" y="237">Terminal</text><text x="86" y="310">Files</text><text x="86" y="383">Host</text><text x="86" y="456">Command AI</text></g>
<g font-family="monospace" font-size="11" fill="#dfdcd1"><text x="48" y="234">01</text><text x="48" y="307">02</text><text x="48" y="380">03</text><text x="48" y="453">04</text></g>
<path d="M48 264H375M48 337H375M48 410H375M48 483H375" stroke="#30302e"/>
<rect x="423" y="142" width="729" height="378" fill="#080909" stroke="#444440"/>
<image href="data:image/jpeg;base64,${Film}" x="428" y="146" width="719" height="370"/>
<rect x="448" y="451" width="181" height="43" fill="#202020" stroke="#dfdcd1"/>
<path d="m465 464 12 8-12 8Z" fill="#dfdcd1"/>
<text x="488" y="477" fill="#eeede9" font-family="monospace" font-size="12">Watch the film</text>
<path d="M423 160v-18h18M1134 520h18v-18" fill="none" stroke="#dfdcd1" stroke-width="2"/>
<text x="48" y="600" fill="#999995" font-family="monospace" font-size="12">macOS / Linux · Apache-2.0</text>
<text x="922" y="600" fill="#dfdcd1" font-family="monospace" font-size="12">ry3ng.github.io/GenieTerm</text>
</svg>`;
await sharp(Buffer.from(Svg)).png().toFile(path.join(Root, "site/img/social.png"));
await sharp(path.join(Root, "site/media/overview.jpg"))
  .webp({ quality: 85, effort: 6 })
  .toFile(path.join(Root, "site/media/overview.webp"));
