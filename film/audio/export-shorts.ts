// Writes each short's cues and music spec to audio/shorts/<id>.json.
import fs from "node:fs";
import { overviewSound, shortSound } from "../src/shorts/cues";
import { overviewLayout } from "../src/shorts/Overview";
import { shortLength } from "../src/shorts/ShortFilm";
import { Shorts } from "../src/shorts/specs";

fs.mkdirSync("audio/shorts", { recursive: true });
for (const s of Shorts) {
    const { cues, music } = shortSound(s);
    const seconds = shortLength(s) / 60;
    fs.writeFileSync(`audio/shorts/${s.id}.json`, JSON.stringify({ id: s.id, seconds: seconds + 2, frames: shortLength(s), cues, music }, null, 1));
    console.log(`${s.id}: ${cues.length} cues, ${seconds.toFixed(1)} s`);
}

{
    const layout = overviewLayout();
    const { cues, music } = overviewSound(layout);
    fs.writeFileSync("audio/shorts/Overview.json", JSON.stringify({ id: "Overview", seconds: layout.total / 60 + 2, frames: layout.total, cues, music }, null, 1));
    console.log(`Overview: ${cues.length} cues, ${(layout.total / 60).toFixed(1)} s`);
}
