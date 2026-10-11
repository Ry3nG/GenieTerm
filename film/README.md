# GenieTerm film

The product film, made in code. The picture comes from real captures of GenieTerm, and the camera, cuts, sound and music are programmed here.

- **Real pixels only.** Every frame of the app is a 4× capture of the real GenieTerm dev build, connected to a real GPU host. The commands are typed one key at a time and captured after each paint. The output, the AI answer and the install that works are whatever happened during the take.
- **Edited on the beat.** The score runs at 100 BPM, so a bar is exactly 144 frames at 60 fps. `src/edl.ts` places every scene, keystroke and click on that grid, and the sound effects are generated from the same list.
- **No licensed audio.** `audio/score.py` synthesizes the music and `audio/sfx.py` the keystrokes, whooshes and the chime.

## Layout

| Path | What it is |
| --- | --- |
| `capture/` | CDP driver and the shoot script that films each scene in the dev app |
| `public/captures/` | The captured frames (not checked in; produced by the shoot) |
| `src/edl.ts` | Scene timing, typing schedules, sound cues |
| `src/film/` | One component per scene, plus `Film.tsx`, which cuts them together |
| `src/lib/` | Camera, window chrome, vector type for close-ups, cursor, lid, lift, end card |
| `audio/` | Score, sound effects and the mix |
| `demo/` | The `gpu-box` container: a GPU-enabled Debian image with `ml` user, sshd and the small `llm` project it trains |

## Making it

You need:

- the dev app running on a separate profile with CDP on port 9333 (`capture/launch.sh`);
- a GPU host reachable as the `gpu-box` connection. On any machine with Docker and the NVIDIA runtime, put your SSH public key in `demo/authorized_keys`, then build and run the container:

  ```sh
  docker build -t genie-demo:film demo
  docker run -d --name genie-gpu-box --hostname gpu-box --gpus all -p 127.0.0.1:2222:22 genie-demo:film \
      sh -c "chmod 600 /etc/ssh/ssh_host_*_key; exec /usr/sbin/sshd -D -e"
  ```

- Python with numpy, scipy, pedalboard, pyloudnorm and soundfile.

```sh
npm install
node capture/shoot.mjs                # films every scene into public/captures
node capture/manifest.mjs             # indexes the captures for the composition
npx tsx audio/export-cues.ts audio/cues.json
python audio/score.py public/score.wav
python audio/sfx.py audio/cues.json public/sfx.wav
python audio/mix.py public/score.wav public/sfx.wav public/film.wav
npx remotion studio src/index.ts      # preview
npx remotion render src/index.ts GenieFilm out/genieterm-film-4k.mp4 --codec=h264 --crf=16 --scale=2
```

While a take is running, don't edit files in the repository. The dev server watches the whole tree and reloads the app.
