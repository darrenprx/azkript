"""Derive badge ramps that reproduce the structural pattern of the 2025 Office icons.

The measured facts (verified from the official icon SVGs) are:

  * the badge's LIGHT stop is a vivid mid-tone of the sheet's hue, not a near-black;
  * the badge's DEEP stop is at or just below the sheet ramp's deepest stop, so the
    badge lives INSIDE the sheet's tonal envelope rather than outside it;
  * consequently badge-vs-sheet contrast is modest (1.3-3.0), and the badge reads as
    "the same material, in shadow" rather than as a hole punched through the glyph;
  * white letterforms on the badge still clear ~4:1.

The first version of the palette got this wrong: it drove the badge almost to black
(contrast ~7.9 vs the sheet), which is the Obsidian/Linear idiom where the whole icon
is dark — not the Office idiom, where the sheet is bright and the badge is a sibling
tone. This script searches, per theme, for the badge ramp that satisfies those
constraints, and prints the stops to paste into palettes.json.

Run: python scripts/derive-badge-ramps.py
"""
from __future__ import annotations

import colorsys
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PALETTE = ROOT / "app" / "brand" / "palettes.json"

# Constraints, calibrated so the derived ramps land where the measured set does.
BADGE_LIGHT_VS_SHEET_MID = (1.6, 3.6)   # badge is a deeper plane of the same material
# Word's badge deep stop is literally the sheet ramp's deepest stop (contrast 1.0), so
# the low end of this band must reach 1.0 or the search invents a darker badge than the
# reference set ever uses.
BADGE_DEEP_VS_SHEET_DEEP = (1.0, 2.3)
# White monogram legibility, measured rather than assumed. White-on-badge contrast
# across the 2025 Office set: Teams 3.04, Excel 3.07, Word 4.02, PowerPoint 4.03,
# Access 4.23, OneNote 5.18. The floor is ~3.0, NOT the 4.5 a text-accessibility rule
# would demand — these are logotypes, not body copy, and the set deliberately lets a
# bright badge (Excel's green) sit at 3.07. Requiring 4.0 made bright-green and
# bright-teal sheets unsatisfiable, which is what forced this calibration.
LETTER_ON_BADGE = 3.0
RULES_ON_SHEET_MID = 1.35               # white content lines legibility

# HSL lightness of the badge's BRIGHTEST stop, measured across the 2025 set:
#   Excel 0.392, OneNote 0.498, PowerPoint 0.535, Access 0.541, Word 0.580, Teams 0.704
# A darkened WARM hue falls out of this band into brown: an orange at L 0.34 is
# perceptually brown no matter what its HSL saturation says (amber's badge measures 90%
# saturation and still reads as mud). Contrast ratios alone cannot catch that, because
# brown-on-orange has perfectly acceptable contrast. So the lightness band is checked
# directly, and for warm hues the search is allowed to rotate toward red — which is
# exactly how PowerPoint keeps an orange sheet with a vivid red badge.
BADGE_LIGHT_L = (0.39, 0.71)
# The badge must also be MEANINGFULLY darker than the sheet body, or it stops reading as
# a separate plane and looks like a smudge on the sheet. Measured badge-light vs
# sheet-mid lightness deltas across the set: PowerPoint -0.364, OneNote -0.296,
# Teams -0.358, Word -0.303, Excel -0.233, Access -0.157. Access is the floor at 0.16.
BADGE_TO_SHEET_MID_DELTA = 0.15
# The badge may rotate toward a deeper neighbour hue, which is what the real icons do:
# PowerPoint's sheet is orange (hue ~24) and its badge is red (hue ~350) precisely so the
# darkened badge stays vivid instead of turning brown. Darkening a fully saturated hue
# in HSL always desaturates it, so without a hue rotation the badge reads as mud.
MAX_HUE_ROTATION = 36.0
# Saturation: gains are unrestricted within reason; losses are tightly bounded because
# losing chroma is the actual "muddy badge" failure.
MAX_SATURATION_GAIN = 0.35
MAX_SATURATION_LOSS = 0.14


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(hex_color: str) -> float:
    n = int(hex_color.lstrip("#"), 16)
    r, g, b = (n >> 16) & 255, (n >> 8) & 255, n & 255
    return (
        0.2126 * srgb_to_linear(r / 255)
        + 0.7152 * srgb_to_linear(g / 255)
        + 0.0722 * srgb_to_linear(b / 255)
    )


def contrast(a: str, b: str) -> float:
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def to_hsl(hex_color: str) -> tuple[float, float, float]:
    n = int(hex_color.lstrip("#"), 16)
    r, g, b = ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, s, l


def to_hex(h: float, s: float, l: float) -> str:
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s)
    return "#{:02X}{:02X}{:02X}".format(
        max(0, min(255, round(r * 255))),
        max(0, min(255, round(g * 255))),
        max(0, min(255, round(b * 255))),
    )


def derive_badge(theme: dict) -> list[str]:
    """Search lightness offsets off the sheet's MID tone.

    Anchoring on the sheet's mid stop rather than its deepest stop matters: a
    gradient that travels in hue across the sheet (teal -> blue, green -> olive) has a
    deepest stop whose hue is legitimately far from the body the badge sits on. Taking
    the deep stop's hue made the derived badge drift out of the sheet's own hue family
    for exactly those two themes. The badge is a plane of the sheet's BODY, so the body
    is the right anchor.
    """
    sheet = theme["sheet"]
    base_h, base_s, base_l = to_hsl(sheet[1])

    best = None
    # The badge is DARKER than the sheet body it sits on, so the lightness offset runs
    # negative; the small positive window allows a badge that is a hair lighter than the
    # mid stop on themes whose mid stop is already very deep.
    for dh in [x * 2 for x in range(-18, 19)]:  # -36..+36 degrees
        for dl in [x / 100 for x in range(-75, 6, 1)]:
            for ds in [x / 100 for x in range(-14, 36, 2)]:
                if ds < -MAX_SATURATION_LOSS or ds > MAX_SATURATION_GAIN:
                    continue
                h = (base_h + dh) % 360
                s = max(0.0, min(1.0, base_s + ds))
                light_l = max(0.0, min(1.0, base_l + dl))
                if not (BADGE_LIGHT_L[0] <= light_l <= BADGE_LIGHT_L[1]):
                    continue
                if base_l - light_l < BADGE_TO_SHEET_MID_DELTA:
                    continue
                light = to_hex(h, s, light_l)

                # Verify the ACTUAL colour, not the parameters that produced it. to_hex
                # clamps to gamut, so the saturation of the emitted hex can differ from
                # base_s + ds — and it is the emitted colour that ships. Skipping this
                # check let the search satisfy its own inputs while violating the real
                # constraint, which is how forest ended up 14 points desaturated.
                actual_h, actual_s, _actual_l = to_hsl(light)
                hue_offset = min(abs(actual_h - base_h), 360 - abs(actual_h - base_h))
                if hue_offset > MAX_HUE_ROTATION:
                    continue
                if base_s - actual_s > MAX_SATURATION_LOSS:
                    continue

                c_mid = contrast(light, sheet[1])
                if not (BADGE_LIGHT_VS_SHEET_MID[0] <= c_mid <= BADGE_LIGHT_VS_SHEET_MID[1]):
                    continue
                letter = contrast("#FFFFFF", light)
                if letter < LETTER_ON_BADGE:
                    continue

                for dl2 in [x / 100 for x in range(0, 30, 1)]:
                    deep = to_hex(h, s, max(0.0, min(1.0, light_l - dl2)))
                    c_deep = contrast(deep, sheet[-1])
                    if not (BADGE_DEEP_VS_SHEET_DEEP[0] <= c_deep <= BADGE_DEEP_VS_SHEET_DEEP[1]):
                        continue
                    internal = contrast(light, deep)
                    if internal < 1.35:
                        continue
                    # Penalise hue rotation so a no-rotation solution wins whenever one
                    # exists; rotation is a repair for fully saturated hues, not a default.
                    score = (
                        abs(c_mid - 2.4)
                        + abs(c_deep - 1.45) * 1.5
                        + abs(internal - 1.9)
                        + abs(letter - 4.2) * 0.3
                        + abs(dh) * 0.004
                    )
                    if best is None or score < best[0]:
                        mid = to_hex(h, s, max(0.0, min(1.0, light_l - dl2 / 2)))
                        best = (
                            score,
                            [light, mid, deep],
                            {
                                "c_mid": c_mid,
                                "c_deep": c_deep,
                                "letter": letter,
                                "internal": internal,
                                "dh": dh,
                                "light_l": light_l,
                            },
                        )
    return best


def main() -> int:
    palette = json.loads(PALETTE.read_text(encoding="utf-8"))
    updated = json.loads(PALETTE.read_text(encoding="utf-8"))

    print(f"{'theme':10s} {'badge ramp':34s} {'c(mid)':>7s} {'c(deep)':>8s} {'white':>6s} {'step':>5s}")
    missing = []
    for tid, theme in palette["themes"].items():
        # A theme may lock its badge: some ramps are chosen by eye because they cannot
        # be derived. A darkened warm hue desaturates toward brown at every saturation
        # value, so "which red-orange is still vivid next to amber" is a judgement that
        # the numeric search cannot make — see scripts/badge-lab.cjs. Locked themes are
        # still CHECKED by scripts/palette-audit.cjs; they are only skipped here so a
        # re-derivation does not silently discard the visual decision.
        if theme.get("badgeLocked"):
            updated["themes"][tid]["badge"] = theme["badge"]
            print(f"{tid:10s} {' '.join(theme['badge']):34s} (locked)")
            continue
        result = derive_badge(theme)
        if result is None:
            missing.append(tid)
            print(f"{tid:10s} NO SOLUTION within the constraint band")
            continue
        _score, ramp, stats = result
        updated["themes"][tid]["badge"] = ramp
        print(
            f"{tid:10s} {' '.join(ramp):34s} "
            f"{stats['c_mid']:7.2f} {stats['c_deep']:8.2f} {stats['letter']:6.2f} {stats['internal']:5.2f} "
            f"  (was {' '.join(theme['badge'])})"
        )

    if missing:
        print(
            f"\nREFUSING TO WRITE: no solution for {', '.join(missing)}. "
            "Writing a partial file would silently leave those themes on stale ramps, "
            "which is worse than failing loudly."
        )
        return 1

    PALETTE.write_text(json.dumps(updated, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {PALETTE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
