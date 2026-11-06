"""Generate the Azkript desktop icon set from the canonical brand SVG.

The icon is no longer drawn here with Pillow primitives: `app/brand/azkript-mark.svg`
is the single source of truth for the mark, and this script rasterises it with
Chrome (through `scripts/render-icon.cjs`, which uses playwright-core) before
producing the PNG/ICO deliverables. That removes the drift where the desktop icon
and the in-app mark were two hand-maintained drawings that quietly diverged.

Usage (from the repository root):

    python scripts/make-icon.py

Prerequisites: Python + Pillow, Node, Chrome, and `rea/node_modules/playwright-core`
(all already required by the browser smoke test).

Pipeline:
  1. Render `app/brand/azkript-mark.svg` at 1024x1024 on a transparent page.
  2. Render `app/brand/azkript-mark-small.svg` (optical-size variant, same palette
     and tile) at 1024x1024.
  3. Downscale with LANCZOS to every tabbar size. Sizes <= SMALL_OPTICAL_MAX_PX
     are taken from the small variant; larger sizes from the master.
  4. Write icon.png (1024), icon-512.png (512) and a hand-built multi-size
     icon.ico (16,20,24,32,40,48,64,128,256; BMP entries up to 64 px for maximum
     shell compatibility, PNG-compressed entries at 128/256).
  5. Write QA sheets to app/brand/preview/ (all sizes at 1x and 4x, white and dark).

The outside of the plate is a rounded-corner tile, so every raster keeps alpha 0
outside those corners; the script asserts that corner alpha before writing.
"""
from __future__ import annotations

import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "app" / "brand"
PREVIEW = BRAND / "preview"
ASSETS = ROOT / "desktop" / "assets"

MASTER_SVG = BRAND / "azkript-mark.svg"
SMALL_SVG = BRAND / "azkript-mark-small.svg"

ICON_PNG_SIZE = 1024
ICON_PNG_512_SIZE = 512
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)

# Optical-size threshold. At <= 24 px the master's four rules, offset stack edge
# and cast shadow collapse into grey mush in a 16 px taskbar slot (verified on the
# QA sheet: the two soft rules merge into one band and the page edge darkens).
# Windows/Office icon sets ship a simplified drawing below that threshold, so
# sizes up to 24 px come from `azkript-mark-small.svg` — same plate, palette,
# sheet and fold, but three thicker rules, a larger sheet and no stack/shadow.
# 32 px and above keep the full master artwork, which still reads cleanly there.
SMALL_OPTICAL_MAX_PX = 24

QA_ZOOM = 4
QA_SIZES = (16, 20, 24, 32, 48, 64, 128, 256)
QA_BACKGROUNDS = (("white", (255, 255, 255)), ("dark", (27, 42, 61)))


def run(cmd: list[str]) -> None:
    print("$ " + " ".join(cmd))
    result = subprocess.run(cmd, cwd=ROOT, text=True)
    if result.returncode != 0:
        raise SystemExit(f"command failed ({result.returncode}): {' '.join(cmd)}")


def render_svg(svg: Path, out: Path, size: int) -> Image.Image:
    """Rasterise `svg` to `out` with Chrome and return it as 8-bit RGBA."""
    run(["node", "scripts/render-icon.cjs", str(svg), str(out), str(size)])
    image = Image.open(out)
    if image.size != (size, size):
        raise SystemExit(f"{out} rendered at {image.size}, expected {(size, size)}")
    image = image.convert("RGBA")
    return image


def assert_transparent_corners(image: Image.Image, label: str) -> None:
    """The plate is a rounded tile: all four corners must be fully transparent."""
    w, h = image.size
    probes = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    for point in probes:
        alpha = image.getpixel(point)[3]
        if alpha != 0:
            raise SystemExit(f"{label}: corner {point} alpha is {alpha}, expected 0")


# LANCZOS has negative lobes, so at small sizes its ringing can lift the alpha of
# pixels just outside the rounded plate to a few units (observed: 2/255 at 20 px)
# - invisible, but it is a non-zero alpha in an area that must be fully
# transparent, and Windows will happily draw that as a faint blue haze against a
# dark taskbar. Anything under this threshold is snapped to fully transparent.
ALPHA_CLEAN_THRESHOLD = 8


def clean_alpha(image: Image.Image) -> Image.Image:
    """Snap sub-perceptual alpha to 0 so the tile corners are exactly transparent."""
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a < ALPHA_CLEAN_THRESHOLD:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def downscale(image: Image.Image, size: int) -> Image.Image:
    return clean_alpha(image.resize((size, size), Image.Resampling.LANCZOS))


def build_ico(frames: dict[int, Image.Image], out: Path) -> None:
    """Write a multi-size .ico.

    Entries up to 64 px are stored as 32-bit BMP (DIB + AND mask) because every
    Windows shell version understands them; 128/256 are PNG-compressed, which
    keeps the file small and is supported since Vista.
    """
    entries: list[tuple[int, bytes]] = []
    for size in sorted(frames):
        frame = frames[size]
        if size <= 64:
            payload = _bmp_payload(frame)
        else:
            import io

            buffer = io.BytesIO()
            frame.save(buffer, format="PNG")
            payload = buffer.getvalue()
        entries.append((size, payload))

    header = struct.pack("<HHH", 0, 1, len(entries))
    directory = bytearray()
    offset = len(header) + 16 * len(entries)
    body = bytearray()
    for size, payload in entries:
        width = 0 if size >= 256 else size
        height = 0 if size >= 256 else size
        directory += struct.pack(
            "<BBBBHHII", width, height, 0, 0, 1, 32, len(payload), offset
        )
        body += payload
        offset += len(payload)
    out.write_bytes(header + bytes(directory) + bytes(body))


def _bmp_payload(image: Image.Image) -> bytes:
    """32-bit bottom-up BMP with the XOR bitmap followed by the 1-bit AND mask."""
    width, height = image.size
    pixels = image.load()
    header = struct.pack(
        "<IiiHHIIiiII",
        40,          # biSize
        width,       # biWidth
        height * 2,  # biHeight: XOR bitmap + AND mask
        1,           # biPlanes
        32,          # biBitCount
        0,           # biCompression = BI_RGB
        width * height * 4,  # biSizeImage (XOR bitmap only)
        0,           # biXPelsPerMeter
        0,           # biYPelsPerMeter
        0,           # biClrUsed
        0,           # biClrImportant
    )
    xor = bytearray()
    for y in range(height - 1, -1, -1):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            xor += bytes((b, g, r, a))
    mask_stride = ((width + 31) // 32) * 4
    mask = bytearray()
    for y in range(height - 1, -1, -1):
        row = bytearray(mask_stride)
        for x in range(width):
            if pixels[x, y][3] < 128:
                row[x >> 3] |= 0x80 >> (x & 7)
        mask += row
    return header + bytes(xor) + bytes(mask)


def label_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/seguisb.ttf",
        "C:/Windows/Fonts/arial.ttf",
    )
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def draw_label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fill: tuple[int, int, int]) -> None:
    draw.text(xy, text, font=label_font(14), fill=fill)


def source_for(size: int) -> str:
    return "small" if size <= SMALL_OPTICAL_MAX_PX else "master"


def compose_panel(
    frames: dict[int, Image.Image],
    background: tuple[int, int, int],
    ink: tuple[int, int, int],
    zoom: int,
    title: str,
    cell_min_width: int = 90,
) -> Image.Image:
    """One labeled row: each size rendered at `zoom`x nearest-neighbour."""
    cell_pad = 12
    caption_h = 38
    cells = [(size, frames[size].resize((size * zoom, size * zoom), Image.Resampling.NEAREST)) for size in QA_SIZES]
    cell_w = [max(cell_min_width, image.width + cell_pad * 2) for _, image in cells]
    body_h = max(image.height for _, image in cells) + caption_h
    width = sum(cell_w)
    panel = Image.new("RGBA", (width, 46 + body_h), background + (255,))
    draw = ImageDraw.Draw(panel)
    draw_label(draw, (cell_pad, 12), title, ink)
    x = 0
    for (size, image), cw in zip(cells, cell_w):
        y = 46 + body_h - caption_h - image.height
        panel.alpha_composite(image, (x + cell_pad, y))
        draw_label(draw, (x + cell_pad, 46 + body_h - caption_h + 2), f"{size}px  x{zoom}", ink)
        draw_label(draw, (x + cell_pad, 46 + body_h - caption_h + 19), source_for(size), ink)
        x += cw
    return panel


def stack(panels: list[Image.Image], gap: int, background: tuple[int, int, int]) -> Image.Image:
    width = max(panel.width for panel in panels)
    height = sum(panel.height for panel in panels) + gap * (len(panels) - 1)
    sheet = Image.new("RGBA", (width, height), background + (255,))
    y = 0
    for panel in panels:
        sheet.alpha_composite(panel, (0, y))
        y += panel.height + gap
    return sheet


def write_qa_sheets(frames: dict[int, Image.Image]) -> None:
    """icon-qa.png: every shipped size at 1x and 4x on white and dark.

    icon-qa-small.png: the decision sizes (16-48) at 8x, so the 16-24 px
    correction can actually be judged instead of guessed at.
    """
    PREVIEW.mkdir(parents=True, exist_ok=True)
    panels: list[Image.Image] = []
    for name, background in QA_BACKGROUNDS:
        ink = (32, 32, 32) if name == "white" else (232, 238, 247)
        panels.append(compose_panel(frames, background, ink, 1, f"actual size (1x) - {name}"))
        panels.append(compose_panel(frames, background, ink, QA_ZOOM, f"nearest-neighbour x{QA_ZOOM} - {name}"))
    stack(panels, gap=14, background=(226, 231, 238)).convert("RGB").save(PREVIEW / "icon-qa.png")

    zoom = 8
    detail_panels: list[Image.Image] = []
    for name, background in QA_BACKGROUNDS:
        ink = (32, 32, 32) if name == "white" else (232, 238, 247)
        cell_pad = 16
        sizes = (16, 20, 24, 32, 48)
        cells = [(size, frames[size].resize((size * zoom, size * zoom), Image.Resampling.NEAREST)) for size in sizes]
        cell_w = [image.width + cell_pad * 2 for _, image in cells]
        body_h = max(image.height for _, image in cells) + 40
        panel = Image.new("RGBA", (sum(cell_w), 48 + body_h), background + (255,))
        draw = ImageDraw.Draw(panel)
        draw_label(
            draw,
            (cell_pad, 12),
            f"small-size decision ({name}) - LANCZOS from 1024 px, nearest-neighbour x{zoom}",
            ink,
        )
        x = 0
        for (size, image), cw in zip(cells, cell_w):
            panel.alpha_composite(image, (x + cell_pad, 48 + body_h - 40 - image.height))
            draw_label(draw, (x + cell_pad, 48 + body_h - 38), f"{size}px", ink)
            draw_label(draw, (x + cell_pad, 48 + body_h - 21), f"from {source_for(size)}", ink)
            x += cw
        detail_panels.append(panel)
    stack(detail_panels, gap=14, background=(226, 231, 238)).convert("RGB").save(
        PREVIEW / "icon-qa-small.png"
    )


def parse_ico(path: Path) -> list[dict[str, int | str]]:
    data = path.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or kind != 1:
        raise SystemExit(f"{path}: not an ICO (reserved={reserved}, type={kind})")
    entries = []
    for index in range(count):
        base = 6 + index * 16
        width, height, colours, _, planes, bits, length, offset = struct.unpack_from(
            "<BBBBHHII", data, base
        )
        payload = data[offset : offset + length]
        kind_name = "PNG" if payload[:8] == b"\x89PNG\r\n\x1a\n" else "BMP"
        entries.append(
            {
                "width": width or 256,
                "height": height or 256,
                "colours": colours,
                "planes": planes,
                "bits": bits,
                "bytes": length,
                "offset": offset,
                "format": kind_name,
            }
        )
    return entries


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp(prefix="azkript-icon-"))
    try:
        master_path = work / "azkript-mark-1024.png"
        small_path = work / "azkript-mark-small-1024.png"

        master = render_svg(MASTER_SVG, master_path, 1024)
        assert_transparent_corners(master, "master 1024")
        master.save(ASSETS / "icon.png")
        print(f"wrote {ASSETS / 'icon.png'}")

        master.resize((ICON_PNG_512_SIZE, ICON_PNG_512_SIZE), Image.Resampling.LANCZOS).save(
            ASSETS / "icon-512.png"
        )
        print(f"wrote {ASSETS / 'icon-512.png'}")

        small = None
        if SMALL_OPTICAL_MAX_PX >= min(ICO_SIZES):
            if not SMALL_SVG.exists():
                raise SystemExit(
                    f"{SMALL_SVG.name} is missing but the optical-size threshold is "
                    f"{SMALL_OPTICAL_MAX_PX} px"
                )
            small = render_svg(SMALL_SVG, small_path, 1024)
            assert_transparent_corners(small, "small 1024")

        frames: dict[int, Image.Image] = {}
        for size in ICO_SIZES:
            source = small if (small is not None and size <= SMALL_OPTICAL_MAX_PX) else master
            frame = downscale(source, size)
            assert_transparent_corners(frame, f"ico {size}px")
            frames[size] = frame

        ico_path = ASSETS / "icon.ico"
        build_ico(frames, ico_path)
        print(f"wrote {ico_path}")

        write_qa_sheets(frames)

        verify(master, frames, ico_path)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def verify(master: Image.Image, frames: dict[int, Image.Image], ico_path: Path) -> None:
    print("\n== deliverable checks ==")
    expected_pngs = {
        ASSETS / "icon.png": (ICON_PNG_SIZE, ICON_PNG_SIZE),
        ASSETS / "icon-512.png": (ICON_PNG_512_SIZE, ICON_PNG_512_SIZE),
    }
    for path, expected in expected_pngs.items():
        with Image.open(path) as image:
            assert image.size == expected, f"{path}: {image.size} != {expected}"
            mode = image.mode
            icc = image.info.get("icc_profile")
            assert mode == "RGBA", f"{path}: mode {mode}, expected RGBA"
            assert icc is None, f"{path}: unexpected embedded ICC profile"
            print(f"OK {path.name}: {image.size}, mode={mode}, 8-bit={image.getbands()}, icc=None, {path.stat().st_size} bytes")

    entries = parse_ico(ico_path)
    sizes = [entry["width"] for entry in entries]
    expected_sizes = sorted(ICO_SIZES)
    print(f"ICO directory ({len(entries)} entries): {sizes}")
    for entry in entries:
        print(
            f"  {entry['width']}x{entry['height']} {entry['format']} {entry['bits']}bpp "
            f"{entry['bytes']} bytes @ {entry['offset']}"
        )
    assert sizes == expected_sizes, f"ICO sizes {sizes} != {expected_sizes}"
    assert all(entry["format"] == ("BMP" if entry["width"] <= 64 else "PNG") for entry in entries)

    with Image.open(ico_path) as ico:
        embedded = sorted({size[0] for size in ico.ico.sizes()})
        assert embedded == expected_sizes, f"Pillow reads {embedded} != {expected_sizes}"
        print(f"Pillow read-back ICO sizes: {embedded}")
        # Every embedded frame must be the exact raster we intended, not a
        # re-encoded or wrongly-sized image, so compare pixel-by-pixel.
        for size in expected_sizes:
            decoded = ico.ico.getimage((size, size)).convert("RGBA")
            expected = frames[size]
            assert decoded.size == (size, size), f"ICO {size}px decodes to {decoded.size}"
            diff = ImageChops.difference(decoded, expected)
            extreme = max(channel[1] for channel in diff.getextrema())
            assert extreme == 0, f"ICO {size}px frame differs from the intended raster (max delta {extreme})"
        print(f"OK ICO frame round-trip: all {len(expected_sizes)} embedded rasters are pixel-identical to the intended frames")

    for size, frame in frames.items():
        assert frame.size == (size, size)
        assert frame.mode == "RGBA"
        assert_transparent_corners(frame, f"frame {size}px")
    print(f"OK corner alpha = 0 on all {len(frames)} frames")

    master_alpha = master.getchannel("A")
    histogram = master_alpha.histogram()
    transparent = histogram[0]
    print(
        f"OK master 1024: {master.size} RGBA, {transparent} fully transparent px "
        f"({transparent / (ICON_PNG_SIZE ** 2) * 100:.1f}%), corners alpha=0"
    )
    print(f"OK optical-size threshold: <= {SMALL_OPTICAL_MAX_PX} px uses {SMALL_SVG.name}, above uses {MASTER_SVG.name}")
    print("QA sheets:")
    for name in ("icon-qa.png", "icon-qa-small.png"):
        path = PREVIEW / name
        print(f"  {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
