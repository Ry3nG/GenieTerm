"""Score for one short of the series, from audio/shorts/<id>.json.

Same instruments and room as the main film (score_v3.py), same 90 BPM grid. A short is a
single phrase: it opens on a held chord under the hook card, settles into a soft pulse while
the feature works, goes quiet if the moment calls for it, and resolves under the end card.
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

import score_v3 as S

FPS = 60


def build(spec):
    m = spec["music"]
    sec = lambda frames: frames / FPS
    bars = int(np.ceil(spec["frames"] / 160)) + 1
    S.BARS = bars
    S.DUR = bars * S.BAR + S.TAIL
    S.N = int(S.DUR * S.SR)
    N, DUR, t_at = S.N, S.DUR, S.t_at

    end = sec(m["end"])
    # the bar position (fractional) where the end card lands: the home chord arrives exactly there
    end_b = end / S.BAR + 1
    work = ["D", "Bm", "G", "A", "D", "F#m", "G", "A", "Bm", "G", "A", "D", "Bm", "G", "A"]
    # a cold open (an ordinary terminal failing) gets its own sparse, unresolved bars first
    cold_b = m.get("cold", 0) / 160
    prog = [(1 + i, c) for i, c in enumerate(["Bm", "G", "Bm", "F#m"][: int(np.ceil(cold_b))])]
    hook_b = 1 + cold_b
    prog += [(hook_b, "G"), (hook_b + 1, "A")]
    b = hook_b + 2
    while b < end_b - 2:
        prog.append((b, work[int(b - hook_b - 2) % len(work)]))
        b += 1
    prog += [(end_b - 2, "G"), (end_b - 1, "A"), (end_b, "D")]
    S.PROGRESSION = prog

    quiet = [(sec(a), sec(b)) for a, b in m["quiet"]]
    cutoff = [(0, 420), (1.8, 700), (t_at(hook_b + 2), 1000)]
    gain = [(0, 0.0), (1.2, 0.42), (t_at(hook_b + 1), 0.5), (t_at(hook_b + 2), 0.64)]
    for a, b in quiet:
        cutoff += [(a - 0.6, 1050), (a + 0.4, 280), (b - 0.8, 340), (b + 0.4, 1400)]
        gain += [(a - 0.6, 0.68), (a + 0.5, 0.07), (b - 0.8, 0.12), (b + 0.3, 0.86)]
    for t in [sec(x) for x in m["dark"]]:
        cutoff += [(t - 0.2, 1100), (t + 0.6, 620)]
        gain += [(t - 0.2, 0.64), (t + 0.8, 0.5)]
    for t in [sec(x) for x in m["bright"]]:
        cutoff += [(t - 0.3, 800), (t + 0.6, 1500)]
        gain += [(t - 0.3, 0.58), (t + 0.5, 0.86)]
    cutoff += [(end, 1600), (DUR, 700)]
    gain += [(end - 0.4, 0.8), (end + 0.6, 1.0), (DUR - 0.6, 0.85), (DUR, 0.0)]
    pad = S.pad_layer(S.env_curve(cutoff, N)) * S.env_curve(gain, N)

    bells = np.zeros((2, N))
    motif = [(hook_b, 0.5, 78), (hook_b, 1.5, 81), (hook_b + 1, 0.5, 76)]
    if cold_b:
        motif += [(1, 1, 71), (2, 2, 69)]
    motif += [(end_b, 0.25, 74), (end_b, 0.28, 81), (end_b, 0.31, 86)]
    for bar, beat, note in motif:
        S.add(bells, S.soft_bell(S.midi_hz(note)), t_at(bar, beat), 0.11, pan=S.rng.uniform(-0.3, 0.3))
    for t in [sec(x) for x in m["blooms"]] + [sec(x) for x in m["bright"]]:
        S.add(bells, S.soft_bell(S.midi_hz(85)), t, 0.09, pan=0.2)

    dry = np.zeros((2, N))
    starts_after = t_at(hook_b + 2)
    work_quiet = [(a, b) for a, b in quiet if a >= starts_after]
    pulse_end = min([a for a, _ in work_quiet] + [end])
    spans = [(starts_after, pulse_end)]
    for a, b in work_quiet:
        spans.append((b + S.BAR * 0.5, end))
    for t0s, t1s in spans:
        beat_t = np.ceil(t0s / S.BEAT) * S.BEAT
        k = 0
        while beat_t < t1s:
            m_ = S.CH[S.chord_at(beat_t)][1] + (12 if k % 4 == 2 else 0)
            S.add(dry, S.felt(S.midi_hz(m_)), beat_t, 0.07 if k % 2 == 0 else 0.045, pan=-0.12 if k % 2 else 0.12)
            beat_t += S.BEAT
            k += 1

    sub = np.zeros(N)
    for i, (b, c) in enumerate(S.PROGRESSION):
        start = t_at(b)
        stop = t_at(S.PROGRESSION[i + 1][0]) if i + 1 < len(S.PROGRESSION) else DUR - 1
        if b < hook_b + 2 or any(a - 0.5 < start < q for a, q in quiet):
            continue
        n = int((stop - start) * S.SR)
        tt = np.arange(n) / S.SR
        s = np.sin(2 * np.pi * S.midi_hz(S.CH[c][0]) * tt) * np.minimum(1, tt / 0.5) * np.minimum(1, (n / S.SR - tt) / 0.8)
        sub[int(start * S.SR) : int(start * S.SR) + n] += s * 0.045
    dry += np.stack([sub, sub])

    for t in [sec(x) for x in m["blooms"]]:
        n = int(1.6 * S.SR)
        S.add(dry, S.sweep_lowpass(S.rng.standard_normal(n), np.geomspace(200, 2400, n)) * np.linspace(0, 1, n) ** 3 * 0.022, t - 1.6)

    ir = S.make_ir()
    mix = pad + dry + bells + S.reverb(pad, ir, 0.4) + S.reverb(bells, ir, 0.6) + S.reverb(dry, ir, 0.25)
    return mix * S.env_curve([(0, 0), (1.0, 1), (DUR - 0.5, 1), (DUR, 0)], N)


if __name__ == "__main__":
    spec = json.loads(Path(sys.argv[1]).read_text())
    y, lufs = S.master(build(spec))
    sf.write(sys.argv[2], y.T, S.SR, subtype="PCM_24")
    print(f"{spec['id']}: {y.shape[1] / S.SR:.1f}s at {lufs:.1f} LUFS")
