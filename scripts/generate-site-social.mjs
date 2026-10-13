// Copyright 2026, GenieTerm. Apache-2.0.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const Capture = (await readFile(path.join(Root, "site/img/host-overview.png"))).toString("base64");
const Logo = (await readFile(path.join(Root, "site/img/logo.png"))).toString("base64");
const Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><clipPath id="capture"><rect x="590" y="173" width="720" height="402" rx="12"/></clipPath></defs>
<rect width="1200" height="630" fill="#08090c"/>
<image href="data:image/png;base64,${Logo}" x="58" y="44" width="37" height="37"/>
<text x="108" y="71" fill="#f3f5f8" font-family="Arial,sans-serif" font-size="25" font-weight="bold">GenieTerm</text>
<text x="60" y="192" fill="#88b5ef" font-family="Arial,sans-serif" font-size="13" letter-spacing="2">THE REMOTE-NATIVE TERMINAL</text>
<g font-family="Arial,sans-serif" font-size="73" font-weight="bold" letter-spacing="-4">
<text x="55" y="286" fill="#f3f5f8">Your servers.</text>
<text x="55" y="373" fill="#9cb6dc">Within reach.</text></g>
<text x="60" y="431" fill="#a9b6ca" font-family="Arial,sans-serif" font-size="19">Your files, GPUs and services. One workspace.</text>
<rect x="584" y="167" width="732" height="414" rx="17" fill="#121722" stroke="#344764"/>
<image href="data:image/png;base64,${Capture}" x="590" y="173" width="720" height="402" clip-path="url(#capture)"/>
<path d="M60 562h468" stroke="#263247"/>
<text x="60" y="596" fill="#8697b1" font-family="Arial,sans-serif" font-size="12">FREE &amp; OPEN SOURCE · macOS · Linux · Windows preview</text>
</svg>`;
await sharp(Buffer.from(Svg)).png().toFile(path.join(Root, "site/img/social.png"));
