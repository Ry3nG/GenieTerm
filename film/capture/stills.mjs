// Renders chosen frames of the film for review: node capture/stills.mjs out/dir 10 200 ...
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";

const [outDir, ...frames] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "GenieFilm", inputProps: {} });
for (const f of frames.map(Number)) {
    await renderStill({ serveUrl, composition, frame: f, output: path.join(outDir, `f${String(f).padStart(5, "0")}.png`), scale: 1 });
    process.stdout.write(`${f} `);
}
console.log("done");
