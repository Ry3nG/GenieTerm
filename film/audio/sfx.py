"""Synthesized sound design, placed sample-accurately from cues exported by the timeline.

Every keystroke the picture shows has a sound at the same frame, and the whooshes peak where
the camera moves fastest. Nothing here is a recording.
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

SR = 48000
FPS = 60
rng = np.random.default_rng(11)


def bandnoise(n, lo, hi, order=2):
    sos = butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return sosfilt(sos, rng.standard_normal(n))


def key_click(kind="key", pan=0.0):
    """Three layers: a bright tick, a resonant body, a low thock. About 40 ms."""
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    pitch = 1 + rng.uniform(-0.04, 0.04)
    tick = bandnoise(n, 3000 * pitch, 6500 * pitch) * np.exp(-t / 0.0025)
    body = bandnoise(n, 1300 * pitch, 2100 * pitch, order=3) * np.exp(-t / 0.018)
    f_thock = (140 if kind == "enter" else 220) * pitch
    thock = np.sin(2 * np.pi * f_thock * t) * np.exp(-t / (0.06 if kind == "enter" else 0.03))
    y = 0.55 * tick + 0.9 * body + (0.6 if kind == "enter" else 0.32) * thock
    y *= 10 ** (rng.uniform(-1.5, 1.5) / 20)
    if kind == "enter":
        y *= 1.3
    return y, pan


def whoosh(dur=0.5, up=True, peak=0.62):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n)
    block = 256
    lo, hi = (300, 3200) if up else (3200, 300)
    for i in range(0, n, block):
        p = i / n
        fc = lo * (hi / lo) ** p
        sos = butter(2, [fc * 0.6, min(fc * 1.6, SR * 0.45)], btype="band", fs=SR, output="sos")
        out[i : i + block] = sosfilt(sos, x[i : i + block])
    env = np.where(t / dur < peak, (t / dur / peak) ** 2, np.exp(-((t / dur - peak) / (1 - peak)) * 5))
    sub = np.sin(2 * np.pi * (80 * np.exp(-t / dur * 0.7)) * t) * env * 0.3
    return (out * env * 0.5 + sub)


def ui_click():
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return bandnoise(n, 2000, 7000) * np.exp(-t / 0.004) * 0.6 + np.sin(2 * np.pi * 1600 * t) * np.exp(-t / 0.01) * 0.2


def fm_note(freq, dur=1.6, index=2.0, ratio=2.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * freq * ratio * t) * index * np.exp(-t / 0.25)
    return np.sin(2 * np.pi * freq * t + mod) * np.minimum(1, t / 0.003) * np.exp(-t / 0.7)


def chime():
    # A then F#, a rising sixth over D major, the score's key
    y = np.zeros(int(2.0 * SR))
    a = fm_note(880.0)
    fs = fm_note(1479.98)
    y[: len(a)] += a * 0.5
    off = int(0.11 * SR)
    y[off : off + len(fs)] += fs[: len(y) - off] * 0.45
    return y


def lid_thump():
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 52 * t) * np.exp(-t / 0.12) * 0.8 + bandnoise(n, 100, 900) * np.exp(-t / 0.03) * 0.25


def place(buf, sig, at_frame, gain=1.0, pan=0.0):
    s0 = int(round(at_frame / FPS * SR))
    if s0 < 0 or s0 >= buf.shape[1]:
        return
    n = min(len(sig), buf.shape[1] - s0)
    lg = gain * np.sqrt(0.5 * (1 - pan))
    rg = gain * np.sqrt(0.5 * (1 + pan))
    buf[0, s0 : s0 + n] += sig[:n] * lg
    buf[1, s0 : s0 + n] += sig[:n] * rg


def render(cues, seconds):
    buf = np.zeros((2, int(seconds * SR)))
    for c in cues:
        kind = c["kind"]
        f = c["frame"]
        g = 10 ** (c.get("db", 0) / 20)
        if kind in ("key", "enter"):
            sig, _ = key_click(kind)
            place(buf, sig, f, 0.22 * g, c.get("pan", 0.0))
        elif kind == "whoosh":
            dur = c.get("dur", 0.5)
            sig = whoosh(dur, c.get("up", True))
            # the loudness peak should land on the camera's fastest frame
            place(buf, sig, f - dur * 0.62 * FPS, 0.12 * g, c.get("pan", 0.0))
        elif kind == "click":
            place(buf, ui_click(), f, 0.25 * g, c.get("pan", 0.0))
        elif kind == "chime":
            place(buf, chime(), f, 0.16 * g)
        elif kind == "thump":
            place(buf, lid_thump(), f, 0.3 * g)
    return buf


if __name__ == "__main__":
    cues_file, out = Path(sys.argv[1]), Path(sys.argv[2])
    data = json.loads(cues_file.read_text())
    y = render(data["cues"], data["seconds"])
    sf.write(out, y.T.astype(np.float32), SR, subtype="PCM_24")
    print(f"{len(data['cues'])} cues -> {out}")
