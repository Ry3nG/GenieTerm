# GenieTerm — film treatment (v3)

**Viewer:** an engineer who trains models or runs services on a machine they don't sit in front of, and has never heard of GenieTerm.
**One sentence they should leave with:** *GenieTerm keeps my remote session alive, shows me the whole machine, and lets the AI I already use fix my commands.*
**Runtime:** about 1:45 at 90 BPM (40 bars). No voiceover. Music, quiet foley, and the product.

## Spine

One task from start to finish: a training run on a remote GPU machine (`atlas`). Each feature appears because the task needs it. The film opens on the pain and repeats that exact shot later, this time with GenieTerm.

| # | Bars | Beat | What we see | Text |
|---|---|---|---|---|
| 1 | 1–4 | **Cold open: the pain** | A 3D laptop in a dark studio, its screen showing a plain terminal: `ssh atlas`, `python train.py`, epochs ticking. The lid closes and the room goes quiet. Light shifts. The lid opens and the camera pushes into the screen: `client_loop: send disconnect: Broken pipe`. The run is gone. | none (the error line is the text) |
| 2 | 5–6 | **Title** | Black. `GenieTerm▌` types, then the line under it. The block cursor flies down and becomes the caret of a terminal as the GenieTerm window rises out of the dark. | `GenieTerm` / `The terminal for machines you don't sit in front of.` |
| 3 | 7–11 | **Connect · files · blocks** (supporting, shown in passing) | The connection picker opens and `atlas` is clicked. The header turns into the remote host. The Files sidebar opens `~/llm`, and `config.yaml` opens in the editor: `lr: 3e-4` changes to `6e-4`, then Save. Back in the terminal, `python train.py` becomes a **command block** with a live "Running" bar. | one label: `Every command in its own block.` |
| 4 | 12 | Card | | `Close the lid. Keep training.▌` |
| 5 | 13–19 | **Hero 1: durable sessions** | The camera pulls out of the UI into the laptop: **the cold-open shot, framed identically**. The lid closes, and a small server card at the right keeps counting epochs (its tick continues under the silence). Night passes. The lid opens, the camera pushes back into the screen, and the same block is still running, the epoch now 87. | `Still running. Nothing lost.` |
| 6 | 20 | Card | | `See the whole machine.▌` |
| 7 | 21–26 | **Hero 2: Host + ports** | The Host view: GPU utilisation draws in, `python train.py` heads the process list, and the listening ports appear. In the terminal, `tensorboard --logdir runs` prints `localhost:6006` and the forward offer slides up. One click opens a browser window floating forward, with the loss curve drawing down. | `One click. localhost:6006.` |
| 8 | 27 | Card | | `Stuck? Ask the AI you already use.▌` |
| 9 | 28–35 | **Hero 3: Command AI** | `pip install flash-attn` fails as a red block. **Fix with AI** opens the sheet. First run: *Choose the AI that writes your commands*, with Codex · Claude Code · Ollama · OpenAI-compatible · Anthropic as options, and Claude Code (already signed in) is picked. The explanation streams in, and the suggested command arrives with its risk label. **Insert** puts it at the prompt, Enter, and `Successfully installed flash-attn`. Then plain English at the prompt: `clear the pip cache` fails as a command, and the one-line suggestion `pip cache purge` appears underneath. | `It suggests. You decide.` |
| 10 | 36–40 | **Pull back · end** | Slow dolly out to the whole workspace (terminal, Host, files), the loss still falling. Fade to the end card: logo, `Free and open source · macOS · Linux · Windows`, URL. It holds for 5 seconds. | end card |

## Rules this film obeys (from the research)

- **One idea per shot.** Readable text is at least 3% of frame height. A focus shot shows at most about 60 columns.
- **Two speeds of motion.** UI moves on near-critically-damped springs (0.35–0.7 s). The camera moves on long ease-outs (1.2–2 s). The camera always drifts.
- **Holds:** every result holds for at least twice the time its action took. Text stays for at least 1 s plus 0.3 s per word.
- **No arrows, dots or leader lines.** Focus comes from framing first, then depth (lift the subject, blur and dim the rest). At most one label at a time, aligned to the element it names and set in empty space.
- **Transitions:** camera-continuous moves, the device-to-screen push, and a shared element (the card cursor becomes the terminal caret). No dissolves between UI states.
- **True to the product.** The UI is rebuilt in vector at the app's own measured geometry. Steps are shortened, but nothing is shown that the app doesn't do.
- **Sound:** cuts and landings fall on bar lines. Silence under each lid close. The server's tick carries across the cut (an L-cut). The score lands on the reconnect.
