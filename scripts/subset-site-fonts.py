# Copyright 2026, GenieTerm. Apache-2.0.
from pathlib import Path
from fontTools import subset

ROOT = Path(__file__).resolve().parents[1]
RANGES = "U+0000-00FF,U+2000-206F,U+2190-21FF,U+2300-23FF,U+2500-25FF"
FONTS = [
    ("public/fonts/inter-variable.woff2", "inter-latin.woff2", RANGES),
    ("public/fonts/hacknerdmono-regular.ttf", "hack-latin.woff2", RANGES),
    ("public/fonts/hacknerdmono-bold.ttf", "hack-latin-bold.woff2", RANGES),
    ("public/fontawesome/webfonts/fa-solid-900.woff2", "status-icon.woff2", "U+F1CE"),
]
for source, name, unicodes in FONTS:
    subset.main([
        str(ROOT / source),
        f"--unicodes={unicodes}",
        "--layout-features=*",
        "--flavor=woff2",
        f"--output-file={ROOT / 'site/fonts' / name}",
    ])
