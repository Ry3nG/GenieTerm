# GenieTerm film

The product film, made in code. It follows one training run from start to finish. It opens on the familiar pain: an ordinary terminal over SSH, the laptop lid closes, and the run is gone ("Broken pipe"). Then the same run in GenieTerm:

1. Connect to the server and edit its files.
2. Close the lid and come back to the job still running.
3. See the whole machine and open its TensorBoard with one click.
4. When an install fails, ask the AI you already use.

`TREATMENT.md` has the story, the shot list and the rules the film follows.

- **Rebuilt, not recorded.** The interface is a vector kit (`src/kit/`) drawn from the app's own source and from geometry measured over CDP. It stays sharp at any camera distance and carries staged, self-consistent data. Steps are shortened, but nothing is shown that the app doesn't do.
- **One device, shot twice.** The laptop is a brand-free model built in Blender by `blender/laptop.py`. The cold open and the durable chapter use the identical framing, and that match is the proof. The screen is a DOM layer warped onto the glass with a homography, so the camera can push straight through it into the UI.
- **Calm motion.** UI moves on short, near-critically damped springs and the camera on long additive springs, so it never stops dead. Labels use lift-and-recede instead of arrows, one at a time.
- **Paced to music.** 90 BPM, so a bar is exactly 160 frames at 60 fps, and every scene starts on a bar line (`src/v3/timeline.ts`). The score goes quiet when a lid closes and comes back with the session. Sound cues are generated from the same constants the scenes animate with (`src/v3/cues.ts`).
- **No licensed audio.** `audio/score_v3.py` synthesizes the score and `audio/sfx.py` makes the foley.

## Layout

| Path | What it is |
| --- | --- |
| `src/v3/` | One component per scene, `FilmV3.tsx` to assemble them, `timeline.ts` for bar layout, `cues.ts` for sound cues |
| `src/kit/` | The vector UI kit (window, terminal, blocks, files, editor, Host, Command AI sheet, forward dock), motion constants, stage and camera, labels, the 3D laptop and the screen projection |
| `blender/` | The laptop generator (`laptop.py`), its brief and notes; output goes to `public/models/laptop.glb` |
| `audio/` | Score, sound effects, the cue exporter and the mix |
| `src/v2/`, `src/lib/`, `capture/`, `demo/` | The earlier capture-based cut (`GenieFilmV2`) and the CDP capture pipeline it used |

## Making it

You need Node and Python with numpy, scipy, pedalboard, pyloudnorm and soundfile. To rebuild the laptop you also need Blender 5's `bpy` module (see `blender/NOTES.md`).

```sh
npm install
npx tsx audio/export-cues-v3.ts audio/cues_v3.json
python audio/score_v3.py audio/score_v3.wav
python audio/sfx.py audio/cues_v3.json audio/sfx_v3.wav
python audio/mix.py audio/score_v3.wav audio/sfx_v3.wav public/film_v3.wav
npx remotion studio src/index.ts      # preview
npx remotion render src/index.ts GenieFilm out/genieterm-film-4k.mp4 --gl=angle --crf=16 --scale=2
```

The 3D shots need a WebGL backend: pass `--gl=angle` when rendering.
