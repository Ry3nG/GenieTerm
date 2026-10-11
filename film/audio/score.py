"""GenieTerm film score: an original, fully synthesized underscore.

100 BPM, 4/4, D major. One bar = 2.4 s = 144 frames at 60 fps, so every cut in the
film can land on a bar line. The section plan mirrors the storyboard in
src/timeline.ts; edit both together.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from pedalboard import Compressor, Limiter, Pedalboard, HighpassFilter
from scipy.signal import butter, fftconvolve, sosfilt, sosfilt_zi

SR = 48000
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 24
TAIL = 3.5
DUR = BARS * BAR + TAIL
N = int(DUR * SR)
rng = np.random.default_rng(7)


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def t_at(bar, beat=0.0):
    return (bar - 1) * BAR + beat * BEAT


# Chords as MIDI notes, open voicings, no thirds in the bass.
CH = {
    "D": [38, 45, 52, 57, 61, 64, 69],  # Dmaj9 colour: D A E A C# E A
    "Bm": [35, 42, 49, 54, 57, 61, 66],  # Bm11: B F# C# F# A C# F#
    "G": [31, 38, 45, 50, 54, 57, 61],  # Gmaj7#11: G D A D F# A C#
    "A": [33, 40, 47, 52, 54, 59, 64],  # A6sus: A E B E F# B E
    "Em": [28, 40, 47, 50, 54, 59, 62],  # Em9
}

# (bar, chord) changes. Section map, shared with src/edl.ts:
#  1-3 cold open · 4-5 training · 6-7 lid closes · 8 reconnect lands · 9-12 host
#  13-15 ports · 16-17 files · 18-19 the install fails · 20-21 fixed · 22 exit
#  23-27 logo and tail
PROGRESSION = [
    (1, "D"), (3, "Bm"), (4, "G"), (5, "A"), (6, "Bm"), (8, "D"), (10, "Bm"),
    (11, "G"), (13, "A"), (14, "D"), (16, "G"), (18, "Em"), (19, "Bm"), (20, "G"),
    (21, "A"), (22, "G"), (23, "D"),
]


def chord_at(bar):
    cur = PROGRESSION[0][1]
    for b, c in PROGRESSION:
        if bar >= b:
            cur = c
    return cur


def env_curve(points, n=N):
    """Piecewise-linear automation from (seconds, value) points."""
    t = np.arange(n) / SR
    xs = np.array([p[0] for p in points])
    ys = np.array([p[1] for p in points])
    return np.interp(t, xs, ys)


def db(x):
    return 10 ** (x / 20)


# ---------- oscillators ----------

def polyblep(t, dt):
    out = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt
    out[m] = x + x - x * x - 1.0
    m2 = t > 1.0 - dt
    x = (t[m2] - 1.0) / dt
    out[m2] = x * x + x + x + 1.0
    return out


def saw(freq, n, phase=0.0):
    dt = freq / SR
    t = (phase + dt * np.arange(n)) % 1.0
    return (2.0 * t - 1.0) - polyblep(t, dt)


def sweep_lowpass(x, cutoff, block=256, order=4):
    """Lowpass with a time-varying cutoff, processed in short blocks with carried state."""
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


# ---------- instruments ----------

def pad_layer(notes_by_bar, cutoff, gain):
    """Detuned saw pad. Each chord region crossfades into the next."""
    L = np.zeros(N)
    R = np.zeros(N)
    regions = []
    for i, (b, c) in enumerate(PROGRESSION):
        start = t_at(b)
        end = t_at(PROGRESSION[i + 1][0]) if i + 1 < len(PROGRESSION) else DUR
        regions.append((start, end, CH[c]))
    xfade = 1.2
    for start, end, notes in regions:
        s0 = max(0, int((start - xfade / 2) * SR))
        s1 = min(N, int((end + xfade / 2) * SR))
        n = s1 - s0
        if n <= 0:
            continue
        env = np.ones(n)
        a = int(xfade * SR)
        env[:a] = np.linspace(0, 1, min(a, n)) ** 1.5 if n >= a else np.linspace(0, 1, n)
        if end < DUR:
            env[-a:] = np.linspace(1, 0, a) ** 1.5
        for m in notes[1:]:
            f = midi_hz(m)
            for v in range(3):
                det = (v - 1) * 5.5  # cents
                ph = rng.random()
                w = saw(f * 2 ** (det / 1200), n, ph) * env
                pan = (v / 2.0 - 0.5) * 0.9
                L[s0:s1] += w * (0.5 - pan * 0.5)
                R[s0:s1] += w * (0.5 + pan * 0.5)
    L = sweep_lowpass(L, cutoff)
    R = sweep_lowpass(R, cutoff)
    return np.stack([L, R]) * gain / 11.0


def fm_bell(freq, dur, ratio=3.5, index=2.2, decay=2.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    idx = index * np.exp(-t / 0.35)
    mod = np.sin(2 * np.pi * freq * ratio * t) * idx
    car = np.sin(2 * np.pi * freq * t + mod)
    # a soft second partial for warmth
    car += 0.25 * np.sin(2 * np.pi * freq * 2.001 * t) * np.exp(-t / 0.6)
    att = np.minimum(1, t / 0.004)
    return car * att * np.exp(-t / decay)


def felt_pluck(freq, dur=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    partials = [(1, 1.0, 0.55), (2.0, 0.35, 0.25), (3.01, 0.12, 0.12), (4.2, 0.05, 0.07)]
    y = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t / tau) for r, a, tau in partials)
    att = np.minimum(1, t / 0.006)
    return y * att


def add(buf, sig, at, gain=1.0, pan=0.0):
    s0 = int(at * SR)
    if s0 >= N:
        return
    n = min(len(sig), N - s0)
    buf[0, s0 : s0 + n] += sig[:n] * gain * (1 - pan) * 0.5 * 2 ** 0.5
    buf[1, s0 : s0 + n] += sig[:n] * gain * (1 + pan) * 0.5 * 2 ** 0.5


def make_ir(seconds=4.6, seed=3):
    """Stereo-decorrelated procedural IR: band-limited noise with longer decay in the lows."""
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    bands = [(80, 400, 4.2), (400, 1500, 3.2), (1500, 5000, 2.2), (5000, 12000, 1.3)]
    for ch in range(2):
        for lo, hi, t60 in bands:
            noise = r.standard_normal(n)
            sos = butter(2, [lo, hi], btype="band", fs=SR, output="sos")
            band = sosfilt(sos, noise)
            out[ch] += band * np.exp(-6.91 * t / t60)
    predelay = int(0.032 * SR)
    out = np.concatenate([np.zeros((2, predelay)), out], axis=1)
    return out / np.max(np.abs(out))


def reverb(x, ir, wet):
    y = np.stack([fftconvolve(x[0], ir[0])[: x.shape[1]], fftconvolve(x[1], ir[1])[: x.shape[1]]])
    y *= np.max(np.abs(x)) / (np.max(np.abs(y)) + 1e-9)
    return y * wet


# ---------- arrangement ----------

def build():
    # Pad brightness tells the story: dark open, closing almost shut while the lid is down,
    # opening wide for the reconnect, dipping for the failure, widest at the logo.
    cutoff = env_curve([
        (0, 380), (t_at(3), 700), (t_at(4), 1100), (t_at(6), 1300),
        (t_at(6, 3), 900), (t_at(7), 260), (t_at(7, 3.5), 240), (t_at(8), 1700),
        (t_at(9), 1500), (t_at(16), 1400), (t_at(18), 900), (t_at(19, 3), 800),
        (t_at(20), 1800), (t_at(22), 1200), (t_at(23), 2400), (t_at(25), 2000), (DUR, 600),
    ])
    pad_gain = env_curve([
        (0, 0.0), (1.5, 0.32), (t_at(4), 0.5), (t_at(6), 0.6), (t_at(6, 3), 0.3),
        (t_at(7), 0.07), (t_at(7, 3.6), 0.06), (t_at(8), 0.9), (t_at(18), 0.75),
        (t_at(19, 3), 0.6), (t_at(20), 0.85), (t_at(22), 0.55), (t_at(23), 1.0), (t_at(26), 0.8), (DUR, 0.0),
    ])
    pad = pad_layer(None, cutoff, 1.0) * pad_gain

    dry = np.zeros((2, N))
    bells = np.zeros((2, N))

    # bell motif (scale degrees in D: F#5 A5 E5 D5...), sparse, only where the picture breathes
    motif = [
        (1, 0, 81), (2, 2, 78), (3, 0, 76),  # cold open: three notes, far apart
        (8, 0, 81), (8, 1.5, 85), (8, 3, 83), (9, 0, 78),  # reconnect: the hero phrase
        (12, 0, 81), (13, 2, 79), (14, 0, 78), (15, 2, 76),
        (21, 2, 83), (21, 3, 81), (22, 0, 78),  # the fix lands
        (23, 0, 74), (23, 0.02, 81), (23, 0.04, 86),  # logo chord, rolled
    ]
    for bar, beat, m in motif:
        g = 0.15 if bar != 23 else 0.2
        add(bells, fm_bell(midi_hz(m), 4.5), t_at(bar, beat), g, pan=rng.uniform(-0.35, 0.35))

    # soft 8th-note pulse in the bass register, only while things are moving
    pulse_bars = list(range(4, 7)) + list(range(9, 18)) + list(range(20, 22))  # silent for exit
    for bar in pulse_bars:
        notes = CH[chord_at(bar)]
        for k in range(8):
            if bar == 6 and k >= 4:
                break  # the pulse stops as the lid closes
            m = notes[1] + (12 if k % 4 == 2 else 0)
            accent = 1.0 if k % 2 == 0 else 0.6
            add(dry, felt_pluck(midi_hz(m), 0.7), t_at(bar, k * 0.5), 0.10 * accent, pan=0.15 if k % 2 else -0.15)

    # sub on chord roots
    sub = np.zeros(N)
    for i, (b, c) in enumerate(PROGRESSION):
        if b < 4 or 6 <= b < 8:
            continue
        start = t_at(b)
        end = t_at(PROGRESSION[i + 1][0]) if i + 1 < len(PROGRESSION) else t_at(26)
        n = int((end - start) * SR)
        tt = np.arange(n) / SR
        f = midi_hz(CH[c][0])
        s = np.sin(2 * np.pi * f * tt) * np.minimum(1, tt / 0.4) * np.minimum(1, (n / SR - tt) / 0.6)
        sub[int(start * SR) : int(start * SR) + n] += s * 0.06
    dry += np.stack([sub, sub])

    # reconnect riser into bar 8 and a low impact on its downbeat
    rs, re_ = t_at(7, 2), t_at(8)
    n = int((re_ - rs) * SR)
    noise = rng.standard_normal(n)
    rise = sweep_lowpass(noise, np.geomspace(300, 6000, n)) * np.linspace(0, 1, n) ** 3 * 0.06
    add(dry, rise, rs, 1.0)
    tt = np.arange(int(2.5 * SR)) / SR
    boom = np.sin(2 * np.pi * (55 * np.exp(-tt / 0.5) + 36) * tt) * np.exp(-tt / 0.9) * 0.2
    add(dry, boom, t_at(8), 1.0)

    # air: very quiet high shimmer for the lift sections
    air_gain = env_curve([(0, 0), (t_at(8), 0), (t_at(8, 1), 0.007), (t_at(16), 0.004),
                          (t_at(20), 0.007), (t_at(22), 0.004), (t_at(23), 0.01), (t_at(26), 0.0), (DUR, 0)])
    air = np.stack([rng.standard_normal(N), rng.standard_normal(N)])
    sos = butter(2, [6000, 11000], btype="band", fs=SR, output="sos")
    air = np.stack([sosfilt(sos, air[0]), sosfilt(sos, air[1])]) * air_gain

    ir = make_ir()
    mix = pad + dry + air + bells
    mix += reverb(pad, ir, 0.35) + reverb(bells, ir, 0.55) + reverb(dry, ir, 0.22)
    fade = env_curve([(0, 0), (1.6, 1), (DUR - 0.5, 1), (DUR, 0)])
    return mix * fade


def master(mix, target_lufs=-17.0):
    board = Pedalboard([
        HighpassFilter(cutoff_frequency_hz=28),
        Compressor(threshold_db=-26, ratio=1.6, attack_ms=40, release_ms=300),
        Limiter(threshold_db=-1.5, release_ms=120),
    ])
    y = board(mix.astype(np.float32), SR)
    meter = pyln.Meter(SR)
    loud = meter.integrated_loudness(y.T)
    y = y * db(target_lufs - loud)
    peak = np.max(np.abs(y))
    if peak > db(-1.0):
        y *= db(-1.0) / peak
    return y, meter.integrated_loudness(y.T)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "score.wav")
    mix = build()
    y, lufs = master(mix)
    sf.write(out, y.T, SR, subtype="PCM_24")
    meta = {"bpm": BPM, "bars": BARS, "seconds": DUR, "lufs": round(lufs, 2)}
    out.with_suffix(".json").write_text(json.dumps(meta))
    print(json.dumps(meta))
