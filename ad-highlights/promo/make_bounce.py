#!/usr/bin/env python3
"""DVD-screensaver style bouncing "Ability Draft Plus" overlay for vertical video.

Pipeline: lockup.html -> (headless Chromium) lockup.png  ->  this script -> frames + GIF/WebM/PNG-zip.
The loop is mathematically seamless: the x bounce completes in PX frames, the y bounce in PY frames,
and the clip is lcm(PX, PY) frames long, so the last frame leads straight into the first.
Speeds are equal on both axes when PX:PY == (W-w):(H-h), giving the classic 45-degree drift.

Usage:  python make_bounce.py [--fps 15] [--px 100] [--py 250] [--scale 0.62] [--out out]
Requires Pillow. ffmpeg (for the WebM with alpha) is optional: pass --ffmpeg <path> or have it on PATH.
"""
from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import zipfile
from pathlib import Path

from PIL import Image

W, H = 1080, 1920
# Tints cycled on every edge hit (the DVD-logo colour change). Taken from the app icon's gradients.
TINTS = [(255, 255, 255), (116, 223, 166), (169, 127, 224), (217, 165, 20), (90, 200, 190)]


def tinted(base: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """Recolour the accent (green) parts of the lockup; leave the icon and white text alone."""
    px = base.load()
    out = base.copy()
    op = out.load()
    for y in range(base.height):
        for x in range(base.width):
            r, g, b, a = px[x, y]
            if a and g > r + 40 and g > b + 10:  # the #74dfa6-ish accent
                k = g / 223
                op[x, y] = (int(rgb[0] * k), int(rgb[1] * k), int(rgb[2] * k), a)
    return out


def triangle(i: int, period: int, span: int) -> int:
    """Position along a 0..span..0 bounce with the given full period (frames)."""
    half = period / 2
    t = i % period
    return round(span * (t / half if t <= half else (period - t) / half))


ENCODERS = {
    # WebM VP8 with alpha: CapCut desktop, DaVinci 19+, browsers. Small.
    "adplus_bounce_alpha.webm": ["-c:v", "libvpx", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "1500k", "-metadata:s:v:0", "alpha_mode=1"],
    # MOV QuickTime Animation (RLE) with alpha: Premiere, Final Cut, Resolve, CapCut. Lossless, compresses empty frames well.
    "adplus_bounce_alpha.mov": ["-c:v", "qtrle", "-pix_fmt", "argb"],
}


def encode(frames_dir: Path, fps: int, ffmpeg: str, out_path: Path) -> None:
    """Pipe frames as raw RGBA so minimal ffmpeg builds without a PNG decoder still work."""
    files = sorted(frames_dir.glob("f*.png"))
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-framerate", str(fps), "-i", "-",
           *ENCODERS[out_path.name], str(out_path)]
    webm = out_path
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdin is not None
    for f in files:
        proc.stdin.write(Image.open(f).convert("RGBA").tobytes())
    proc.stdin.close()
    err = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
    if proc.wait() == 0:
        print("wrote", webm, f"{webm.stat().st_size/1e6:.1f} MB")
    else:
        print("ffmpeg failed:", err[-400:])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lockup", type=Path, default=Path("lockup.png"))
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--px", type=int, default=100, help="frames for one full horizontal bounce")
    ap.add_argument("--py", type=int, default=250, help="frames for one full vertical bounce")
    ap.add_argument("--scale", type=float, default=0.62, help="lockup scale relative to lockup.png")
    ap.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "")
    ap.add_argument("--no-tint", action="store_true", help="keep one colour instead of changing on bounce")
    ap.add_argument("--encode-only", action="store_true", help="re-encode WebM/MOV from existing out/frames")
    args = ap.parse_args()
    if args.encode_only:
        for name in ENCODERS:
            encode(args.out / "frames", args.fps, args.ffmpeg, args.out / name)
        return 0

    base = Image.open(args.lockup).convert("RGBA")
    if args.scale != 1:
        base = base.resize((round(base.width * args.scale), round(base.height * args.scale)), Image.LANCZOS)
    w, h = base.size
    spanx, spany = W - w, H - h
    n = math.lcm(args.px, args.py)
    print(f"lockup {w}x{h}, {n} frames = {n / args.fps:.1f}s loop, speeds {2*spanx/args.px:.1f}/{2*spany/args.py:.1f} px/frame")

    variants = [base] if args.no_tint else [tinted(base, t) for t in TINTS]
    frames_dir = args.out / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    frames: list[Image.Image] = []
    tint_i, prev = 0, (None, None)
    for i in range(n):
        x, y = triangle(i, args.px, spanx), triangle(i, args.py, spany)
        hit = (x in (0, spanx) and prev[0] not in (None, x)) or (y in (0, spany) and prev[1] not in (None, y))
        if hit:
            tint_i = (tint_i + 1) % len(variants)
        prev = (x, y)
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        canvas.alpha_composite(variants[tint_i], (x, y))
        canvas.save(frames_dir / f"f{i:04d}.png", optimize=False)
        frames.append(canvas)

    # --- GIF: 1-bit transparency, so flatten soft edges onto a dark fringe first (looks clean at 30%).
    gif_frames = []
    for f in frames:
        a = f.getchannel("A")
        solid = Image.new("RGBA", f.size, (16, 12, 22, 255))
        solid.paste(f, (0, 0), a)
        q = solid.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT)
        mask = a.point(lambda v: 255 if v >= 96 else 0)
        q.paste(255, mask=Image.eval(mask, lambda v: 255 - v))  # index 255 = transparent
        gif_frames.append(q)
    gif_path = args.out / "adplus_bounce.gif"
    gif_frames[0].save(gif_path, save_all=True, append_images=gif_frames[1:], loop=0, duration=round(1000 / args.fps),
                       transparency=255, disposal=2, optimize=False)
    print("wrote", gif_path, f"{gif_path.stat().st_size/1e6:.1f} MB")

    # --- PNG sequence zip (universal for desktop editors: import as image sequence, alpha preserved)
    zpath = args.out / "adplus_bounce_png_sequence.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(frames_dir.glob("f*.png")):
            z.write(p, p.name)
    print("wrote", zpath, f"{zpath.stat().st_size/1e6:.1f} MB")

    # --- WebM + MOV with alpha (see ENCODERS)
    if args.ffmpeg:
        for name in ENCODERS:
            encode(frames_dir, args.fps, args.ffmpeg, args.out / name)
    else:
        print("ffmpeg not found - skipped WebM/MOV (pass --ffmpeg PATH)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
