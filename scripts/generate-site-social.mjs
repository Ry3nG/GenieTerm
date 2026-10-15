// Copyright 2026, GenieTerm. Apache-2.0.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Logo = (await readFile(path.join(Root, "site/img/logo.svg"))).toString("base64");
const Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#eeeee7"/>
<image href="data:image/svg+xml;base64,${Logo}" x="56" y="40" width="32" height="32"/>
<text x="100" y="64" fill="#252922" font-family="Arial,sans-serif" font-size="24" font-weight="bold">GenieTerm<tspan fill="#af3d1b">_</tspan></text>
<path d="M56 98H1144M56 565H1144" stroke="#c8cbc0"/>
<text x="56" y="156" fill="#666b60" font-family="monospace" font-size="12" letter-spacing="1.5">THE REMOTE-NATIVE TERMINAL</text>
<g font-family="Arial,sans-serif" font-size="62" font-weight="bold" letter-spacing="-3" fill="#252922">
<text x="52" y="240">For people</text><text x="52" y="314">who live in SSH<tspan fill="#af3d1b">.</tspan></text></g>
<text x="56" y="380" fill="#666b60" font-family="Arial,sans-serif" font-size="19">A shell, its files, and the whole machine.</text>
<text x="56" y="412" fill="#252922" font-family="Arial,sans-serif" font-size="19">One workspace.</text>
<rect x="645" y="158" width="499" height="345" fill="#171b19"/>
<path d="M645 202H1144M645 465H1144" stroke="#363e37"/>
<g font-family="monospace" font-size="13" fill="#c5cec0">
<text x="667" y="185" fill="#b9d88a">● atlas / vision-lab</text>
<text x="667" y="239">$ python train.py</text>
<text x="667" y="280" fill="#a0ac9f">epoch 24/50   loss 0.141   acc 95.4%</text>
<text x="667" y="310" fill="#a0ac9f">epoch 25/50   loss 0.136   acc 95.7%</text>
<text x="667" y="363" fill="#b9d88a">checkpoint saved → runs/latest.pt</text>
<text x="667" y="412">▌</text>
<text x="667" y="489" fill="#b9d88a">● Reattached · same process, same session</text></g>
<text x="56" y="600" fill="#666b60" font-family="monospace" font-size="12">OPEN SOURCE / macOS / Linux</text>
<text x="922" y="600" fill="#666b60" font-family="monospace" font-size="12">ry3ng.github.io/GenieTerm</text>
</svg>`;
await sharp(Buffer.from(Svg)).png().toFile(path.join(Root, "site/img/social.png"));
