// Writes the sound-effect cues from the edit decision list for audio/sfx.py.
import fs from "node:fs";
import { cues } from "../src/edl";
import { DURATION, FPS } from "../src/timeline";

const out = process.argv[2] ?? "audio/cues.json";
fs.writeFileSync(out, JSON.stringify({ seconds: DURATION / FPS + 1, cues: cues() }, null, 1));
console.log(`${cues().length} cues -> ${out}`);
