"""Before/after contact sheet for the turned-corner crease, at TRUE pixel sizes.

The previous shipped mark filleted only the outer vertex of the cut and left the
crease (where the top edge turns onto the diagonal) sharp. This renders the same
geometry with the old sharp crease and with the new filleted crease, at every size
the ICO actually ships, magnified with nearest-neighbour so the difference is
judged in device pixels rather than in a scaled-down hero image.

Usage: python scripts/compare-crease.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app" / "brand" / "preview" / "crease-before-after.png"
SIZES = (16, 24, 32, 48, 64, 128, 256)
SMALL_OPTICAL_MAX_PX = 24

# Geometry from scripts/lib/brand-mark.cjs, used only to locate the fold region.
MASTER = {"R": 42.8, "T": 3.6, "FOLD": 12.8}
SMALL = {"R": 44.6, "T": 2.4, "FOLD": 14.0}


def render(crease_master: float, crease_small: float, work: Path) -> dict[int, Image.Image]:
    """Render the mark with the given crease radii and return frames at SIZES."""
    work.mkdir(parents=True, exist_ok=True)
    script = f"""
const fs = require("fs");
const path = require("path");
const mark = require({json.dumps(str(ROOT / "scripts" / "lib" / "brand-mark.cjs"))});
const palette = JSON.parse(
  fs.readFileSync({json.dumps(str(ROOT / "app" / "brand" / "palettes.json"))}, "utf8")
);
const theme = palette.themes[palette.selected];
mark.MASTER.sheet.creaseRadius = {crease_master};
mark.SMALL.sheet.creaseRadius = {crease_small};
fs.writeFileSync({json.dumps(str(work / "master.svg"))}, mark.masterSvg(theme));
fs.writeFileSync({json.dumps(str(work / "small.svg"))}, mark.smallSvg(theme));
"""
    (work / "gen.cjs").write_text(script, encoding="utf-8")
    subprocess.run(["node", str(work / "gen.cjs")], check=True, cwd=ROOT)

    frames: dict[int, Image.Image] = {}
    for size in SIZES:
        source = "small" if size <= SMALL_OPTICAL_MAX_PX else "master"
        big = work / f"{source}-1024.png"
        if not big.exists():
            subprocess.run(
                ["node", "scripts/render-icon.cjs", str(work / f"{source}.svg"), str(big), "1024"],
                check=True, cwd=ROOT, capture_output=True,
            )
        with Image.open(big) as image:
            frames[size] = image.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    return frames


def fold_crop(frame: Image.Image, size: int) -> Image.Image:
    geom = SMALL if size <= SMALL_OPTICAL_MAX_PX else MASTER
    unit = size / 48.0
    x0 = int(max(0, (geom["R"] - geom["FOLD"] - 5) * unit))
    x1 = int(min(size, (geom["R"] + 3) * unit))
    y0 = int(max(0, (geom["T"] - 3) * unit))
    y1 = int(min(size, (geom["T"] + geom["FOLD"] + 4) * unit))
    return frame.crop((x0, y0, x1, y1))


def main() -> None:
    work = Path(tempfile.mkdtemp(prefix="azkript-crease-"))
    try:
        before = render(0.0, 0.0, work / "before")
        after = render(17.5, 14.6, work / "after")

        rows = []
        for label, frames in (("before (sharp crease)", before), ("after (both corners filleted)", after)):
            cells = []
            for size in SIZES:
                crop = fold_crop(frames[size], size)
                zoom = max(2, round(150 / max(1, crop.width)))
                cells.append((size, crop.resize(
                    (crop.width * zoom, crop.height * zoom), Image.Resampling.NEAREST
                )))
            rows.append((label, cells))

        pad = 16
        label_h = 26
        row_w = sum(max(120, c.width + pad) for _, c in rows[0][1]) + pad
        row_h = max(c.height for _, c in rows[0][1]) + label_h
        sheet = Image.new("RGB", (row_w, row_h * 2 + 40), (226, 231, 238))
        draw = ImageDraw.Draw(sheet)
        y = 12
        for label, cells in rows:
            draw.text((pad, y), label, fill=(24, 26, 30))
            y += 22
            x = pad
            for size, cell in cells:
                bg = Image.new("RGBA", cell.size, (255, 255, 255, 255))
                bg.alpha_composite(cell)
                sheet.paste(bg.convert("RGB"), (x, y))
                draw.text((x, y + cell.height + 3), f"{size}px", fill=(60, 64, 72))
                x += max(120, cell.width + pad)
            y += row_h + 10
        sheet.save(OUT)
        print("wrote", OUT, sheet.size)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
