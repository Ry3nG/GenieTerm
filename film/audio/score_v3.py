"""GenieTerm film score, v3: an original, fully synthesized underscore.

90 BPM, 4/4, D major. One bar = 2.667 s = 160 frames at 60 fps, the grid of src/v3/timeline.ts.
Warm and quiet on purpose. The music goes almost silent each time a lid closes and comes back
when the session does.
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
BARS = 42
TAIL = 3.0
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

# One chord per bar, following src/v3/timeline.ts (score bar = scene bar + 1):
# cold 1-4 · title 5-6 · connect 7-12 · card 13 · durable 14-20 · card 21 · host 22-27
# card 28 · command ai 29-37 · outro 38-42
PROGRESSION = [
    (1, "Bm"), (2, "G"), (3, "Bm"), (4, "F#m"),
    (5, "D"), (6, "A"),
    (7, "D"), (8, "Bm"), (9, "G"), (10, "A"), (11, "D"), (12, "A"),
    (13, "G"),
    (14, "D"), (15, "Bm"), (16, "G"), (17, "Em"), (18, "Bm"), (19, "A"), (20, "D"),
    (21, "G"),
    (22, "D"), (23, "F#m"), (24, "G"), (25, "A"), (26, "Bm"), (27, "A"),
    (28, "G"),
    (29, "D"), (30, "Bm"), (31, "Em"), (32, "F#m"), (33, "G"), (34, "A"), (35, "D"), (36, "Bm"), (37, "A"),
    (38, "G"), (39, "A"), (40, "D"),
]

F = 1 / 60
# Moments in the picture (seconds), from the scene constants in src/v3/
COLD_SHUT = (150 + 47) * F
COLD_OPEN = 300 * F
COLD_ERROR = 520 * F
TITLE_NAME = (640 + 46) * F
DUR0 = 13 * 160 * F
LID_CLOSED = DUR0 + 387 * F
LID_OPEN = DUR0 + 690 * F
RECONNECTED = DUR0 + 760 * F
AI0 = 28 * 160 * F
FAILED = AI0 + 236 * F
FIXED = AI0 + 1112 * F
CARD = 37 * 160 * F + 360 * F
CARDS = [13, 21, 28]


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
    # brightness stays under 1.6 kHz, and closes right down while a lid is shut
    cutoff_pts = [(0, 380), (COLD_SHUT - 0.5, 600), (COLD_SHUT + 0.4, 260), (COLD_ERROR, 300), (TITLE_NAME - 0.5, 320),
                  (TITLE_NAME + 1.5, 900), (t_at(7), 1000), (t_at(13), 1150), (LID_CLOSED - 0.8, 1100), (LID_CLOSED + 0.5, 300),
                  (LID_OPEN, 340), (RECONNECTED - 0.6, 900), (RECONNECTED + 0.4, 1500), (t_at(22), 1300), (t_at(29), 1200),
                  (FAILED, 1150), (FAILED + 0.6, 650), (FIXED - 0.3, 800), (FIXED + 0.6, 1500), (CARD, 1600), (DUR, 700)]
    gain_pts = [(0, 0.0), (1.5, 0.35), (COLD_SHUT - 0.4, 0.42), (COLD_SHUT + 0.5, 0.06), (COLD_OPEN, 0.08),
                (COLD_ERROR, 0.14), (TITLE_NAME - 0.4, 0.12), (TITLE_NAME + 1.2, 0.62), (t_at(7), 0.66),
                (LID_CLOSED - 0.8, 0.72), (LID_CLOSED + 0.6, 0.08), (LID_OPEN, 0.1), (RECONNECTED - 0.8, 0.4),
                (RECONNECTED + 0.3, 0.88), (t_at(22), 0.7), (FAILED, 0.66), (FAILED + 0.8, 0.5), (FIXED, 0.62),
                (FIXED + 0.5, 0.86), (CARD, 1.0), (DUR - 0.6, 0.85), (DUR, 0.0)]
    # each chapter card breathes in
    for b in CARDS:
        gain_pts += [(t_at(b) - 0.3, 0.58), (t_at(b) + 1.0, 0.8), (t_at(b + 1), 0.68)]
    pad = pad_layer(env_curve(cutoff_pts)) * env_curve(gain_pts)

    bells = np.zeros((2, N))
    motif = [(1, 1, 71), (2, 2, 69), (4, 3, 66)]  # the cold open: sparse and unresolved
    motif += [(5, 0.5, 78), (5, 1.5, 81), (5, 2.5, 85)]  # the name
    for b in CARDS:
        motif += [(b, 0, 81), (b, 1.5, 78)]
    motif += [(19, 2.6, 81), (19, 3.2, 85), (20, 0, 83)]  # the session comes back
    motif += [(35, 2.2, 83), (35, 3.0, 81), (36, 0, 78)]  # the fix lands
    motif += [(40, 0.5, 74), (40, 0.53, 81), (40, 0.56, 86)]  # the end card
    for bar, beat, mnote in motif:
        add(bells, soft_bell(midi_hz(mnote)), t_at(bar, beat), 0.11, pan=rng.uniform(-0.3, 0.3))
    # the reconnect lands exactly, not on the grid
    add(bells, soft_bell(midi_hz(85)), RECONNECTED, 0.09, pan=0.2)

    dry = np.zeros((2, N))
    # a felt pulse under the working chapters, never under the cards or the night
    for b0, b1 in [(7, 13), (14, 16.4), (20, 21), (22, 28), (29, 30.4), (31.5, 37), (38, 39.5)]:
        bar = b0
        while bar < b1:
            for k in range(4):
                t0 = t_at(int(bar), k)
                if t0 >= t_at(b1) or t0 < t_at(b0):
                    continue
                m = CH[chord_at(t0)][1] + (12 if k == 2 else 0)
                add(dry, felt(midi_hz(m)), t0, 0.07 if k % 2 == 0 else 0.045, pan=-0.12 if k % 2 else 0.12)
            bar += 1

    sub = np.zeros(N)
    for i, (b, c) in enumerate(PROGRESSION):
        start = t_at(b)
        end = t_at(PROGRESSION[i + 1][0]) if i + 1 < len(PROGRESSION) else DUR - 1
        if LID_CLOSED - 0.5 < start < LID_OPEN or start < TITLE_NAME - 1:
            continue
        n = int((end - start) * SR)
        tt = np.arange(n) / SR
        s = np.sin(2 * np.pi * midi_hz(CH[c][0]) * tt) * np.minimum(1, tt / 0.5) * np.minimum(1, (n / SR - tt) / 0.8)
        sub[int(start * SR) : int(start * SR) + n] += s * 0.045
    dry += np.stack([sub, sub])

    # a low, held note under "Broken pipe"
    tt = np.arange(int(5.0 * SR)) / SR
    add(dry, warm_tone(midi_hz(30), len(tt)) * np.minimum(1, tt / 1.2) * np.exp(-tt / 3.0) * 0.05, COLD_ERROR - 0.6)

    # soft blooms into the name and into the reconnect
    for at in [TITLE_NAME, RECONNECTED]:
        n = int(1.6 * SR)
        add(dry, sweep_lowpass(rng.standard_normal(n), np.geomspace(200, 2400, n)) * np.linspace(0, 1, n) ** 3 * 0.022, at - 1.6)
        tt = np.arange(int(2.0 * SR)) / SR
        add(dry, np.sin(2 * np.pi * (48 * np.exp(-tt / 0.6) + 36) * tt) * np.exp(-tt / 0.8) * 0.09, at)

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
