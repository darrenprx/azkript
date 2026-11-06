"""Check BOTH corners of the turned-corner cut actually survive rasterisation.

The cut has two convex 135-degree ends:
  - the CREASE, where the sheet's top edge turns onto the diagonal;
  - the OUTER vertex, where the diagonal meets the right edge.

Why this is not a source-code check. A fillet on a corner that shallow only pulls
the silhouette inward by `radius * (1/sin(67.5deg) - 1) = 0.0824 * radius`, so an
arc can be perfectly present in the SVG and still be invisible after the drawing is
squeezed into 16-256 px. That is how the original spike shipped twice, and why the
first regression test (which asserted "an arc follows the diagonal") passed a mark
the user could plainly see was wrong.

So this renders the mark TWICE — once with the corners filleted as shipped, once
with them sharp — downscales both exactly the way scripts/make-icon.py does, and
measures the difference in ink at each corner. If the fillet is real and survives
the downscale, the filleted frame must have measurably less coverage in the corner
window than the sharp one, by an amount that matches the predicted pull.

Usage: python scripts/check-fold-vertex.py [--verbose]
Exit code 1 if either corner fails to show a real, measurable rounding at a size
where the eye could see it.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICO = ROOT / "desktop" / "assets" / "icon.ico"

# Sizes at or below this use the simplified optical variant (see make-icon.py).
# Read from the generator below rather than re-typed.

# A rounding is only claimed to be visible once it moves the silhouette by this
# much in DEVICE pixels. Half a pixel is the honest floor: below that the eye
# cannot separate the fillet from antialiasing noise.
MIN_VISIBLE_DEVICE_PX = 0.5


def geometry() -> dict:
    """Read radii, vertex positions and the pull ratio from the generator itself."""
    script = """
const mark = require(%s);
const out = {};
for (const [name, g] of [["master", mark.MASTER], ["small", mark.SMALL]]) {
  const cut = mark.cutGeometry(g);
  out[name] = {
    creaseRadius: g.sheet.creaseRadius,
    cutRadius: g.sheet.cutRadius,
    crease: cut.crease,
    outer: cut.outer,
    straight: cut.straight,
    pullRatio: mark.FILLET_PULL_RATIO,
  };
}
out.smallMax = mark.SMALL_OPTICAL_MAX_PX;
process.stdout.write(JSON.stringify(out));
""" % json.dumps(str(ROOT / "scripts" / "lib" / "brand-mark.cjs"))
    result = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"could not read brand geometry from node: {result.stderr}")
    return json.loads(result.stdout)


def render_frames(crease: float, cut: float, work: Path, sizes: list[int],
                  small_max: int, small_crease: float, small_cut: float) -> dict[int, Image.Image]:
    """Render 1024 px masters, then downscale exactly as make-icon.py does."""
    work.mkdir(parents=True, exist_ok=True)
    script = """
const fs = require("fs");
const mark = require(%(module)s);
const palette = JSON.parse(fs.readFileSync(%(palettes)s, "utf8"));
const theme = palette.themes[palette.selected];
// Cross multiply so each variant keeps its own scale but the comparison is a
// per-variant before/after of the same drawing.
mark.MASTER.sheet.creaseRadius = %(crease)s;
mark.SMALL.sheet.creaseRadius = %(smallCrease)s;
mark.MASTER.sheet.cutRadius = %(cut)s;
mark.SMALL.sheet.cutRadius = %(smallCut)s;
fs.writeFileSync(%(masterOut)s, mark.masterSvg(theme));
fs.writeFileSync(%(smallOut)s, mark.smallSvg(theme));
""" % {
        "module": json.dumps(str(ROOT / "scripts" / "lib" / "brand-mark.cjs")),
        "palettes": json.dumps(str(ROOT / "app" / "brand" / "palettes.json")),
        "crease": crease,
        "cut": cut,
        "smallCrease": small_crease,
        "smallCut": small_cut,
        "masterOut": json.dumps(str(work / "master.svg")),
        "smallOut": json.dumps(str(work / "small.svg")),
    }
    (work / "gen.cjs").write_text(script, encoding="utf-8")
    subprocess.run(["node", str(work / "gen.cjs")], check=True, cwd=ROOT)

    masters: dict[str, Image.Image] = {}
    for name in ("master", "small"):
        target = work / f"{name}-1024.png"
        subprocess.run(
            ["node", "scripts/render-icon.cjs", str(work / f"{name}.svg"), str(target), "1024"],
            check=True, cwd=ROOT, capture_output=True,
        )
        with Image.open(target) as image:
            masters[name] = image.convert("RGBA")

    frames: dict[int, Image.Image] = {}
    for size in sizes:
        source = masters["small"] if size <= small_max else masters["master"]
        frames[size] = source.resize((size, size), Image.Resampling.LANCZOS)
    return frames


def corner_window(size: int, vertex: dict, radius: float, unit: float) -> tuple[int, int, int, int]:
    """A tight window around ONE cut end, sized to that fillet.

    The window is deliberately smaller than half the distance between the two cut
    ends, so a measurement can never be contaminated by the other corner's arc. The
    extent is the fillet's own footprint: its tangent run along the two edges plus
    the inward pull, with a pixel of slack for antialiasing.
    """
    reach_units = radius * 0.4143 + radius * 0.0824 + 1.2  # tangent + pull + slack
    half = reach_units * unit
    cx = vertex["x"] * unit
    cy = vertex["y"] * unit
    return (
        max(0, int(cx - half)),
        max(0, int(cy - half)),
        min(size, int(cx + half) + 1),
        min(size, int(cy + half) + 1),
    )


def removed_area(filleted: Image.Image, sharp: Image.Image,
                 box: tuple[int, int, int, int]) -> float:
    """Device pixels of coverage the fillet cut away inside `box`.

    Comparing the two renders is what makes this measurable at all: a fillet on a
    135-degree corner removes a sliver only a few tenths of a pixel wide, and there
    is no absolute threshold for "rounded enough" in a single image. But the SAME
    drawing rendered sharp differs from it exactly by that sliver, so the difference
    is the fillet, with antialiasing and downscale ringing cancelling out because
    both sides went through the identical pipeline.

    Pixels where the filleted frame is MORE opaque are clipped out, so the other
    corner's fillet (which can only ever add coverage in its own window) cannot
    contribute.
    """
    a = filleted.crop(box).getchannel("A")
    b = sharp.crop(box).getchannel("A")
    area = 0.0
    for av, bv in zip(a.get_flattened_data(), b.get_flattened_data()):
        if bv > av:
            area += (bv - av) / 255.0
    return area


def main() -> int:
    verbose = "--verbose" in sys.argv
    geo = geometry()
    small_max = geo["smallMax"]

    if not ICO.exists():
        print(f"MISSING: {ICO} (run python scripts/make-icon.py)")
        return 2

    ico = Image.open(ICO)
    sizes = sorted({s[0] for s in ico.ico.sizes()})
    print(f"shipped ICO frames: {sizes}")

    work = Path(tempfile.mkdtemp(prefix="azkript-foldcheck-"))
    try:
        shipped = render_frames(
            geo["master"]["creaseRadius"], geo["master"]["cutRadius"], work / "shipped",
            sizes, small_max, geo["small"]["creaseRadius"], geo["small"]["cutRadius"],
        )
        sharp = render_frames(
            0.0001, 0.0001, work / "sharp",
            sizes, small_max, 0.0001, 0.0001,
        )

        rows = []
        failures = []
        for size in sizes:
            variant = "small" if size <= small_max else "master"
            geom = geo[variant]
            unit = size / 48.0
            for corner, radius in (
                ("crease", geom["creaseRadius"]),
                ("outer", geom["cutRadius"]),
            ):
                vertex = geom[corner]
                box = corner_window(size, vertex, radius, unit)
                removed = removed_area(shipped[size], sharp[size], box)
                # Predicted footprint of the fillet: the arc cuts a lens of roughly
                # 0.043 * radius^2 square units, so in device px that is
                # 0.043 * radius^2 * unit^2.
                predicted_units2 = 0.043 * radius * radius
                predicted_px2 = predicted_units2 * unit * unit
                rows.append({
                    "size": size, "corner": corner, "variant": variant,
                    "radius": radius,
                    "pull_px": radius * geom["pullRatio"] * unit,
                    "predicted_px2": predicted_px2,
                    "removed_px2": removed,
                    "ok": True,
                })
                # A footprint below the resolvable limit is not "ok": the fillet is
                # simply too small to judge at this size, and the structural check
                # below is what forbids shipping it that small in the first place.
                if predicted_px2 < 0.4:
                    rows[-1]["verdict"] = "too small to judge"
                elif removed < predicted_px2 * 0.25:
                    rows[-1]["verdict"] = "NO ROUNDING SURVIVED"
                    rows[-1]["ok"] = False
                    failures.append(rows[-1])
                else:
                    rows[-1]["verdict"] = "ok"

        print(f"\na fillet is claimed visible only where it removes at least a quarter")
        print(f"of its predicted footprint and that footprint clears 0.4 device px2\n")
        print(f"{'size':>6} {'corner':<8} {'variant':<7} {'radius':>7} {'pull':>8} "
              f"{'predicted':>11} {'measured':>10}  verdict")
        for row in rows:
            print(
                f"{row['size']:>5}px {row['corner']:<8} {row['variant']:<7} {row['radius']:>7.1f} "
                f"{row['pull_px']:>6.2f}px {row['predicted_px2']:>9.3f}px2 "
                f"{row['removed_px2']:>8.3f}px2  {row['verdict']}"
            )

        print("\nstructural check (source geometry, not raster):")
        structure_fail = False
        for name in ("master", "small"):
            geom = geo[name]
            crease_pull = geom["creaseRadius"] * geom["pullRatio"]
            outer_pull = geom["cutRadius"] * geom["pullRatio"]
            print(
                f"  {name}: crease r={geom['creaseRadius']:.1f} (pull {crease_pull:.2f}u), "
                f"outer r={geom['cutRadius']:.1f} (pull {outer_pull:.2f}u), "
                f"straight diagonal left {geom['straight']:.2f}u"
            )
            if crease_pull < 0.8 or outer_pull < 0.8:
                print(f"    FAIL: {name} has a corner with under 0.8u of pull")
                structure_fail = True
            if geom["straight"] <= 2.0:
                print(f"    FAIL: {name} has only {geom['straight']:.2f}u of straight diagonal left")
                structure_fail = True

        print()
        if failures or structure_fail:
            if failures:
                print(f"FAIL: {len(failures)} corner(s) lost their rounding in rasterisation:")
                for row in failures:
                    print(
                        f"  {row['size']}px {row['corner']}: predicted footprint "
                        f"{row['predicted_px2']:.3f}px2, but only {row['removed_px2']:.3f}px2 of coverage "
                        f"was actually cut away versus a sharp-cornered render"
                    )
            return 1
        print("PASS: both ends of the turned-corner cut are filleted, and the rounding survives")
        print("      rasterisation at every shipped size where it is resolvable")
        if verbose:
            print(json.dumps(rows, indent=2))
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
