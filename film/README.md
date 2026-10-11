# GenieTerm film

The product film, made in code. It follows one training run, start to finish: connect to a GPU server, open the project, start training and close the laptop, come back to a busy GPU and a loss curve, then make it faster when an install fails and Command AI fixes it.

- **The real app for interaction.** Every click, keystroke and window is a 4× capture of the GenieTerm dev build, driven over CDP against a GPU container. The failing install and Claude Code's fix are real takes.
- **Designed visuals where they explain more.** A diagram shows a session surviving a closed lid. The Host GPU card is redrawn in vector on the app's own layout, so its numbers belong to the film's training run and not to other jobs sharing the machine. Chapter titles, callouts, focus rings and highlights guide the eye.
- **Paced to music.** The score runs at 90 BPM, so a bar is exactly 160 frames at 60 fps. `src/edl.ts` times every beat of every chapter, and the sound effects are generated from the same list.
- **No licensed audio.** `audio/score.py` synthesizes a deliberately soft score; `audio/sfx.py` makes the keystrokes, clicks, whooshes and chime.

## Layout

| Path | What it is |
| --- | --- |
| `capture/` | CDP driver and the shoot script that films each scene in the dev app |
| `public/captures/` | The captured frames (not checked in; produced by the shoot) |
| `src/edl.ts` | Chapter timing, typing schedules, sound cues |
| `src/v2/` | One component per chapter, plus `FilmV2.tsx`, which puts the story together |
| `src/lib/` | Camera, window chrome, chapter titles, guides (callouts, focus rings, highlights), diagram, GPU card, cursor, end card |
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
