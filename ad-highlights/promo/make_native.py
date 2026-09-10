#!/usr/bin/env python3
"""Platform-native like+follow prompts (3 s, alpha) from native.html -> native_sheet.png.

  native_instagram : heart pops red, outlined Follow -> Following
  native_youtube   : thumbs-up fills, white Subscribe -> grey Subscribed
  native_tiktok    : heart pops red, red + badge -> check -> badge disappears (as TikTok does)

Each tap shows a small expanding ring. Rows sit at x=60, y=1190 (lower-left safe band).
Render: chrome --headless=new --window-size=1080,2100 --default-background-color=00000000 --screenshot=native_sheet.png native.html
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

W, H, FPS = 1080, 1920, 15
X, Y = 60, 1190
PITCH = 130
BANDS = ["ig_A", "ig_AB", "ig_B", "yt_A", "yt_AB", "yt_B", "tt_A", "tt_AB", "tt_B", "tt_C"]


def ease_out(t: float) -> float:
    return 1 - (1 - t) ** 3


def crop_bands(sheet: Image.Image) -> dict[str, Image.Image]:
    out = {}
    for i, name in enumerate(BANDS):
        band = sheet.crop((0, i * PITCH, W, (i + 1) * PITCH))
        out[name] = band.crop(band.getchannel("A").getbbox())
    return out


def segments(img: Image.Image) -> list[tuple[int, int]]:
    """Column runs with any alpha, split on fully transparent gaps >= 6 px -> [(x0, x1), ...]."""
    a = img.getchannel("A")
    cols = [a.crop((x, 0, x + 1, img.height)).getbbox() is not None for x in range(img.width)]
    segs, start, gap = [], None, 0
    for x, on in enumerate(cols):
        if on:
            if start is None:
                start = x
            gap = 0
        else:
            if start is not None:
                gap += 1
                if gap >= 6:
                    segs.append((start, x - gap)); start = None; gap = 0
    if start is not None:
        segs.append((start, img.width))
    return segs


def centre(img: Image.Image, seg: tuple[int, int]) -> tuple[int, int]:
    part = img.crop((seg[0], 0, seg[1], img.height))
    bb = part.getchannel("A").getbbox()
    return (seg[0] + (bb[0] + bb[2]) // 2, (bb[1] + bb[3]) // 2)


def ripple(canvas: Image.Image, cx: int, cy: int, t: float, alpha: float) -> None:
    r = 18 + 40 * t
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, int(200 * (1 - t) * alpha)), width=5)
    canvas.alpha_composite(layer)


def place(canvas, img, x, y, alpha=1.0, scale=1.0, anchor=None):
    if scale != 1.0:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    if alpha < 1.0:
        img = img.copy(); img.putalpha(img.getchannel("A").point(lambda v: int(v * alpha)))
    if anchor:
        x, y = anchor[0] - img.width // 2, anchor[1] - img.height // 2
    canvas.alpha_composite(img, (x, y))


def slide(i: int, n: int, w: int) -> tuple[int, float]:
    if i < 5:
        t = ease_out(i / 5); return round(X - (1 - t) * (w + X)), t
    if i >= n - 5:
        t = ease_out((i - (n - 5)) / 5); return round(X - t * (w + X)), 1 - t
    return X, 1.0


def build(states: dict[str, Image.Image], like_seg_index: int, follow_point, tiktok: bool) -> list[Image.Image]:
    """states: A (before), AB (liked), B (followed), optional C (badge gone)."""
    n = 45
    A, AB, B = states["A"], states["AB"], states["B"]
    segs = segments(AB)
    like_c = centre(AB, segs[like_seg_index])
    like_img = AB.crop((segs[like_seg_index][0], 0, segs[like_seg_index][1], AB.height))
    follow_c = follow_point(AB, segs)
    frames = []
    for i in range(n):
        c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        x, al = slide(i, n, A.width)
        if i < 15:
            panel = A
        elif i < 29:
            panel = AB
        elif tiktok and i >= 37 and "C" in states:
            panel = states["C"]
        else:
            panel = B
        place(c, panel, x, Y, al)
        if 15 <= i < 20:  # like tap: ripple + pop of the like icon
            t = (i - 15) / 5
            ripple(c, x + like_c[0], Y + like_c[1], t, al)
            s = 1.0 + 0.5 * (1 - abs(2 * t - 1))
            place(c, like_img, 0, 0, al, s, anchor=(x + like_c[0], Y + like_c[1]))
        if 27 <= i < 32:  # follow tap ripple
            ripple(c, x + follow_c[0], Y + follow_c[1], (i - 27) / 5, al)
        frames.append(c)
    return frames


def export(frames, out_dir: Path, name: str, ffmpeg: str) -> None:
    fd = out_dir / f"{name}_frames"; fd.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(frames):
        f.save(fd / f"f{i:04d}.png")
    gif = []
    for f in frames:
        a = f.getchannel("A")
        solid = Image.new("RGBA", f.size, (20, 20, 20, 255)); solid.paste(f, (0, 0), a)
        q = solid.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
        q.paste(255, mask=Image.eval(a.point(lambda v: 255 if v >= 96 else 0), lambda v: 255 - v))
        gif.append(q)
    gif[0].save(out_dir / f"{name}.gif", save_all=True, append_images=gif[1:], loop=0, duration=round(1000 / FPS), transparency=255, disposal=2)
    if ffmpeg:
        for ext, codec in (("mov", ["-c:v", "png", "-pix_fmt", "rgba"]),
                           ("webm", ["-c:v", "libvpx", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "1200k", "-metadata:s:v:0", "alpha_mode=1"])):
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(fd / "f%04d.png"), *codec, str(out_dir / f"{name}_alpha.{ext}")], check=True)
    print("wrote", name)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", type=Path, default=Path("native_sheet.png"))
    ap.add_argument("--out", type=Path, default=Path("out/native"))
    ap.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "")
    args = ap.parse_args()
    el = crop_bands(Image.open(args.sheet).convert("RGBA"))
    args.out.mkdir(parents=True, exist_ok=True)
    last_seg_centre = lambda img, segs: centre(img, segs[-1])          # the pill is the rightmost element
    badge_point = lambda img, segs: (centre(img, segs[0])[0], img.height - 16)  # TikTok: badge under the avatar
    export(build({"A": el["ig_A"], "AB": el["ig_AB"], "B": el["ig_B"]}, -2, last_seg_centre, False), args.out, "native_instagram", args.ffmpeg)
    export(build({"A": el["yt_A"], "AB": el["yt_AB"], "B": el["yt_B"]}, -2, last_seg_centre, False), args.out, "native_youtube", args.ffmpeg)
    export(build({"A": el["tt_A"], "AB": el["tt_AB"], "B": el["tt_B"], "C": el["tt_C"]}, -1, badge_point, True), args.out, "native_tiktok", args.ffmpeg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
