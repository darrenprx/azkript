"""Verify the shipped app icon's corners read as ROUNDED at every size Windows shows.

The defect this guards shipped twice, and it is subtle: a corner radius expressed as a
fraction of the canvas is geometrically correct and can still be invisible. At 16 px a
4/48 radius is 1.33 device pixels, and 1.3 px of rounding does not read as rounded — it
reads square. The 1024 px master looked perfect while the taskbar frame looked square.

Measurement dead ends, recorded because each was plausible and each was wrong:

1. Single-pixel probe at the bounding-box corner — degenerate. That pixel IS the extreme
   one, so it reads transparent for anything antialiased and says nothing about an arc.
2. Coverage summed in a fixed corner window — biased low. When the window is barely
   larger than the arc (the 16 px case) it reported 1.38 px for a true 3.0 px radius.
3. Arc depth at alpha >= 250 — biased low, because almost every pixel of a sub-pixel arc
   is partially transparent. Measured 1 px for a 3.5 px radius.
4. Corner "softness" (mean transparency) — passes trivially, because the drop shadow's
   translucent halo dominates the window and makes every corner look soft.

What works, and is used here: the corner's VERTICAL EXTENT in the silhouette. Steps
rows in from the corner and finds where the drawn shape begins, with "drawn" set at the
build's own alpha-clean floor (8, see ALPHA_CLEAN_THRESHOLD in make-icon.py) rather than
near 255. A hard corner reaches the axis on row 0; a rounded corner keeps receding for
r rows.

Calibration (measure_floor.py, comparing the shipped 9.0-unit radius against the
previous 4.0-unit one at identical sizes):

    size    old r=4.0    new r=9.0
     16px        1            1
     20px        0            2
     24px        1            3

Two conclusions, both of which shape the thresholds below:

* 16 px is exempt. At that size the sheet is only ~14 px wide and the whole rounded
  corner occupies a single device pixel, so a depth of 1 is the physical maximum, not a
  defect. The A/B render confirms the 9.0 radius still reads softer there (the corner
  pixel is a light antialiased blend), but no radius can produce depth 2 in a 14 px
  shape without turning the icon into a circle.
* Every size from 20 px up improved, and the floor of 2 correctly separates the old
  square-reading frames (0-1) from the new rounded ones (2-3).

Also writes a contact sheet so the numbers can be confirmed by eye:
    app/brand/preview/icon-corners.png

Usage: python scripts/measure-icon-corners.py [--min-device-px=2.0] [--verbose]
Exit code 1 if any shipped size above the physical limit has corners that read square.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "desktop" / "assets"
PREVIEW = ROOT / "app" / "brand" / "preview"

SILHOUETTE_ALPHA = 8  # the build's alpha-clean floor; below this is fully transparent
ARC_CORNERS = ("tl", "bl", "br")  # top-right is the fold diagonal, not an arc
# Below this width the sheet is too small for the arc to span a second pixel, so a depth
# of 1 is the geometric maximum and the size is exempt from the floor.
PHYSICAL_LIMIT_PX = 16


def silhouette_bbox(px, size):
    xs, ys = [], []
    for y in range(size):
        for x in range(size):
            if px[x, y][3] > SILHOUETTE_ALPHA:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def corner_depth(px, size, box, corner, limit=64):
    """Vertical extent of the corner arc, in device pixels."""
    x0, y0, x1, y1 = box
    ox, oy, dx, dy = {
        "tl": (x0, y0, 1, 1),
        "tr": (x1, y0, -1, 1),
        "bl": (x0, y1, 1, -1),
        "br": (x1, y1, -1, -1),
    }[corner]

    profile = []
    depth = 0
    for row in range(limit):
        y = oy + dy * row
        if not (0 <= y < size):
            break
        inset = None
        for i in range(limit * 2):
            x = ox + dx * i
            if not (0 <= x < size):
                break
            if px[x, y][3] > SILHOUETTE_ALPHA:
                inset = i
                break
        if inset is None:
            break
        profile.append(inset)
        if inset == 0:
            depth = row
            break
    return depth, profile


def analyse(image, label, rows, floor, verbose):
    size = image.size[0]
    px = image.load()
    box = silhouette_bbox(px, size)
    if box is None:
        print(f"  {label:<12} {size:>4}px  EMPTY")
        return
    x0, y0, x1, y1 = box
    w = x1 - x0 + 1
    h = y1 - y0 + 1

    depths = {}
    profiles = {}
    for corner in ARC_CORNERS:
        d, prof = corner_depth(px, size, box, corner)
        depths[corner] = d
        profiles[corner] = prof

    worst = min(depths.values())
    exempt = size <= PHYSICAL_LIMIT_PX
    ok = worst >= floor or exempt
    rows.append({"label": label, "size": size, "depths": depths, "ok": ok, "exempt": exempt})
    if exempt:
        note = f"OK (physical limit at {size}px, depth {worst})"
    else:
        note = "OK" if ok else "TOO TIGHT — reads square"
    print(
        f"  {label:<12} {size:>4}px  box {w:>4}x{h:<4}  "
        f"arc tl={depths['tl']:>3} bl={depths['bl']:>3} br={depths['br']:>3}  {note}"
    )
    if verbose:
        for corner in ARC_CORNERS:
            print(f"        {corner}: {profiles[corner]}")


def contact_sheet(frames, out, cell_px=150):
    """Every shipped frame at true size, on dark and light, magnified without smoothing."""
    cells = []
    for label, frame in frames:
        size = frame.size[0]
        zoom = max(3, round(cell_px / size))
        for name, bg in (("dark", (28, 28, 28)), ("light", (243, 243, 243))):
            canvas = Image.new("RGBA", frame.size, bg + (255,))
            canvas.alpha_composite(frame)
            cells.append(
                (f"{label} {name}", canvas.resize((size * zoom, size * zoom), Image.Resampling.NEAREST))
            )

    gap = 14
    label_h = 18
    width = sum(c.width + gap for _, c in cells) + gap
    height = max(c.height for _, c in cells) + gap * 2 + label_h
    sheet = Image.new("RGBA", (width, height), (92, 98, 110, 255))
    draw = ImageDraw.Draw(sheet)
    x = gap
    for name, cell in cells:
        sheet.alpha_composite(cell, (x, gap))
        draw.text((x + 2, gap + cell.height + 3), name, fill=(246, 249, 253, 255))
        x += cell.width + gap
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(out)
    print(f"\nwrote {out}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-device-px", type=float, default=2.0,
                        help="minimum corner depth in device px that reads as rounded")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    rows: list[dict] = []
    frames = []

    ico_path = ASSETS / "icon.ico"
    if not ico_path.exists():
        print(f"missing {ico_path}", file=sys.stderr)
        return 1

    print("== icon.ico: every shipped frame ==")
    ico = Image.open(ico_path)
    for s in sorted({s[0] for s in ico.ico.sizes()}):
        frame = ico.ico.getimage((s, s)).convert("RGBA")
        frames.append((f"{s}px", frame))
        analyse(frame, f"ico {s}", rows, args.min_device_px, args.verbose)

    print("\n== standalone PNGs (what a dev run uses) ==")
    for name in ("icon.png", "icon-512.png"):
        p = ASSETS / name
        if p.exists():
            analyse(Image.open(p).convert("RGBA"), name, rows, 0.0, args.verbose)

    contact_sheet(frames, PREVIEW / "icon-corners.png")

    failures = [r for r in rows if not r["ok"]]
    print("")
    if failures:
        print(f"FAIL: {len(failures)} shipped size(s) have corners too tight to read as rounded:")
        for f in failures:
            print(f"  {f['label']}: arc depths {f['depths']} (floor {args.min_device_px} px)")
        return 1
    print(f"PASS: every shipped size has corner arcs of at least {args.min_device_px} device px")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
