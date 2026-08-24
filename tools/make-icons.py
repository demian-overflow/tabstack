#!/usr/bin/env python3
"""Generate the extension icons.

No image dependencies on purpose — the icon is three bars on a rounded square,
which is cheap to rasterise by hand and keeps the repo free of binaries you
cannot regenerate. Run from the repo root: python3 tools/make-icons.py
"""
import struct
import zlib
from pathlib import Path

BG = (61, 110, 245)      # accent blue
FG = (255, 255, 255)     # bars
SIZES = (16, 32, 48, 128)
SS = 4                   # supersampling factor for cheap antialiasing


def coverage(size, x, y):
    """Fraction of pixel (x, y) covered by the icon shape, via supersampling."""
    hits = 0
    for sy in range(SS):
        for sx in range(SS):
            px = (x + (sx + 0.5) / SS) / size
            py = (y + (sy + 0.5) / SS) / size
            if in_rounded_square(px, py):
                hits += 1
    return hits / (SS * SS)


def in_rounded_square(px, py):
    r = 0.22
    dx = max(r - px, px - (1 - r), 0.0)
    dy = max(r - py, py - (1 - r), 0.0)
    return dx * dx + dy * dy <= r * r


def bar_coverage(size, x, y):
    """Fraction of pixel (x, y) covered by one of the three bars."""
    bars = [(0.26, 0.40), (0.44, 0.58), (0.62, 0.76)]  # (top, bottom) in unit space
    left, right = 0.24, 0.76
    hits = 0
    for sy in range(SS):
        for sx in range(SS):
            px = (x + (sx + 0.5) / SS) / size
            py = (y + (sy + 0.5) / SS) / size
            if left <= px <= right and any(t <= py <= b for t, b in bars):
                hits += 1
    return hits / (SS * SS)


def render(size):
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter byte: none
        for x in range(size):
            alpha = coverage(size, x, y)
            bar = bar_coverage(size, x, y) * alpha
            r = round(BG[0] * (1 - bar) + FG[0] * bar)
            g = round(BG[1] * (1 - bar) + FG[1] * bar)
            b = round(BG[2] * (1 - bar) + FG[2] * bar)
            row += bytes((r, g, b, round(alpha * 255)))
        rows.append(bytes(row))
    return b"".join(rows)


def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path, size):
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(render(size), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for size in SIZES:
        target = out / f"icon{size}.png"
        write_png(target, size)
        print(f"wrote {target.relative_to(out.parent)} ({target.stat().st_size} bytes)")
