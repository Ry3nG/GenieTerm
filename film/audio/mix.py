"""Mixes the score and the sound effects into the film's single audio track."""

import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

score, sr = sf.read(sys.argv[1])
sfx, sr2 = sf.read(sys.argv[2])
assert sr == sr2
n = max(len(score), len(sfx))
mix = np.zeros((n, 2))
mix[: len(score)] += score
mix[: len(sfx)] += sfx
meter = pyln.Meter(sr)
loud = meter.integrated_loudness(mix)
mix *= 10 ** ((-16.0 - loud) / 20)
peak = np.max(np.abs(mix))
if peak > 10 ** (-1.0 / 20):
    mix *= 10 ** (-1.0 / 20) / peak
sf.write(sys.argv[3], mix, sr, subtype="PCM_24")
print(f"mixed {n / sr:.1f}s at {meter.integrated_loudness(mix):.1f} LUFS, peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS")
