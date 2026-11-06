"""Measure each corner of the shipped artwork by fitting the actual arc.

Naive probing fails for a specific reason worth recording: the drop shadow is
semi-transparent, so an alpha>=128 "bounding box" is the SHADOW's bbox, several pixels
outside the sheet. The sheet itself must be isolated at high alpha (>=250).

A second trap: probing the exact bbox row/column is degenerate, because by definition
that row is where the extreme pixel lives, so the inset always reads 0 and every corner
looks square. The correct probe starts a few pixels INSIDE the bbox edge and asks where
the shape begins, which traces the arc.

For a rounded corner of radius r with the corner box at (cx, cy), at depth d along one
axis the shape's edge sits (r - sqrt(r^2 - (r-d)^2)) inward. This script solves for r
by least squares over several depths, then reports r in design units.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
GRID = 48.0
BODY_ALPHA = 250


def sheet_bbox(px, size):
    xs, ys = [], []
    for y in range(size):
        for x in range(size):
            if px[x, y][3] >= BODY_ALPHA:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def fit_radius(px, size, x0, y0, x1, y1, corner, depths):
    """Least-squares fit of the corner arc radius in pixels."""
    samples = []
    for d in depths:
        if corner in ("top-left", "bottom-left"):
            # walk right along a row; find first opaque pixel
            y = y0 + d if corner == "top-left" else y1 - d
            start = x0
            step = 1
        else:
            y = y0 + d if corner == "top-right" else y1 - d
            start = x1
            step = -1
        found = None
        for i in range(size):
            x = start + step * i
            if not (0 <= x < size):
                break
            if px[x, y][3] >= BODY_ALPHA:
                found = i
                break
        if found is not None:
            samples.append((d, found))
    if len(samples) < 3:
        return None, samples

    best = None
    for r10 in range(10, 400):
        r = r10 / 10.0
        err = 0.0
        for d, inset in samples:
            if d <= r:
                predicted = r - math.sqrt(max(0.0, r * r - (r - d) ** 2))
            else:
                predicted = 0.0
            err += (predicted - inset) ** 2
        if best is None or err < best[0]:
            best = (err, r)
    return best[1], samples


def main() -> int:
    target = ROOT / "desktop" / "assets" / "icon.png"
    image = Image.open(target).convert("RGBA")
    size = image.size[0]
    px = image.load()
    unit = size / GRID

    bbox = sheet_bbox(px, size)
    if bbox is None:
        print("FAIL: no opaque artwork")
        return 1
    x0, y0, x1, y1 = bbox
    print(f"{target.name}: {size}x{size}, sheet bbox {bbox} "
          f"({x1-x0+1}x{y1-y0+1} px), 1 unit = {unit:.2f} px\n")

    # Depths chosen to sit inside the arc but clear of antialiasing right at the vertex.
    depths = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30]
    radii = {}
    for corner in ("top-left", "bottom-left", "bottom-right", "top-right"):
        r, samples = fit_radius(px, size, x0, y0, x1, y1, corner, depths)
        radii[corner] = r
        if r is None:
            print(f"  {corner:13s} could not fit (samples {samples})")
            continue
        print(f"  {corner:13s} radius {r:6.1f} px = {r/unit:5.2f} units"
              f"   (samples {samples[:6]})")

    print("\nreference: the SVG declares rx=3.6 units for the sheet")
    print(f"top-right is the FOLD (a straight diagonal), not an arc: fitted {radii['top-right']}")

    for corner in ("top-left", "bottom-left", "bottom-right"):
        r = radii[corner]
        if r is None:
            print(f"FAIL: {corner} could not be measured")
            return 1
        units = r / unit
        if units < 1.5:
            print(f"FAIL: {corner} radius is {units:.2f} units — effectively a SQUARE corner")
            return 1
    print("\nAll three arc corners are rounded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
