"""GenieTerm film score: an original, fully synthesized underscore.

90 BPM, 4/4, D major. One bar = 2.667 s = 160 frames at 60 fps, the same grid as
src/timeline.ts. Warm and quiet on purpose: rounded tones, nothing bright above 5 kHz.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from pedalboard import Compressor, HighpassFilter, HighShelfFilter, Limiter, LowpassFilter, Pedalboard
from scipy.signal import butter, fftconvolve, sosfilt, sosfilt_zi

SR = 48000
BPM = 90
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 32
TAIL = 2.5
DUR = BARS * BAR + TAIL
N = int(DUR * SR)
rng = np.random.default_rng(7)


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def t_at(bar, beat=0.0):
    return (bar - 1) * BAR + beat * BEAT


CH = {
    "D": [38, 45, 52, 57, 61, 64],
    "Bm": [35, 42, 49, 54, 57, 62],
    "G": [31, 38, 45, 50, 54, 57],
    "A": [33, 40, 47, 52, 54, 59],
    "Em": [28, 40, 47, 50, 55, 59],
    "F#m": [30, 42, 49, 54, 57, 61],
}

# Chapters (bars), the film's story: intro 1-2 · connect 3-6 · files 7-9 · durable 10-16
# host 17-20 · ports 21-24 · command ai 25-29 · outro 30-32
PROGRESSION = [
    (1, "D"), (2, "G"), (3, "D"), (4, "A"), (5, "Bm"), (6, "G"), (7, "D"), (8, "A"), (9, "G"),
    (10, "D"), (11, "Bm"), (12, "G"), (13, "A"), (14, "Bm"), (15, "G"), (16, "A"), (17, "D"),
    (18, "Bm"), (19, "G"), (20, "A"), (21, "D"), (22, "F#m"), (23, "G"), (24, "A"), (25, "D"),
    (26, "Bm"), (27, "Em"), (28, "F#m"), (29, "G"), (30, "A"), (31, "D"),
]

# Moments in the picture, in seconds (frames / 60), from src/edl.ts
LID_CLOSED = t_at(10) + 572 / 60
LID_OPEN = t_at(10) + 790 / 60
BURST = t_at(10) + 1000 / 60
FAILED = t_at(25) + 330 / 60
FIXED = t_at(25) + 702 / 60
CARD = t_at(30) + 220 / 60
CHAPTERS = [3, 7, 10, 17, 21, 25]


def chord_at(t):
    cur = PROGRESSION[0][1]
    for b, c in PROGRESSION:
        if t >= t_at(b):
            cur = c
    return cur


def env_curve(points, n=N):
    t = np.arange(n) / SR
    pts = sorted(points)
    return np.interp(t, [p[0] for p in pts], [p[1] for p in pts])


def db(x):
    return 10 ** (x / 20)


def sweep_lowpass(x, cutoff, block=256, order=2):
    y = np.zeros_like(x)
    zi = None
    for i in range(0, len(x), block):
        fc = float(np.clip(cutoff[min(i, len(cutoff) - 1)], 40, SR * 0.45))
        sos = butter(order, fc, fs=SR, output="sos")
        if zi is None:
            zi = sosfilt_zi(sos) * 0.0
        seg, zi = sosfilt(sos, x[i : i + block], zi=zi)
        y[i : i + block] = seg
    return y


def warm_tone(freq, n, phase=0.0, rate=0.0):
    """A rounded, string-like tone: a few harmonics falling off steeply, gently chorused."""
    t = np.arange(n) / SR
    drift = 1 + 0.0018 * np.sin(2 * np.pi * (0.13 + rate) * t + phase * 6)
    ph = 2 * np.pi * freq * np.cumsum(drift) / SR
    return sum(a * np.sin(k * ph + phase * k) for k, a in [(1, 1.0), (2, 0.32), (3, 0.12), (4, 0.05)])


def pad_layer(cutoff):
    L = np.zeros(N)
    R = np.zeros(N)
    xfade = 1.6
    a = int(xfade * SR)
    for i, (b, c) in enumerate(PROGRESSION):
        start = t_at(b)
        end = t_at(PROGRESSION[i + 1][0]) if i + 1 < len(PROGRESSION) else DUR
        s0 = max(0, int((start - xfade / 2) * SR))
        s1 = min(N, int((end + xfade / 2) * SR))
        n = s1 - s0
        env = np.ones(n)
        env[: min(a, n)] = np.sin(np.linspace(0, np.pi / 2, min(a, n))) ** 2
        if end < DUR:
            env[-a:] = np.cos(np.linspace(0, np.pi / 2, a)) ** 2
        for j, m in enumerate(CH[c][1:]):
            for v, pan in [(-1, -0.45), (1, 0.45)]:
                w = warm_tone(midi_hz(m) * 2 ** (v * 4 / 1200), n, rng.random() * 6, 0.02 * j) * env
                L[s0:s1] += w * (0.5 - pan * 0.5)
                R[s0:s1] += w * (0.5 + pan * 0.5)
    return np.stack([sweep_lowpass(L, cutoff), sweep_lowpass(R, cutoff)]) / 9.0


def soft_bell(freq, dur=4.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * freq * 2.0 * t) * 1.1 * np.exp(-t / 0.3)
    y = np.sin(2 * np.pi * freq * t + mod) + 0.2 * np.sin(2 * np.pi * freq * 3.0 * t) * np.exp(-t / 0.4)
    return y * np.minimum(1, t / 0.008) * np.exp(-t / 1.9)


def felt(freq, dur=1.4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t / tau) for r, a, tau in [(1, 1.0, 0.7), (2.0, 0.25, 0.3), (3.0, 0.07, 0.15)])
    return y * np.minimum(1, t / 0.012)


def add(buf, sig, at, gain=1.0, pan=0.0):
    s0 = int(at * SR)
    if s0 < 0 or s0 >= N:
        return
    n = min(len(sig), N - s0)
    buf[0, s0 : s0 + n] += sig[:n] * gain * np.sqrt(0.5 * (1 - pan))
    buf[1, s0 : s0 + n] += sig[:n] * gain * np.sqrt(0.5 * (1 + pan))


def make_ir(seconds=4.2, seed=3):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for ch in range(2):
        for lo, hi, t60 in [(80, 400, 3.8), (400, 1500, 2.8), (1500, 4500, 1.6), (4500, 9000, 0.8)]:
            band = sosfilt(butter(2, [lo, hi], btype="band", fs=SR, output="sos"), r.standard_normal(n))
            out[ch] += band * np.exp(-6.91 * t / t60)
    out = np.concatenate([np.zeros((2, int(0.035 * SR))), out], axis=1)
    return out / np.max(np.abs(out))


def reverb(x, ir, wet):
    y = np.stack([fftconvolve(x[0], ir[0])[: x.shape[1]], fftconvolve(x[1], ir[1])[: x.shape[1]]])
    return y * (np.max(np.abs(x)) / (np.max(np.abs(y)) + 1e-9)) * wet


def build():
    # brightness never passes 1.6 kHz, and closes down while the lid is shut
    cutoff_pts = [(0, 500), (t_at(3), 900), (t_at(10), 1100), (LID_CLOSED - 1, 1000), (LID_CLOSED + 0.6, 320),
                  (LID_OPEN, 360), (BURST - 0.8, 900), (BURST + 0.3, 1500), (t_at(25), 1200), (FAILED, 800),
                  (FIXED - 0.2, 850), (FIXED + 0.6, 1500), (CARD, 1600), (DUR, 700)]
    gain_pts = [(0, 0.0), (2.0, 0.5), (t_at(3), 0.65), (LID_CLOSED - 1, 0.7), (LID_CLOSED + 0.6, 0.12),
                (LID_OPEN, 0.16), (BURST - 1.0, 0.45), (BURST + 0.2, 0.85), (FAILED, 0.6), (FIXED, 0.7),
                (FIXED + 0.5, 0.9), (CARD, 1.0), (DUR - 0.6, 0.85), (DUR, 0.0)]
    # each chapter's title breath gets a gentle lift
    for b in CHAPTERS:
        gain_pts += [(t_at(b) - 0.3, 0.6), (t_at(b) + 1.2, 0.82), (t_at(b) + 3.0, 0.68)]
    pad = pad_layer(env_curve(cutoff_pts)) * env_curve(gain_pts)

    bells = np.zeros((2, N))
    motif = [(1, 1, 78), (2, 0, 76), (2, 2, 74)]
    for b in CHAPTERS:
        motif += [(b, 0, 81), (b, 1.5, 78)]
    motif += [(16, 1, 81), (16, 2, 85), (16, 3, 83)]  # the session comes back
    motif += [(29, 2.6, 83), (29, 3.4, 81), (30, 0, 78)]  # the fix lands
    motif += [(31, 1.3, 74), (31, 1.33, 81), (31, 1.36, 86)]  # the name
    for bar, beat, mnote in motif:
        add(bells, soft_bell(midi_hz(mnote)), t_at(bar, beat), 0.11, pan=rng.uniform(-0.3, 0.3))

    dry = np.zeros((2, N))
    for b0, b1 in [(4, 7), (10, 13.4), (17, 25), (25, 27)]:
        bar = b0
        while bar < b1:
            for k in range(4):
                t0 = t_at(int(bar), k)
                if t0 >= t_at(b1):
                    break
                m = CH[chord_at(t0)][1] + (12 if k == 2 else 0)
                add(dry, felt(midi_hz(m)), t0, 0.07 if k % 2 == 0 else 0.045, pan=-0.12 if k % 2 else 0.12)
            bar += 1

    sub = np.zeros(N)
    for i, (b, c) in enumerate(PROGRESSION):
        start = t_at(b)
        end = t_at(PROGRESSION[i + 1][0]) if i + 1 < len(PROGRESSION) else DUR - 1
        if LID_CLOSED - 0.5 < start < LID_OPEN:
            continue
        n = int((end - start) * SR)
        tt = np.arange(n) / SR
        s = np.sin(2 * np.pi * midi_hz(CH[c][0]) * tt) * np.minimum(1, tt / 0.5) * np.minimum(1, (n / SR - tt) / 0.8)
        sub[int(start * SR) : int(start * SR) + n] += s * 0.045
    dry += np.stack([sub, sub])

    # a soft bloom into the reconnect
    n = int(1.6 * SR)
    add(dry, sweep_lowpass(rng.standard_normal(n), np.geomspace(200, 2400, n)) * np.linspace(0, 1, n) ** 3 * 0.025, BURST - 1.6)
    tt = np.arange(int(2.0 * SR)) / SR
    add(dry, np.sin(2 * np.pi * (48 * np.exp(-tt / 0.6) + 36) * tt) * np.exp(-tt / 0.8) * 0.1, BURST)

    ir = make_ir()
    mix = pad + dry + bells + reverb(pad, ir, 0.4) + reverb(bells, ir, 0.6) + reverb(dry, ir, 0.25)
    return mix * env_curve([(0, 0), (1.5, 1), (DUR - 0.5, 1), (DUR, 0)])


def master(mix, target_lufs=-18.0):
    board = Pedalboard([
        HighpassFilter(cutoff_frequency_hz=30),
        HighShelfFilter(cutoff_frequency_hz=5000, gain_db=-5.0, q=0.6),
        LowpassFilter(cutoff_frequency_hz=11000),
        Compressor(threshold_db=-28, ratio=1.5, attack_ms=50, release_ms=350),
        Limiter(threshold_db=-2.0, release_ms=150),
    ])
    y = board(mix.astype(np.float32), SR)
    meter = pyln.Meter(SR)
    y = y * db(target_lufs - meter.integrated_loudness(y.T))
    peak = np.max(np.abs(y))
    if peak > db(-1.5):
        y *= db(-1.5) / peak
    return y, meter.integrated_loudness(y.T)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "score.wav")
    y, lufs = master(build())
    sf.write(out, y.T, SR, subtype="PCM_24")
    meta = {"bpm": BPM, "bars": BARS, "seconds": DUR, "lufs": round(lufs, 2)}
    out.with_suffix(".json").write_text(json.dumps(meta))
    print(json.dumps(meta))
