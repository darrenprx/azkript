"""Zoom the turned corner of every shipped ICO frame, side by side.

The 1024 px master measures a correct fillet, so if the user still sees an acute point
the problem is downstream: either the fillet is thinner than one device pixel at small
sizes, or some build step drops it. This produces a contact sheet of the actual shipped
frames so the answer comes from the artefact rather than from the source.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICO = ROOT / "desktop" / "assets" / "icon.ico"
OUT = ROOT / "app" / "brand" / "preview" / "fold-vertex-sizes.png"

MASTER = {"R": 42.8, "T": 3.6, "FOLD": 12.8}
SMALL = {"R": 44.6, "T": 2.4, "FOLD": 14.0}

cells = []
for s in sorted({x[0] for x in Image.open(ICO).ico.sizes()}):
    frame = Image.open(ICO).ico.getimage((s, s)).convert("RGBA")
    geom = SMALL if s <= 24 else MASTER
    unit = s / 48.0
    cx = int(round(geom["R"] * unit))
    cy = int(round((geom["T"] + geom["FOLD"]) * unit))
    pad = max(3, int(round(s * 0.16)))
    box = (max(0, cx - pad), max(0, cy - pad), min(s, cx + pad), min(s, cy + pad))
    crop = frame.crop(box)
    bg = Image.new("RGBA", crop.size, (24, 24, 28, 255))
    bg.alpha_composite(crop)
    zoom = max(4, int(round(150 / max(1, crop.width))))
    cells.append((f"{s}px (x{zoom})", bg.resize((crop.width * zoom, crop.height * zoom), Image.Resampling.NEAREST)))

gap = 14
label_h = 18
width = sum(c.width + gap for _, c in cells) + gap
height = max(c.height for _, c in cells) + gap * 2 + label_h
sheet = Image.new("RGBA", (width, height), (96, 102, 114, 255))
draw = ImageDraw.Draw(sheet)
x = gap
for name, cell in cells:
    sheet.alpha_composite(cell, (x, gap))
    draw.text((x + 2, gap + cell.height + 3), name, fill=(246, 249, 253, 255))
    x += cell.width + gap
sheet.convert("RGB").save(OUT)
print("wrote", OUT, sheet.size)
