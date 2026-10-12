// Writes the v3 sound-effect cues for audio/sfx.py.
import fs from "node:fs";
import { cuesV3 } from "../src/v3/cues";
import { TOTAL } from "../src/v3/timeline";

const out = process.argv[2] ?? "audio/cues_v3.json";
const cues = cuesV3();
fs.writeFileSync(out, JSON.stringify({ seconds: TOTAL / 60 + 3, cues }, null, 1));
console.log(`${cues.length} cues -> ${out}`);
