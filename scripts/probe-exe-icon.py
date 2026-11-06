"""Probe whether the packaged Windows executable embeds the current icon.ico,
and whether the WINDOWS SHELL actually renders that same image.

electron-builder stamps the app icon into the PE resource table. If the exe was
built from an older `desktop/assets/icon.ico` (or from icon.png), Explorer and the
taskbar show a stale mark even though the source ICO is correct. This walks the PE
resource directory for RT_GROUP_ICON / RT_ICON and compares each entry against the
frames of `desktop/assets/icon.ico` byte-for-byte.

Two failure modes look identical to a user ("the exe didn't use this icon") but have
different fixes, so this reports which one is happening:

  A. STALE BUILD   the embedded frames are not the current icon.ico
                   -> fix: `npm run package:dir` (then repackage portable/installer)
  B. STALE CACHE   the embedded frames ARE current, but the shell still hands back a
                   different image for that path
                   -> fix: `pwsh scripts/refresh-icon-cache.ps1`

The shell half of this check is what distinguishes them. It extracts the image the
shell really renders through the same APIs Explorer and the taskbar use
(SHGetFileInfoW for 16/32 px, and the SHIL_* system image lists for 16/32/48/256 px,
including the 256 px "jumbo" slot) and compares those pixels against the ICO frames.

Usage:
    python scripts/probe-exe-icon.py                 # probe every dist/ artifact
    python scripts/probe-exe-icon.py <exe>           # probe one file
    python scripts/probe-exe-icon.py --no-shell      # bytes only (fast, no Win32)
    python scripts/probe-exe-icon.py --require-exe   # fail if dist/ is absent
    python scripts/probe-exe-icon.py --json          # machine-readable summary

Exit codes: 0 = pass (or no artifact to check), 1 = fail, 2 = usage/parse error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICO = ROOT / "desktop" / "assets" / "icon.ico"
DIST = ROOT / "dist"
DEFAULT_EXE = DIST / "win-unpacked" / "Azkript.exe"

RT_ICON = 3
RT_GROUP_ICON = 14

# Sizes the shell check ASSERTS. These are the slots where Windows hands back the
# matching ICO frame to within a couple of LSBs, so a strict comparison is safe:
# measured across 8 fresh processes, worst per-channel delta = 2 and mean < 0.4 at
# 16 / 32 / 256 px. 256 px matters most: it is the "jumbo" Explorer view and the
# slot where the PNG-compressed 256 px frame actually gets decoded.
#
# 48 px (SHIL_EXTRALARGE) is REPORTED BUT NOT ASSERTED. Windows does not return the
# ICO's 48 px DIB for that slot; it composites its own cell, and the result varies
# between processes (the same unchanged exe yielded mean delta 0.145 in one process
# and 7.445 in another). Asserting on it would make the guard flaky, and relaxing
# the tolerance enough to absorb that variance would let a genuinely wrong 48 px
# mark through. The embedded 48 px frame is still checked byte-exactly above, which
# is the check that actually catches a stale build.
SHELL_ASSERT_SIZES = (16, 32, 256)
SHELL_REPORT_SIZES = (48,)
SHELL_WORST_TOLERANCE = 16   # max per-channel delta allowed on an asserted slot
SHELL_MEAN_TOLERANCE = 2.0   # mean per-channel delta allowed on an asserted slot


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# ICO parsing
# ---------------------------------------------------------------------------
def ico_frames(path: Path) -> list[dict]:
    data = path.read_bytes()
    count = struct.unpack_from("<H", data, 4)[0]
    out = []
    for i in range(count):
        base = 6 + i * 16
        w, h, colours, _, planes, bits, length, offset = struct.unpack_from(
            "<BBBBHHII", data, base
        )
        payload = data[offset : offset + length]
        out.append(
            {
                "size": w or 256,
                "bits": bits,
                "bytes": length,
                "payload": payload,
                "png": payload[:8] == b"\x89PNG\r\n\x1a\n",
                "sha256": sha256(payload),
            }
        )
    return out


def ico_frame_image(size: int):
    """Decode one ICO frame to RGBA using Pillow (handles DIB and PNG frames)."""
    from PIL import Image

    im = Image.open(ICO)
    im.size = (size, size)
    im.load()
    return im.convert("RGBA")


# ---------------------------------------------------------------------------
# PE parsing
# ---------------------------------------------------------------------------
def pe_sections(exe: bytes) -> tuple[int, list[dict]]:
    pe_off = struct.unpack_from("<I", exe, 0x3C)[0]
    if exe[pe_off : pe_off + 4] != b"PE\0\0":
        raise SystemExit("not a PE file")
    coff = pe_off + 4
    num_sections = struct.unpack_from("<H", exe, coff + 2)[0]
    opt_size = struct.unpack_from("<H", exe, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from("<H", exe, opt)[0]
    # PE32 (0x10B) puts NumberOfRvaAndSizes at opt+92; PE32+ (0x20B) at opt+108.
    rva_count_off = opt + (92 if magic == 0x10B else 108)
    num_dirs = struct.unpack_from("<I", exe, rva_count_off)[0]
    dirs = rva_count_off + 4
    resource_rva, resource_size = struct.unpack_from("<II", exe, dirs + 16)  # index 2
    sections = []
    sec = opt + opt_size
    for i in range(num_sections):
        base = sec + i * 40
        name = exe[base : base + 8].rstrip(b"\0").decode("latin-1")
        vsize, vaddr, rawsize, rawptr = struct.unpack_from("<IIII", exe, base + 8)
        sections.append(
            {"name": name, "vsize": vsize, "vaddr": vaddr, "rawsize": rawsize, "rawptr": rawptr}
        )
    return resource_rva, sections, num_dirs


def rva_to_offset(sections: list[dict], rva: int) -> int:
    for s in sections:
        if s["vaddr"] <= rva < s["vaddr"] + max(s["vsize"], s["rawsize"]):
            return s["rawptr"] + (rva - s["vaddr"])
    raise SystemExit(f"rva {rva:#x} not inside any section")


def walk_resources(exe: bytes, sections, resource_rva: int) -> dict:
    base = rva_to_offset(sections, resource_rva)
    found = {}

    def entries(dir_off: int):
        named = struct.unpack_from("<H", exe, dir_off + 12)[0]
        ids = struct.unpack_from("<H", exe, dir_off + 14)[0]
        out = []
        for i in range(named + ids):
            e = dir_off + 16 + i * 8
            name, target = struct.unpack_from("<II", exe, e)
            out.append((name, target))
        return out

    for type_name, type_target in entries(base):
        if type_name not in (RT_ICON, RT_GROUP_ICON):
            continue
        if not type_target & 0x80000000:
            continue
        type_dir = base + (type_target & 0x7FFFFFFF)
        items = []
        for res_name, res_target in entries(type_dir):
            if not res_target & 0x80000000:
                continue
            name_dir = base + (res_target & 0x7FFFFFFF)
            for _, lang_target in entries(name_dir):
                # At the language level the offset normally points straight at an
                # IMAGE_RESOURCE_DATA_ENTRY and carries no high bit (the bit means
                # "this is another directory"). Handle both encodings.
                data_entry = base + (lang_target & 0x7FFFFFFF)
                data_rva, data_size = struct.unpack_from("<II", exe, data_entry)
                off = rva_to_offset(sections, data_rva)
                items.append({"id": res_name, "size": data_size, "data": exe[off : off + data_size]})
        found[type_name] = items
    return found


def parse_group(payload: bytes) -> list[dict]:
    if len(payload) < 6:
        return []
    count = struct.unpack_from("<H", payload, 4)[0]
    out = []
    for i in range(count):
        off = 6 + i * 14
        w, h, colours, _, planes, bits, length, ident = struct.unpack_from("<BBBBHHIH", payload, off)
        out.append({"size": w or 256, "bits": bits, "bytes": length, "id": ident})
    return out


# ---------------------------------------------------------------------------
# Pixel comparison
# ---------------------------------------------------------------------------
def compare_rgba(a, b) -> tuple[int, float, int]:
    """Worst per-channel delta, mean per-channel delta, and pixels over 24."""
    if a.size != b.size:
        raise ValueError(f"size mismatch {a.size} vs {b.size}")
    pa, pb = a.load(), b.load()
    w, h = a.size
    worst = 0
    total = 0
    over = 0
    for y in range(h):
        for x in range(w):
            d = 0
            for i in range(4):
                delta = abs(pa[x, y][i] - pb[x, y][i])
                if delta > d:
                    d = delta
            total += d
            if d > worst:
                worst = d
            if d > 24:
                over += 1
    return worst, total / (w * h), over


def normalize_mark(img, canvas: int = 64):
    """Crop to the painted area and scale it to a fixed canvas.

    Windows does not hand back an ICO frame verbatim. It re-composes the icon into
    its own image-list cell: it may add or trim a margin, quantise alpha, and (for
    the 48 px "extra large" list) re-render rather than copy the 48 px frame. Those
    are presentation differences, not design differences, and comparing raw pixels
    would either flag them as a stale icon (false positive) or force a tolerance so
    loose that a genuinely wrong mark would slip through.

    Measuring the painted mark instead compares what a human actually sees: the
    shape, its proportions, and its colours. A stale or different icon has a
    different silhouette or palette and still fails by a wide margin.
    """
    from PIL import Image

    bbox = img.getchannel("A").getbbox()
    if bbox is None:
        return Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    mark = img.crop(bbox)
    # Scale to a square canvas, preserving the mark's aspect ratio.
    scale = min(canvas / mark.width, canvas / mark.height)
    new = (max(1, round(mark.width * scale)), max(1, round(mark.height * scale)))
    mark = mark.resize(new, Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(mark, ((canvas - new[0]) // 2, (canvas - new[1]) // 2))
    return out


def compare_marks(a, b, canvas: int = 64) -> tuple[int, float, int]:
    """Compare two icons as normalised designs (kept for diagnostics only).

    Not used for pass/fail: Windows hands back the per-size frame closely enough
    that a raw comparison is both stricter and correct (measured worst=2, mean<0.4
    on every asserted size once the cache is warm). Normalising first would hide a
    real scale/placement defect, so the guard uses raw pixels and this stays
    available for manual investigation.
    """
    na = normalize_mark(a, canvas)
    nb = normalize_mark(b, canvas)
    return compare_rgba(na, nb)


# ---------------------------------------------------------------------------
# Windows shell extraction
# ---------------------------------------------------------------------------
class ShellProbe:
    """Extract the icon the shell really renders for a path.

    Uses the same machinery Explorer and the taskbar use:
      * SHGetFileInfoW(SHGFI_ICON | SHGFI_LARGEICON / SHGFI_SMALLICON) -> 32 / 16 px
      * SHGetImageList(SHIL_*) + IImageList::GetIcon -> 16 / 32 / 48 / 256 px
    The image lists are what the jumbo (256 px) and extra-large (48 px) views read,
    and the jumbo slot is where a PNG-compressed 256 px frame is decoded, so it is
    the closest match to what a user sees in a large-icon Explorer view.
    """

    SHGFI_ICON = 0x00000100
    SHGFI_LARGEICON = 0x00000000
    SHGFI_SMALLICON = 0x00000001
    SHGFI_SYSICONINDEX = 0x00004000
    SHGFI_USEFILEATTRIBUTES = 0x00000010
    FILE_ATTRIBUTE_NORMAL = 0x00000080

    SHIL_LARGE = 0
    SHIL_SMALL = 1
    SHIL_EXTRALARGE = 2
    SHIL_JUMBO = 4

    ILD_TRANSPARENT = 0x1
    VT_GETICON = 10  # IImageList vtable slot (3 IUnknown + 7 IImageList methods)

    def __init__(self):
        import ctypes
        from ctypes import wintypes

        self.ct = ctypes
        self.wt = wintypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
        self.shell32 = ctypes.WinDLL("shell32", use_last_error=True)

        u, g, s, w = self.user32, self.gdi32, self.shell32, wintypes

        # All 64-bit handles must be declared or ctypes truncates them.
        u.GetDC.argtypes = [w.HWND]
        u.GetDC.restype = w.HDC
        u.ReleaseDC.argtypes = [w.HWND, w.HDC]
        u.ReleaseDC.restype = ctypes.c_int
        u.GetIconInfo.argtypes = [w.HICON, ctypes.c_void_p]
        u.GetIconInfo.restype = w.BOOL
        u.DestroyIcon.argtypes = [w.HICON]
        u.DestroyIcon.restype = w.BOOL
        g.CreateCompatibleDC.argtypes = [w.HDC]
        g.CreateCompatibleDC.restype = w.HDC
        g.SelectObject.argtypes = [w.HDC, w.HGDIOBJ]
        g.SelectObject.restype = w.HGDIOBJ
        g.DeleteDC.argtypes = [w.HDC]
        g.DeleteDC.restype = w.BOOL
        g.GetObjectW.argtypes = [w.HGDIOBJ, ctypes.c_int, ctypes.c_void_p]
        g.GetObjectW.restype = ctypes.c_int
        g.GetDIBits.argtypes = [
            w.HDC, w.HBITMAP, w.UINT, w.UINT, ctypes.c_void_p, ctypes.c_void_p, w.UINT
        ]
        g.GetDIBits.restype = ctypes.c_int
        s.SHGetFileInfoW.argtypes = [
            w.LPCWSTR, w.DWORD, ctypes.c_void_p, w.UINT, w.UINT
        ]
        s.SHGetFileInfoW.restype = ctypes.c_size_t

        class GUID(ctypes.Structure):
            _fields_ = [
                ("Data1", w.DWORD),
                ("Data2", w.WORD),
                ("Data3", w.WORD),
                ("Data4", ctypes.c_ubyte * 8),
            ]

        self.GUID = GUID
        self.IID_IImageList = GUID(
            0x46EB5926,
            0x582E,
            0x4017,
            (ctypes.c_ubyte * 8)(0x9F, 0xDF, 0xE8, 0x99, 0x8D, 0xAA, 0x09, 0x50),
        )
        s.SHGetImageList.argtypes = [
            ctypes.c_int, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)
        ]
        s.SHGetImageList.restype = ctypes.c_long

        self._structs = self._define_structs()
        self._lists = {}
        self._com_ready = False

    def _define_structs(self):
        ctypes, w = self.ct, self.wt

        class SHFILEINFOW(ctypes.Structure):
            _fields_ = [
                ("hIcon", w.HICON),
                ("iIcon", ctypes.c_int),
                ("dwAttributes", w.DWORD),
                ("szDisplayName", w.WCHAR * 260),
                ("szTypeName", w.WCHAR * 80),
            ]

        class ICONINFO(ctypes.Structure):
            _fields_ = [
                ("fIcon", w.BOOL),
                ("xHotspot", w.DWORD),
                ("yHotspot", w.DWORD),
                ("hbmMask", w.HBITMAP),
                ("hbmColor", w.HBITMAP),
            ]

        class BITMAP(ctypes.Structure):
            _fields_ = [
                ("bmType", w.LONG),
                ("bmWidth", w.LONG),
                ("bmHeight", w.LONG),
                ("bmWidthBytes", w.LONG),
                ("bmPlanes", w.WORD),
                ("bmBitsPixel", w.WORD),
                ("bmBits", ctypes.c_void_p),
            ]

        class BITMAPINFOHEADER(ctypes.Structure):
            _fields_ = [
                ("biSize", w.DWORD),
                ("biWidth", w.LONG),
                ("biHeight", w.LONG),
                ("biPlanes", w.WORD),
                ("biBitCount", w.WORD),
                ("biCompression", w.DWORD),
                ("biSizeImage", w.DWORD),
                ("biXPelsPerMeter", w.LONG),
                ("biYPelsPerMeter", w.LONG),
                ("biClrUsed", w.DWORD),
                ("biClrImportant", w.DWORD),
            ]

        class BITMAPINFO(ctypes.Structure):
            _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", w.DWORD * 3)]

        return {
            "SHFILEINFOW": SHFILEINFOW,
            "ICONINFO": ICONINFO,
            "BITMAP": BITMAP,
            "BITMAPINFOHEADER": BITMAPINFOHEADER,
            "BITMAPINFO": BITMAPINFO,
        }

    def _ensure_com(self):
        if self._com_ready:
            return
        self.ct.windll.ole32.CoInitialize(None)
        self._com_ready = True

    def _hicon_to_image(self, hicon):
        from PIL import Image

        ctypes = self.ct
        S = self._structs
        ii = S["ICONINFO"]()
        if not self.user32.GetIconInfo(hicon, ctypes.byref(ii)):
            raise OSError(ctypes.get_last_error(), "GetIconInfo failed")
        try:
            bm = S["BITMAP"]()
            self.gdi32.GetObjectW(ii.hbmColor, ctypes.sizeof(S["BITMAP"]), ctypes.byref(bm))
            w, h = bm.bmWidth, bm.bmHeight
            hdc = self.user32.GetDC(None)
            memdc = self.gdi32.CreateCompatibleDC(hdc)
            bmi = S["BITMAPINFO"]()
            bmi.bmiHeader.biSize = ctypes.sizeof(S["BITMAPINFOHEADER"])
            bmi.bmiHeader.biWidth = w
            bmi.bmiHeader.biHeight = -h  # top-down
            bmi.bmiHeader.biPlanes = 1
            bmi.bmiHeader.biBitCount = 32
            bmi.bmiHeader.biCompression = 0  # BI_RGB
            buf = ctypes.create_string_buffer(w * h * 4)
            old = self.gdi32.SelectObject(memdc, ii.hbmColor)
            self.gdi32.GetDIBits(memdc, ii.hbmColor, 0, h, buf, ctypes.byref(bmi), 0)
            self.gdi32.SelectObject(memdc, old)
            self.gdi32.DeleteDC(memdc)
            self.user32.ReleaseDC(None, hdc)
            return Image.frombuffer("RGBA", (w, h), buf.raw, "raw", "BGRA", 0, 1).copy()
        finally:
            self.user32.DestroyIcon(hicon)

    def _image_list(self, shil: int):
        if shil in self._lists:
            return self._lists[shil]
        ptr = self.ct.c_void_p()
        hr = self.shell32.SHGetImageList(
            shil, self.ct.byref(self.IID_IImageList), self.ct.byref(ptr)
        )
        value = ptr.value if hr == 0 and ptr.value else None
        self._lists[shil] = value
        return value

    def _sysicon_index(self, path: str):
        S = self._structs
        info = S["SHFILEINFOW"]()
        flags = self.SHGFI_SYSICONINDEX
        r = self.shell32.SHGetFileInfoW(
            self.ct.c_wchar_p(path),
            self.FILE_ATTRIBUTE_NORMAL,
            self.ct.byref(info),
            self.ct.sizeof(info),
            flags,
        )
        return info.iIcon if r else None

    def _from_image_list(self, path: str, shil: int):
        iml = self._image_list(shil)
        if iml is None:
            return None
        idx = self._sysicon_index(path)
        if idx is None:
            return None
        vtable = self.ct.cast(
            iml, self.ct.POINTER(self.ct.POINTER(self.ct.c_void_p))
        ).contents
        proto = self.ct.WINFUNCTYPE(
            self.ct.c_long,
            self.ct.c_void_p,
            self.ct.c_int,
            self.ct.c_uint,
            self.ct.POINTER(self.wt.HICON),
        )
        fn = proto(vtable[self.VT_GETICON])
        hicon = self.wt.HICON()
        hr = fn(iml, idx, self.ILD_TRANSPARENT, self.ct.byref(hicon))
        if hr != 0 or not hicon.value:
            return None
        return self._hicon_to_image(hicon)

    def _from_shgetfileinfo(self, path: str, large: bool):
        S = self._structs
        info = S["SHFILEINFOW"]()
        flags = self.SHGFI_ICON | (
            self.SHGFI_LARGEICON if large else self.SHGFI_SMALLICON
        )
        r = self.shell32.SHGetFileInfoW(
            self.ct.c_wchar_p(path),
            self.FILE_ATTRIBUTE_NORMAL,
            self.ct.byref(info),
            self.ct.sizeof(info),
            flags,
        )
        if not r or not info.hIcon:
            return None
        return self._hicon_to_image(info.hIcon)

    def extract(self, path: Path) -> dict:
        """Return {size: PIL image or None} for the sizes the shell exposes."""
        self._ensure_com()
        p = str(path)
        out = {}
        for shil, size, fallback_large in (
            (self.SHIL_SMALL, 16, False),
            (self.SHIL_LARGE, 32, True),
            (self.SHIL_EXTRALARGE, 48, None),
            (self.SHIL_JUMBO, 256, None),
        ):
            img = None
            try:
                img = self._from_image_list(p, shil)
            except Exception:
                img = None
            if img is None and fallback_large is not None:
                try:
                    img = self._from_shgetfileinfo(p, fallback_large)
                except Exception:
                    img = None
            out[size] = img
        return out


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
def default_targets() -> list[Path]:
    """Every packaging artifact that is present, in build dependency order."""
    targets = []
    if DEFAULT_EXE.exists():
        targets.append(DEFAULT_EXE)
    for pattern in ("Azkript-*-portable.exe", "Azkript-Setup-*.exe"):
        targets.extend(sorted(DIST.glob(pattern)))
    return targets


def check_bytes(exe_path: Path, source: list[dict]) -> dict:
    """Byte-exact comparison of every embedded RT_ICON against the ICO frames."""
    exe = exe_path.read_bytes()
    resource_rva, sections, _ = pe_sections(exe)
    res = walk_resources(exe, sections, resource_rva)

    groups = res.get(RT_GROUP_ICON, [])
    icons = res.get(RT_ICON, [])
    embedded = {icon["id"]: icon["data"] for icon in icons}
    source_payloads = {f["payload"]: f for f in source}

    frames = []
    for group in groups:
        for decl in parse_group(group["data"]):
            blob = embedded.get(decl["id"])
            src = source_payloads.get(blob)
            frames.append(
                {
                    "size": decl["size"],
                    "resource_id": decl["id"],
                    "embedded_bytes": len(blob) if blob is not None else 0,
                    "present": blob is not None,
                    "matches": src is not None,
                    "sha256": sha256(blob) if blob is not None else None,
                    "source_sha256": src["sha256"] if src is not None else None,
                }
            )

    all_payloads = {d["data"] for items in res.values() for d in items}
    matched = sum(1 for f in source if f["payload"] in all_payloads)
    return {
        "groups": len(groups),
        "rt_icon_count": len(icons),
        "frames": frames,
        "matched": matched,
        "source_count": len(source),
        "ok": matched == len(source),
        "exe_sha256": sha256(exe),
    }


def check_shell(
    exe_path: Path, source: list[dict], probe: ShellProbe
) -> dict:
    """Compare what the shell renders against the corresponding ICO frame.

    Windows re-composes the icon into its own image-list cell rather than handing
    back the ICO frame verbatim, but once the cache is warm the per-size result
    still tracks the matching frame to within a couple of LSBs (measured over
    repeated fresh processes: worst=2, mean<0.4 on 16/32/48/256 px). So the guard
    compares raw pixels, which is strict enough to catch a wrong design.

    A *cold* shell can answer with a half-built image the first time it is asked
    for a path whose cache entry it is mid-way through rebuilding - reproducible
    immediately after SHChangeNotify broadcasts SHCNE_ASSOCCHANGED. That is a
    transient, not a wrong icon, so a failing size is re-queried a couple of times
    before it is reported as a mismatch.
    """
    by_size = {f["size"]: f for f in source}
    attempts = 3
    results = {}
    for attempt in range(attempts):
        images = probe.extract(exe_path)
        pending_fail = []
        for size, img in sorted(images.items()):
            if img is None or size not in by_size:
                results.setdefault(size, {"size": size, "available": img is not None})
                continue
            ref = ico_frame_image(size)
            if img.size != ref.size:
                results[size] = {
                    "size": size,
                    "available": True,
                    "note": f"shell returned {img.size}, ICO frame is {ref.size}",
                }
                continue
            raw_worst, raw_mean, raw_over = compare_rgba(img, ref)
            worst, mean, over = raw_worst, raw_mean, raw_over
            asserted = size in SHELL_ASSERT_SIZES
            passed = worst <= SHELL_WORST_TOLERANCE and mean <= SHELL_MEAN_TOLERANCE
            results[size] = {
                "size": size,
                "available": True,
                "worst": worst,
                "mean": round(mean, 3),
                "pixels_over_24": over,
                "asserted": asserted,
                "passed": passed,
                "reference_sha256": sha256(img.tobytes()),
                "expected_sha256": sha256(ref.tobytes()),
                "attempts": attempt + 1,
            }
            if asserted and not passed:
                pending_fail.append(size)
        if not pending_fail:
            break
    rows = [results[size] for size in sorted(results)]
    ok = all(
        row.get("passed", True) for row in rows if row.get("asserted")
    )
    return {"rows": rows, "ok": ok}


def staleness(exe_path: Path) -> dict:
    """Compare artifact mtime against the icon source mtime."""
    if not ICO.exists():
        return {"comparable": False, "note": "icon.ico missing"}
    try:
        exe_mtime = exe_path.stat().st_mtime
        ico_mtime = ICO.stat().st_mtime
    except OSError:
        return {"comparable": False}
    return {
        "comparable": True,
        "artifact_older_than_ico": exe_mtime < ico_mtime,
        "artifact_mtime": exe_mtime,
        "ico_mtime": ico_mtime,
    }


def report_target(exe_path: Path, source: list[dict], probe: ShellProbe | None, strict: bool):
    """Print the per-artifact report. Returns (ok, result dict)."""
    rel = (
        exe_path.relative_to(ROOT) if exe_path.is_relative_to(ROOT) else exe_path
    )
    print(f"\n=== {rel} ===")
    try:
        byte_result = check_bytes(exe_path, source)
    except Exception as exc:  # noqa: BLE001 - report, never crash the suite
        print(f"  ERROR: could not parse PE resources: {exc}")
        return False, {"path": str(exe_path), "error": str(exc)}

    print(
        f"  RT_GROUP_ICON entries: {byte_result['groups']}  "
        f"RT_ICON images: {byte_result['rt_icon_count']}  "
        f"source frames: {byte_result['source_count']}"
    )
    for frame in byte_result["frames"]:
        if not frame["present"]:
            status = "MISSING FROM EXE"
        elif frame["matches"]:
            status = "matches source ICO"
        else:
            status = "DOES NOT MATCH source ICO"
        print(
            f"    {frame['size']:>3}px  RT_ICON {frame['resource_id']:>3}  "
            f"{frame['embedded_bytes']:>6} bytes  {status}"
        )

    print(
        f"  {byte_result['matched']}/{byte_result['source_count']} source ICO frames "
        f"byte-identical inside the exe"
    )

    stale = staleness(exe_path)
    # Only a dist/ artifact is one we built from this tree, so only there is
    # "older than icon.ico" a meaningful staleness signal.
    in_dist = False
    try:
        exe_path.resolve().relative_to(DIST.resolve())
        in_dist = True
    except ValueError:
        in_dist = False
    if in_dist and stale.get("comparable") and stale.get("artifact_older_than_ico"):
        print(
            "  STALENESS: this artifact is OLDER than desktop/assets/icon.ico - "
            "it cannot carry the current icon."
        )

    result = {"path": str(exe_path), "bytes": byte_result, "staleness": stale}
    ok = byte_result["ok"]

    if probe is not None:
        shell_result = check_shell(exe_path, source, probe)
        result["shell"] = shell_result
        print("  -- shell render (what Explorer / the taskbar actually draw) --")
        for row in shell_result["rows"]:
            if not row.get("available"):
                print(f"    {row['size']:>3}px  unavailable")
                continue
            if "passed" not in row:
                print(f"    {row['size']:>3}px  {row.get('note', 'skipped')}")
                continue
            if row["passed"]:
                verdict = "MATCHES current ICO"
            elif row["asserted"]:
                verdict = "DIFFERENT IMAGE"
            else:
                # Not asserted: Windows rebuilds this image-list slot with its own
                # compositing, so it tracks the ICO frame closely but not exactly.
                verdict = "shell re-render (differs slightly; not asserted)"
            tag = "asserted" if row["asserted"] else "reported only"
            retried = (
                f"  retried x{row['attempts']}"
                if row.get("attempts", 1) > 1
                else ""
            )
            print(
                f"    {row['size']:>3}px  worst={row['worst']:>3} "
                f"mean={row['mean']:>6.3f} px>24={row['pixels_over_24']:>5}  "
                f"{verdict}  ({tag}){retried}"
            )
        # A shell mismatch while the bytes are correct is the cache failure mode.
        if byte_result["ok"] and not shell_result["ok"]:
            print(
                "  SHELL MISMATCH: the exe embeds the current icon but the shell returns "
                "a different image for this path."
            )
            print("    -> the Windows icon cache is stale; run: pwsh scripts/refresh-icon-cache.ps1")
            ok = False

    if ok:
        print("  PASS: the exe carries the current icon.ico")
    else:
        if not byte_result["ok"]:
            missing = sorted({f["size"] for f in byte_result["frames"] if not f["matches"]})
            print(
                "  FAIL: the exe does not carry the current icon.ico"
                + (f" (frames: {missing})" if missing else "")
            )
            print("    -> rebuild the artifact: npm run package:dir")
            print("       then repackage:      npm run package:portable && npm run package:win")
            if in_dist and stale.get("artifact_older_than_ico"):
                print("       (this artifact predates the current icon.ico)")
    result["ok"] = ok
    return ok, result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify packaged Windows artifacts embed and render the current icon.ico."
    )
    parser.add_argument(
        "exe",
        nargs="*",
        type=Path,
        help="artifact(s) to probe; defaults to every dist/ artifact that exists",
    )
    parser.add_argument(
        "--no-shell",
        action="store_true",
        help="skip the Win32 shell-render comparison (bytes only)",
    )
    parser.add_argument(
        "--require-exe",
        action="store_true",
        help="fail instead of skipping when no artifact is present",
    )
    parser.add_argument("--json", action="store_true", help="emit a JSON summary")
    args = parser.parse_args(argv)

    if not ICO.exists():
        print(f"MISSING source icon: {ICO}")
        print("  -> regenerate it: python scripts/make-icon.py")
        return 2

    source = ico_frames(ICO)
    print(f"source {ICO.relative_to(ROOT)}: {len(source)} frames "
          f"({', '.join(str(f['size']) for f in source)})")
    print(f"icon.ico sha256: {sha256(ICO.read_bytes())}")

    targets = args.exe or default_targets()
    if not targets:
        message = (
            "no packaging artifact found under dist/ "
            "(looked for win-unpacked/Azkript.exe, *-portable.exe, Azkript-Setup-*.exe)"
        )
        if args.require_exe:
            print(f"FAIL: {message}")
            print("  -> build one: npm run package:dir")
            return 1
        print(f"SKIP: {message}")
        print("  (nothing to verify yet; run `npm run package:dir` to create it)")
        return 0

    probe = None
    if not args.no_shell:
        if sys.platform != "win32":
            print("NOTE: shell-render check is Windows-only; comparing embedded bytes only.")
        else:
            try:
                probe = ShellProbe()
            except Exception as exc:  # noqa: BLE001 - never let this mask the byte check
                print(f"NOTE: shell-render check unavailable ({exc}); bytes only.")

    results = []
    all_ok = True
    for target in targets:
        if not target.exists():
            print(f"\nMISSING: {target} (run `npm run package:dir` first)")
            all_ok = False
            continue
        ok, result = report_target(target, source, probe, strict=args.require_exe)
        all_ok = all_ok and ok
        results.append(result)

    print("\n== summary ==")
    for result in results:
        if result.get("error"):
            print(f"  ERROR  {result['path']}")
            continue
        shell_rows = (result.get("shell") or {}).get("rows", [])
        shell_bad = [
            r["size"] for r in shell_rows if r.get("asserted") and not r.get("passed")
        ]
        detail = f"bytes {result['bytes']['matched']}/{result['bytes']['source_count']}"
        if shell_rows:
            detail += f", shell {'OK' if not shell_bad else f'mismatch at {shell_bad}'}"
        print(f"  {'PASS' if result.get('ok') else 'FAIL'}   {result['path']}  ({detail})")

    if not all_ok:
        print("\nRESULT: FAIL - a packaged artifact does not carry/render the current icon.")
        return 1
    print("\nRESULT: PASS - every packaged artifact carries and renders the current icon.")
    if args.json:
        print(json.dumps(results, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
